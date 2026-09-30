import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  type PixDevolucao,
  type StatusSpi,
  type Transacao,
} from '@prisma/client';
import {
  normalizarChavePix,
  TIPOS_CHAVE_PIX,
} from '../../common/utils/chave-pix';
import { isCpfValido, somenteDigitos } from '../../common/utils/cpf';
import { paraDecimal } from '../../common/utils/dinheiro';
import { ContasService } from '../../contas/contas.service';
import type { ContaPublica } from '../../contas/contas.types';
import { ConsumidorService } from '../../mensageria/consumidor.service';
import type { Envelope } from '../../mensageria/envelope';
import { ErroTransitorio } from '../../mensageria/erros';
import { InboxService } from '../../mensageria/inbox.service';
import { OutboxService, type Tx } from '../../mensageria/outbox.service';
import { TOPICOS } from '../../mensageria/topicos';
import type {
  MensagemIso,
  PixDevolucaoIso,
  PixOrdemPagamento,
  PixStatusPagamento,
  StatusTransacaoIso,
} from '../../spi/iso20022/tipos';
import {
  EVENTO_SPI,
  idsDaMensagem,
  type DadosMensagemEnviada,
  type DadosMensagemSpi,
} from '../../spi/spi.eventos';
import {
  EVENTOS_PIX,
  registrarEventoPix,
  valorDoEvento,
  type DadosEventoPix,
  type TipoEventoPix,
} from '../eventos-pix';
import {
  podeTransitarDevolucao,
  podeTransitarPix,
  aceitaDevolucao,
} from './estados';
import { lancarPartida } from './ledger-pix';
import { montarStatus } from './mensagens-spi';

const CONSUMIDOR = 'pix-core';

interface Causa {
  correlationId: string;
  causationId: string;
}

/**
 * Core Pix assincrono: consome pix.spi.inbound e aplica cada mensagem na
 * maquina de estados, no ledger e no outbox -- tudo numa transacao so, com a
 * inbox garantindo que cada mensagem tem efeito uma vez.
 *
 *   spi.mensagem.enviada pacs.008 -> Pix CRIADO -> ENVIADO
 *   spi.mensagem.enviada pacs.004 -> devolucao SOLICITADA -> ENVIADA
 *   pacs.002 (resposta a pacs.008) -> LIQUIDADO | REJEITADO (+ estorno)
 *   pacs.002 (resposta a pacs.004) -> devolucao LIQUIDADA | REJEITADA (+ estorno)
 *   pacs.008 recebido             -> credita o cliente + responde pacs.002
 *   pacs.004 recebido             -> devolve ao cliente + responde pacs.002
 */
@Injectable()
export class PixSpiService implements OnModuleInit {
  private readonly logger = new Logger(PixSpiService.name);
  private readonly ispb: string;

  constructor(
    private readonly consumidor: ConsumidorService,
    private readonly inbox: InboxService,
    private readonly outbox: OutboxService,
    private readonly contas: ContasService,
    config: ConfigService,
  ) {
    this.ispb = config.get<string>('PIX_ISPB', '12345678');
  }

  async onModuleInit(): Promise<void> {
    await this.consumidor.assinar({
      grupo: CONSUMIDOR,
      topicos: [TOPICOS.SPI_ENTRADA],
      processar: (envelope) => this.processar(envelope),
    });
  }

  async processar(envelope: Envelope): Promise<void> {
    const causa = {
      correlationId: envelope.correlationId,
      causationId: envelope.eventId,
    };
    // Resolvida FORA da transacao: pode criar a conta de liquidacao.
    const liquidacao = await this.contas.contaLiquidacaoPix();

    await this.inbox.processarUmaVez(
      CONSUMIDOR,
      envelope.eventId,
      async (tx) => {
        if (envelope.eventType === EVENTO_SPI.ENVIADA) {
          return this.confirmarEnvio(
            tx,
            envelope.data as DadosMensagemEnviada,
            causa,
          );
        }
        if (envelope.eventType === EVENTO_SPI.RECEBIDA) {
          return this.aplicarRecebida(
            tx,
            envelope.data as DadosMensagemSpi,
            liquidacao,
            causa,
          );
        }
        this.logger.warn(`Evento ignorado: ${envelope.eventType}`);
      },
    );
  }

  // -------------------------------------------------------------------------
  // Confirmacao de envio
  // -------------------------------------------------------------------------

