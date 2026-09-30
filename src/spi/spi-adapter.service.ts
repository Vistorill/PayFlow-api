import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { eConflitoDeUnico } from '../common/utils/prisma';
import { ConsumidorService } from '../mensageria/consumidor.service';
import type { Envelope } from '../mensageria/envelope';
import { ErroPermanente } from '../mensageria/erros';
import { InboxService } from '../mensageria/inbox.service';
import { OutboxService, type Tx } from '../mensageria/outbox.service';
import { TOPICOS } from '../mensageria/topicos';
import { PrismaService } from '../prisma/prisma.service';
import { ErroXmlInvalido, gerarXml, lerXml } from './iso20022/codec';
import type { MensagemIso } from './iso20022/tipos';
import {
  EVENTO_SPI,
  idsDaMensagem,
  type DadosMensagemEnviada,
  type DadosMensagemSpi,
} from './spi.eventos';
import { SpiGateway } from './spi.gateway';

const CONSUMIDOR = 'spi-adapter';

/**
 * SPI Adapter: a UNICA parte do sistema que conhece XML.
 *
 *   Saida:   pix.spi.outbound (canonico) -> XML -> SPI
 *            e confirma em pix.spi.inbound (spi.mensagem.enviada)
 *   Entrada: SPI -> XML -> valida -> guarda o bruto -> pix.spi.inbound
 *            (spi.mensagem.recebida, canonico)
 *
 * Assinatura XMLDSig e validacao XSD ficam aqui quando houver certificado
 * ICP-Brasil/homologacao; hoje `assinaturaValida` e' sempre true (simulador).
 */
@Injectable()
export class SpiAdapterService implements OnModuleInit {
  private readonly logger = new Logger(SpiAdapterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: SpiGateway,
    private readonly consumidor: ConsumidorService,
    private readonly inbox: InboxService,
    private readonly outbox: OutboxService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.gateway.aoReceber((xml) => this.receber(xml));
    await this.consumidor.assinar({
      grupo: CONSUMIDOR,
      topicos: [TOPICOS.SPI_SAIDA],
      processar: (envelope) =>
        this.enviar(envelope as Envelope<DadosMensagemSpi>),
    });
  }

  // -------------------------------------------------------------------------
  // Saida
  // -------------------------------------------------------------------------

  /**
   * Ordem importa: ENVIA primeiro, registra depois. Se cair entre os dois, a
   * reentrega do Kafka manda o MESMO MsgId/EndToEndId de novo -- o SPI
   * deduplica por MsgId. O contrario (registrar e cair antes de enviar)
   * perderia o pagamento em silencio.
   */
  async enviar(envelope: Envelope<DadosMensagemSpi>): Promise<void> {
    if (envelope.eventType !== EVENTO_SPI.COMANDO_ENVIAR) return;
    if (await this.inbox.jaProcessada(CONSUMIDOR, envelope.eventId)) return;

    const mensagem = envelope.data;
    let xml: string;
    try {
      xml = gerarXml(mensagem);
    } catch (erro) {
      throw new ErroPermanente(
        `nao foi possivel montar ${mensagem.tipo}: ${(erro as Error).message}`,
      );
    }

    await this.gateway.enviar(xml);

    const ids = idsDaMensagem(mensagem);
    await this.inbox.processarUmaVez(
      CONSUMIDOR,
      envelope.eventId,
      async (tx) => {
        await this.guardarBruto(tx, mensagem, 'SAIDA', xml);
        await this.outbox.registrar<DadosMensagemEnviada>(tx, {
          topico: TOPICOS.SPI_ENTRADA,
          chave: ids.chave,
          eventType: EVENTO_SPI.ENVIADA,
          aggregateType: 'SpiMensagem',
          aggregateId: mensagem.mensagem.messageId,
          correlationId: envelope.correlationId,
          causationId: envelope.eventId,
          data: {
            tipo: mensagem.tipo,
            messageId: mensagem.mensagem.messageId,
            endToEndId: ids.endToEndId,
            returnId: ids.returnId,
            enviadaEm: new Date().toISOString(),
          },
        });
      },
    );

    this.logger.log(
      `-> ${mensagem.tipo} ${ids.returnId ?? ids.endToEndId} enviado ao SPI`,
    );
  }

  // -------------------------------------------------------------------------
  // Entrada
  // -------------------------------------------------------------------------

  /**
   * Recebe um XML do SPI. Guarda o bruto e publica o canonico via outbox na
   * mesma transacao; o indice (message_id, direcao) descarta reentregas.
   */
  async receber(xml: string): Promise<void> {
    let mensagem: MensagemIso;
    try {
      mensagem = lerXml(xml);
    } catch (erro) {
      if (erro instanceof ErroXmlInvalido) {
        // Em producao: alerta de seguranca + guardar o bruto para analise.
        this.logger.error(`Mensagem do SPI descartada: ${erro.message}`);
        return;
      }
      throw erro;
    }

    const ids = idsDaMensagem(mensagem);
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.guardarBruto(tx, mensagem, 'ENTRADA', xml, true);
        await this.outbox.registrar<DadosMensagemSpi>(tx, {
          topico: TOPICOS.SPI_ENTRADA,
          chave: ids.chave,
          eventType: EVENTO_SPI.RECEBIDA,
          aggregateType: 'SpiMensagem',
          aggregateId: mensagem.mensagem.messageId,
          data: mensagem,
        });
      });
      this.logger.log(
        `<- ${mensagem.tipo} ${ids.returnId ?? ids.endToEndId} recebido do SPI` +
          (mensagem.tipo === 'pacs.002'
            ? ` (${mensagem.mensagem.status})`
            : ''),
      );
    } catch (erro) {
      if (eConflitoDeUnico(erro)) {
        this.logger.warn(
          `Mensagem ${mensagem.mensagem.messageId} ja recebida; ignorada`,
        );
        return;
      }
      throw erro;
    }
  }

  private async guardarBruto(
    tx: Tx,
    m: MensagemIso,
    direcao: 'ENTRADA' | 'SAIDA',
    xml: string,
    falharSeDuplicada = false,
  ): Promise<void> {
    const ids = idsDaMensagem(m);
    const dados = {
      messageId: m.mensagem.messageId,
      tipo: m.tipo,
      direcao,
      endToEndId: ids.endToEndId ?? null,
      returnId: ids.returnId ?? null,
      xml,
      assinaturaValida: true,
    };
    if (falharSeDuplicada) {
      await tx.pixSpiMensagem.create({ data: dados });
      return;
    }
    // Reenvio da mesma mensagem: o registro ja existe e esta certo.
    await tx.pixSpiMensagem.upsert({
      where: { messageId_direcao: { messageId: dados.messageId, direcao } },
      create: dados,
      update: {},
    });
  }
}
