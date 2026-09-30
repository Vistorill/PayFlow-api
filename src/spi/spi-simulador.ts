import { Logger } from '@nestjs/common';
import { gerarXml, lerXml } from './iso20022/codec';
import {
  gerarEndToEndId,
  gerarMsgId,
  gerarReturnId,
} from './iso20022/identificadores';
import type { MotivoDevolucao, PixStatusPagamento } from './iso20022/tipos';
import {
  SpiGateway,
  type ReceptorXml,
  type ResultadoConsultaSpi,
} from './spi.gateway';

export interface ConfigSimulador {
  /** ISPB do nosso PSP. */
  ispb: string;
  /** ISPB do "outro banco" que o simulador representa. */
  ispbContraparte: string;
  /** Atraso entre receber a mensagem e responder, como na vida real. */
  atrasoMs: number;
}

/**
 * Simulador do SPI + PSP da contraparte, para desenvolvimento.
 *
 * Regras deterministicas pelos CENTAVOS do valor, para testar cada caminho
 * pelo app sem mexer em codigo:
 *   ...,99  -> pacs.002 RJCT (AC03 no pagamento, AM02 na devolucao)
 *   ...,98  -> nao responde (timeout: cai na reconciliacao, que acha LIQUIDADO)
 *   ...,97  -> nao responde e a consulta tambem nao acha (reconciliacao estorna)
 *   demais  -> pacs.002 ACCC (liquidado)
 */
export class SpiSimulador extends SpiGateway {
  private readonly logger = new Logger('SpiSimulador');
  private receptor: ReceptorXml | null = null;
  /** Estado que o "SPI" conhece, para a consulta de reconciliacao. */
  private readonly situacoes = new Map<string, ResultadoConsultaSpi>();

  constructor(private readonly config: ConfigSimulador) {
    super();
  }

  aoReceber(receptor: ReceptorXml): void {
    this.receptor = receptor;
  }

  enviar(xml: string): Promise<void> {
    const m = lerXml(xml); // o SPI real tambem recusa XML invalido
    switch (m.tipo) {
      case 'pacs.008': {
        const o = m.mensagem;
        const centavos = o.amount.cents % 100;
        this.logger.log(
          `<- pacs.008 ${o.endToEndId} R$ ${(o.amount.cents / 100).toFixed(2)}`,
        );
        if (centavos === 97) {
          this.situacoes.set(o.endToEndId, { situacao: 'NAO_ENCONTRADO' });
          break;
        }
        const rejeita = centavos === 99;
        this.situacoes.set(
          o.endToEndId,
          rejeita
            ? { situacao: 'REJEITADO', motivo: 'AC03' }
            : { situacao: 'LIQUIDADO' },
        );
        if (centavos === 98) break;
        this.responderDepois({
          messageId: gerarMsgId(this.config.ispbContraparte),
          originalMessageId: o.messageId,
          originalMessageType: 'pacs.008',
          endToEndId: o.endToEndId,
          status: rejeita ? 'RJCT' : 'ACCC',
          reasonCode: rejeita ? 'AC03' : undefined,
          acceptedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        });
        break;
      }
      case 'pacs.004': {
        const d = m.mensagem;
        const rejeita = d.amount.cents % 100 === 99;
        this.logger.log(
          `<- pacs.004 ${d.returnId} (orig ${d.originalEndToEndId})`,
        );
        this.situacoes.set(
          d.returnId,
          rejeita
            ? { situacao: 'REJEITADO', motivo: 'AM02' }
            : { situacao: 'LIQUIDADO' },
        );
        this.responderDepois({
          messageId: gerarMsgId(this.config.ispbContraparte),
          originalMessageId: d.messageId,
          originalMessageType: 'pacs.004',
          returnId: d.returnId,
          status: rejeita ? 'RJCT' : 'ACCC',
          reasonCode: rejeita ? 'AM02' : undefined,
          acceptedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        });
        break;
      }
      case 'pacs.002':
        // Nossa resposta a um pacs.008/pacs.004 recebido.
        this.logger.log(
          `<- pacs.002 ${m.mensagem.status} para ${m.mensagem.endToEndId ?? m.mensagem.returnId}`,
        );
        break;
    }
    return Promise.resolve();
  }

  consultar(id: string): Promise<ResultadoConsultaSpi | null> {
    return Promise.resolve(
      this.situacoes.get(id) ?? { situacao: 'NAO_ENCONTRADO' },
    );
  }

  private responderDepois(status: PixStatusPagamento): void {
    this.entregarDepois(gerarXml({ tipo: 'pacs.002', mensagem: status }));
  }

  private entregarDepois(xml: string): void {
    setTimeout(() => {
      if (!this.receptor) {
        this.logger.warn('Sem receptor registrado; mensagem descartada');
        return;
      }
      this.receptor(xml).catch((erro: Error) =>
        this.logger.error(`Falha ao entregar mensagem do SPI: ${erro.message}`),
      );
    }, this.config.atrasoMs);
  }

  // -------------------------------------------------------------------------
  // Injecao de trafego de ENTRADA (endpoints /api/spi/simulador/*)
  // -------------------------------------------------------------------------

  /** Outro banco paga um cliente nosso: chega um pacs.008. */
  simularPixRecebido(dados: {
    cents: number;
    dictKey: string;
    documentoRecebedor?: string;
    pagadorNome: string;
    pagadorDocumento: string;
    mensagem?: string;
  }): { endToEndId: string } {
    const endToEndId = gerarEndToEndId(this.config.ispbContraparte);
    const agora = new Date().toISOString();
    this.entregarDepois(
      gerarXml({
        tipo: 'pacs.008',
        mensagem: {
          messageId: gerarMsgId(this.config.ispbContraparte),
          endToEndId,
          createdAt: agora,
          amount: { cents: dados.cents, currency: 'BRL' },
          debtor: {
            name: dados.pagadorNome,
            document: dados.pagadorDocumento,
            ispb: this.config.ispbContraparte,
            account: { number: '99887766', branch: '0001', type: 'CACC' },
          },
          creditor: {
            name: 'Cliente Cactvs',
            document: dados.documentoRecebedor,
            ispb: this.config.ispb,
            account: { number: '0', branch: '0001', type: 'TRAN' },
            dictKey: dados.dictKey,
          },
          remittanceInfo: dados.mensagem,
        },
      }),
    );
    return { endToEndId };
  }

  /** Outro banco devolve um Pix que NOS enviamos: chega um pacs.004. */
  simularDevolucaoRecebida(dados: {
    endToEndIdOriginal: string;
    cents: number;
    motivo: MotivoDevolucao;
  }): { returnId: string } {
    const returnId = gerarReturnId(this.config.ispbContraparte);
    this.entregarDepois(
      gerarXml({
        tipo: 'pacs.004',
        mensagem: {
          messageId: gerarMsgId(this.config.ispbContraparte),
          returnId,
          originalEndToEndId: dados.endToEndIdOriginal,
          amount: { cents: dados.cents, currency: 'BRL' },
          reasonCode: dados.motivo,
          additionalInfo: 'Devolucao simulada',
          createdAt: new Date().toISOString(),
        },
      }),
    );
    return { returnId };
  }
}