  private async confirmarEnvio(tx: Tx, d: DadosMensagemEnviada, causa: Causa) {
    if (d.tipo === 'pacs.008' && d.endToEndId) {
      const t = await this.pixPorE2e(tx, d.endToEndId);
      if (await this.transitarPix(tx, t, 'ENVIADO')) {
        await this.evento(
          tx,
          EVENTOS_PIX.ENVIADO,
          this.dadosPix(t, 'ENVIADO'),
          causa,
        );
      }
    } else if (d.tipo === 'pacs.004' && d.returnId) {
      const dev = await this.devolucaoPorReturnId(tx, d.returnId);
      if (await this.transitarDevolucao(tx, dev, 'ENVIADA')) {
        await this.eventoDevolucao(
          tx,
          EVENTOS_PIX.DEVOLUCAO_ENVIADA,
          dev,
          'ENVIADA',
          causa,
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // Mensagens recebidas do SPI
  // -------------------------------------------------------------------------

  private aplicarRecebida(
    tx: Tx,
    m: MensagemIso,
    liquidacao: ContaPublica,
    causa: Causa,
  ) {
    switch (m.tipo) {
      case 'pacs.002':
        return m.mensagem.returnId
          ? this.statusDeDevolucao(tx, m.mensagem, liquidacao, causa)
          : this.statusDePagamento(tx, m.mensagem, liquidacao, causa);
      case 'pacs.008':
        return this.pagamentoRecebido(tx, m.mensagem, liquidacao, causa);
      case 'pacs.004':
        return this.devolucaoRecebida(tx, m.mensagem, liquidacao, causa);
    }
  }

  /**
   * pacs.002 respondendo um pacs.008 nosso. Publico para a reconciliacao
   * aplicar o resultado da consulta pelo mesmo caminho.
   */
  async statusDePagamento(
    tx: Tx,
    s: Pick<PixStatusPagamento, 'endToEndId' | 'status' | 'reasonCode'>,
    liquidacao: ContaPublica,
    causa: Causa,
  ): Promise<void> {
    const t = await this.pixPorE2e(tx, s.endToEndId!);
    if (s.status === 'ACSP') return; // aceito, liquidacao ainda vem

    if (s.status === 'RJCT') {
      const mudou = await this.transitarPix(tx, t, 'REJEITADO', {
        status: 'FALHA',
        motivoRejeicao: s.reasonCode ?? null,
      });
      if (!mudou) return;
      // O cliente ja foi debitado quando o Pix foi aceito: devolve o valor.
      await lancarPartida(tx, {
        tipo: 'ESTORNO',
        idempotencyKey: `estorno:${t.id}`,
        origemId: liquidacao.id,
        destinoId: t.origemId,
        valor: t.valor,
        descricaoDebito: `Estorno Pix rejeitado ${t.endToEndId}`,
        descricaoCredito: `Estorno: Pix para ${t.favorecidoNome ?? 'outro banco'} rejeitado (${s.reasonCode})`,
      });
      const atual = { ...t, motivoRejeicao: s.reasonCode ?? null };
      await this.evento(
        tx,
        EVENTOS_PIX.REJEITADO,
        this.dadosPix(atual, 'REJEITADO'),
        causa,
      );
      this.logger.warn(
        `Pix ${t.endToEndId} REJEITADO (${s.reasonCode}); valor estornado`,
      );
      return;
    }

    // ACCC / ACSC
    if (await this.transitarPix(tx, t, 'LIQUIDADO', { status: 'CONCLUIDA' })) {
      await this.evento(
        tx,
        EVENTOS_PIX.LIQUIDADO,
        this.dadosPix(t, 'LIQUIDADO'),
        causa,
      );
      this.logger.log(`Pix ${t.endToEndId} LIQUIDADO`);
    }
  }

  /** pacs.002 respondendo um pacs.004 nosso. */
  async statusDeDevolucao(
    tx: Tx,
    s: Pick<PixStatusPagamento, 'returnId' | 'status' | 'reasonCode'>,
    liquidacao: ContaPublica,
    causa: Causa,
  ): Promise<void> {
    const dev = await this.devolucaoPorReturnId(tx, s.returnId!);
    if (s.status === 'ACSP') return;

    if (s.status === 'RJCT') {
      if (!(await this.transitarDevolucao(tx, dev, 'REJEITADA', s.reasonCode)))
        return;
      const original = await tx.transacao.findUniqueOrThrow({
        where: { id: dev.transacaoOriginalId },
      });
      // O cliente foi debitado ao pedir a devolucao: o dinheiro volta.
      await lancarPartida(tx, {
        tipo: 'ESTORNO',
        idempotencyKey: `estorno:${dev.transacaoLedgerId ?? dev.id}`,
        origemId: liquidacao.id,
        destinoId: original.destinoId,
        valor: dev.valor,
        descricaoDebito: `Estorno devolucao rejeitada ${dev.returnId}`,
        descricaoCredito: `Estorno: devolucao Pix rejeitada (${s.reasonCode})`,
      });
      await this.eventoDevolucao(
        tx,
        EVENTOS_PIX.DEVOLUCAO_REJEITADA,
        dev,
        'REJEITADA',
        causa,
      );
      return;
    }

    if (!(await this.transitarDevolucao(tx, dev, 'LIQUIDADA'))) return;
    const original = await tx.transacao.findUniqueOrThrow({
      where: { id: dev.transacaoOriginalId },
    });
    await this.atualizarDevolvido(tx, original, 'ENVIADA');
    await this.eventoDevolucao(
      tx,
      EVENTOS_PIX.DEVOLUCAO_LIQUIDADA,
      dev,
      'LIQUIDADA',
      causa,
    );
  }

  /**
   * pacs.008 de ENTRADA: alguem de outro banco pagou nosso cliente. Caminho
   * curto de proposito -- o SPI da poucos segundos para o pacs.002.
   */
  private async pagamentoRecebido(
    tx: Tx,
    o: PixOrdemPagamento,
    liquidacao: ContaPublica,
    causa: Causa,
  ): Promise<void> {
    const responder = (status: StatusTransacaoIso, motivo?: string) =>
      this.comandoSpi(
        tx,
        {
          tipo: 'pacs.002',
          mensagem: montarStatus(
            this.ispb,
            { messageId: o.messageId, tipo: 'pacs.008', id: o.endToEndId },
            status,
            motivo,
          ),
        },
        causa,
      );

    const jaExiste = await tx.transacao.findUnique({
      where: { endToEndId: o.endToEndId },
    });
    if (jaExiste) {
      this.logger.warn(`pacs.008 ${o.endToEndId} duplicado; ignorado`);
      return;
    }
    if (o.creditor.ispb !== this.ispb) return responder('RJCT', 'AG03');

    const recebedor = await this.resolverRecebedor(o);
    if (!recebedor) {
      this.logger.warn(`pacs.008 ${o.endToEndId}: recebedor nao encontrado`);
      return responder('RJCT', 'AC03');
    }

    const valor = paraDecimal(o.amount.cents).div(100);
    const bancoPagador = `ISPB ${o.debtor.ispb}`;
    const t = await lancarPartida(tx, {
      tipo: 'PIX',
      idempotencyKey: `spi:${o.endToEndId}`,
      origemId: liquidacao.id,
      destinoId: recebedor.id,
      valor,
      descricaoDebito: `Liquidacao SPI: ${o.debtor.name} -> ${recebedor.nome}`,
      descricaoCredito: `Pix recebido de ${o.debtor.name} (${bancoPagador})`,
      extra: {
        endToEndId: o.endToEndId,
        direcaoSpi: 'RECEBIDO',
        statusSpi: 'RECEBIDO',
        pagadorNome: o.debtor.name,
        pagadorBanco: bancoPagador,
      },
    });

    await responder('ACSP');
    await this.evento(
      tx,
      EVENTOS_PIX.RECEBIDO,
      this.dadosPix(t, 'RECEBIDO'),
      causa,
    );
    this.logger.log(`Pix ${o.endToEndId} RECEBIDO por ${recebedor.nome}`);
  }

  /** pacs.004 de ENTRADA: outro banco devolveu um Pix que enviamos. */
  private async devolucaoRecebida(
    tx: Tx,
    d: PixDevolucaoIso,
    liquidacao: ContaPublica,
    causa: Causa,
  ): Promise<void> {
    const responder = (status: StatusTransacaoIso, motivo?: string) =>
      this.comandoSpi(
        tx,
        {
          tipo: 'pacs.002',
          mensagem: montarStatus(
            this.ispb,
            { messageId: d.messageId, tipo: 'pacs.004', id: d.returnId },
            status,
            motivo,
          ),
        },
        causa,
      );

    if (await tx.pixDevolucao.findUnique({ where: { returnId: d.returnId } })) {
      this.logger.warn(`pacs.004 ${d.returnId} duplicado; ignorado`);
      return;
    }

    const original = await tx.transacao.findUnique({
      where: { endToEndId: d.originalEndToEndId },
    });
    if (
      !original ||
      original.direcaoSpi !== 'ENVIADO' ||
      !aceitaDevolucao(original.statusSpi)
    ) {
      return responder('RJCT', 'AG03');
    }
    // Serializa devolucoes concorrentes do mesmo Pix.
    await tx.$queryRaw`SELECT id FROM transacoes WHERE id = ${original.id} FOR UPDATE`;

    const valor = paraDecimal(d.amount.cents).div(100);
    const jaDevolvido = await this.somaDevolucoes(tx, original.id, 'RECEBIDA');
    if (jaDevolvido.add(valor).greaterThan(original.valor)) {
      return responder('RJCT', 'AM02');
    }

    const ledger = await lancarPartida(tx, {
      tipo: 'DEVOLUCAO',
      idempotencyKey: `devolucao:${d.returnId}`,
      origemId: liquidacao.id,
      destinoId: original.origemId,
      valor,
      descricaoDebito: `Liquidacao SPI: devolucao ${d.returnId}`,
      descricaoCredito: `Devolucao Pix de ${original.favorecidoNome ?? 'outro banco'} (${d.reasonCode})`,
    });
    const dev = await tx.pixDevolucao.create({
      data: {
        returnId: d.returnId,
        transacaoOriginalId: original.id,
        transacaoLedgerId: ledger.id,
        direcao: 'RECEBIDA',
        status: 'LIQUIDADA',
        valor,
        motivo: d.reasonCode,
        infoAdicional: d.additionalInfo?.slice(0, 140),
      },
    });

    await this.atualizarDevolvido(tx, original, 'RECEBIDA');
    await responder('ACSP');
    await this.eventoDevolucao(
      tx,
      EVENTOS_PIX.DEVOLUCAO_RECEBIDA,
      dev,
      'LIQUIDADA',
      causa,
    );
    this.logger.log(
      `Devolucao ${d.returnId} RECEBIDA para o Pix ${d.originalEndToEndId}`,
    );
  }

  // -------------------------------------------------------------------------
  // Apoio
  // -------------------------------------------------------------------------

  /**
   * DICT simplificado: tenta a chave como CPF, e-mail e celular; por fim o
   * documento do recebedor.
   */
  private async resolverRecebedor(
    o: PixOrdemPagamento,
  ): Promise<ContaPublica | null> {
    const chave = o.creditor.dictKey;
    if (chave) {
      for (const tipo of TIPOS_CHAVE_PIX) {
        const normalizada = normalizarChavePix(tipo, chave);
        if (!normalizada) continue;
        const conta = await this.contas.buscarPorChavePix(tipo, normalizada);
        if (conta) return conta;
      }
    }
    const doc = o.creditor.document ? somenteDigitos(o.creditor.document) : '';
    if (isCpfValido(doc)) return this.contas.buscarPorChavePix('CPF', doc);
    return null;
  }

  private async pixPorE2e(tx: Tx, endToEndId: string): Promise<Transacao> {
    const t = await tx.transacao.findUnique({ where: { endToEndId } });
    // Corrida: a mensagem chegou antes do registro local ficar visivel.
    if (!t) throw new ErroTransitorio(`Pix ${endToEndId} ainda nao existe`);
    return t;
  }

  private async devolucaoPorReturnId(
    tx: Tx,
    returnId: string,
  ): Promise<PixDevolucao> {
    const d = await tx.pixDevolucao.findUnique({ where: { returnId } });
    if (!d) throw new ErroTransitorio(`Devolucao ${returnId} ainda nao existe`);
    return d;
  }

  /**
   * UPDATE ... WHERE versao = ? (lock otimista). Transicao invalida (atrasada
   * ou duplicada) devolve false e nao faz nada; conflito de versao lanca
   * transitorio para o consumidor tentar de novo com o estado novo.
   */
  private async transitarPix(
    tx: Tx,
    t: Transacao,
    para: StatusSpi,
    extra: Prisma.TransacaoUpdateManyMutationInput = {},
  ): Promise<boolean> {
    if (!t.statusSpi || !podeTransitarPix(t.statusSpi, para)) {
      this.logger.log(
        `Pix ${t.endToEndId}: ${t.statusSpi} -> ${para} ignorado (fora de ordem/duplicado)`,
      );
      return false;
    }
    const r = await tx.transacao.updateMany({
      where: { id: t.id, versao: t.versao },
      data: { ...extra, statusSpi: para, versao: { increment: 1 } },
    });
    if (r.count === 0)
      throw new ErroTransitorio(`conflito de versao no Pix ${t.id}`);
    return true;
  }

  private async transitarDevolucao(
    tx: Tx,
    d: PixDevolucao,
    para: PixDevolucao['status'],
    motivoRejeicao?: string,
  ): Promise<boolean> {
    if (!podeTransitarDevolucao(d.status, para)) {
      this.logger.log(
        `Devolucao ${d.returnId}: ${d.status} -> ${para} ignorado`,
      );
      return false;
    }
    const r = await tx.pixDevolucao.updateMany({
      where: { id: d.id, versao: d.versao },
      data: {
        status: para,
        motivoRejeicao: motivoRejeicao ?? null,
        versao: { increment: 1 },
      },
    });
    if (r.count === 0)
      throw new ErroTransitorio(`conflito de versao na devolucao ${d.id}`);
    return true;
  }

  private async somaDevolucoes(
    tx: Tx,
    transacaoId: string,
    direcao: 'ENVIADA' | 'RECEBIDA',
    somenteLiquidadas = false,
  ) {
    const r = await tx.pixDevolucao.aggregate({
      where: {
        transacaoOriginalId: transacaoId,
        direcao,
        status: somenteLiquidadas ? 'LIQUIDADA' : { not: 'REJEITADA' },
      },
      _sum: { valor: true },
    });
    return r._sum.valor ?? paraDecimal(0);
  }

  /** LIQUIDADO/RECEBIDO -> DEVOLVIDO_PARCIAL | DEVOLVIDO conforme o total. */
  private async atualizarDevolvido(
    tx: Tx,
    original: Transacao,
    direcao: 'ENVIADA' | 'RECEBIDA',
  ): Promise<void> {
    const devolvido = await this.somaDevolucoes(tx, original.id, direcao, true);
    const para: StatusSpi = devolvido.greaterThanOrEqualTo(original.valor)
      ? 'DEVOLVIDO'
      : 'DEVOLVIDO_PARCIAL';
    const atual = await tx.transacao.findUniqueOrThrow({
      where: { id: original.id },
    });
    await this.transitarPix(tx, atual, para);
  }

  private async comandoSpi(
    tx: Tx,
    mensagem: MensagemIso,
    causa: Causa,
  ): Promise<void> {
    await this.outbox.registrar<DadosMensagemSpi>(tx, {
      topico: TOPICOS.SPI_SAIDA,
      chave: idsDaMensagem(mensagem).chave,
      eventType: EVENTO_SPI.COMANDO_ENVIAR,
      aggregateType: 'SpiMensagem',
      aggregateId: mensagem.mensagem.messageId,
      data: mensagem,
      ...causa,
    });
  }

  private dadosPix(t: Transacao, status: StatusSpi): DadosEventoPix {
    const recebido = t.direcaoSpi === 'RECEBIDO';
    return {
      contaId: recebido ? t.destinoId : t.origemId,
      transacaoId: t.id,
      endToEndId: t.endToEndId,
      status,
      direcao: recebido ? 'RECEBIDO' : 'ENVIADO',
      ...valorDoEvento(t.valor),
      contraparte: recebido
        ? { nome: t.pagadorNome ?? 'Pagador', banco: t.pagadorBanco }
        : { nome: t.favorecidoNome ?? 'Favorecido', banco: t.favorecidoBanco },
      motivoRejeicao: t.motivoRejeicao,
    };
  }

  private async eventoDevolucao(
    tx: Tx,
    tipo: TipoEventoPix,
    dev: PixDevolucao,
    status: PixDevolucao['status'],
    causa: Causa,
  ): Promise<void> {
    const original = await tx.transacao.findUniqueOrThrow({
      where: { id: dev.transacaoOriginalId },
    });
    const base = this.dadosPix(original, original.statusSpi ?? 'LIQUIDADO');
    // Devolucao ENVIADA: o dono e' quem recebeu o Pix e esta devolvendo.
    // RECEBIDA: o dono e' quem pagou e esta recebendo de volta.
    await this.evento(
      tx,
      tipo,
      {
        ...base,
        ...valorDoEvento(dev.valor),
        contaId:
          dev.direcao === 'ENVIADA' ? original.destinoId : original.origemId,
        devolucao: {
          id: dev.id,
          returnId: dev.returnId,
          status,
          valor: valorDoEvento(dev.valor).valor,
          motivo: dev.motivo,
        },
      },
      causa,
    );
  }

  private evento(
    tx: Tx,
    tipo: TipoEventoPix,
    dados: DadosEventoPix,
    causa: Causa,
  ) {
    return registrarEventoPix(this.outbox, tx, tipo, dados, causa);
  }
}
