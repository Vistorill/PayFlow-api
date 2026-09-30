import type { StatusDevolucao, StatusSpi } from '@prisma/client';
import type { Dinheiro } from '../common/utils/dinheiro';
import { paraTexto } from '../common/utils/dinheiro';
import type { OutboxService, Tx } from '../mensageria/outbox.service';
import { TOPICOS } from '../mensageria/topicos';

/** Catalogo de eventos de negocio (mensageria.md, secao 4.2). */
export const EVENTOS_PIX = {
  ENVIADO: 'pix.payment.sent',
  LIQUIDADO: 'pix.payment.settled',
  REJEITADO: 'pix.payment.rejected',
  TIMEOUT: 'pix.payment.timeout',
  RECEBIDO: 'pix.payment.received',
  DEVOLUCAO_SOLICITADA: 'pix.return.requested',
  DEVOLUCAO_ENVIADA: 'pix.return.sent',
  DEVOLUCAO_LIQUIDADA: 'pix.return.settled',
  DEVOLUCAO_REJEITADA: 'pix.return.rejected',
  DEVOLUCAO_RECEBIDA: 'pix.return.received',
} as const;

export type TipoEventoPix = (typeof EVENTOS_PIX)[keyof typeof EVENTOS_PIX];
export const TIPOS_EVENTO_PIX = Object.values(EVENTOS_PIX);

/**
 * `data` de todo evento pix.payment.* / pix.return.*. Vai para webhook e push,
 * entao leva o minimo (LGPD): nada de CPF, so nome da contraparte.
 */
export interface DadosEventoPix {
  /** Cliente dono do evento: quem recebe o webhook e o push. */
  contaId: string;
  transacaoId: string;
  endToEndId: string | null;
  /** Status SPI; em Pix interno, LIQUIDADO/RECEBIDO. */
  status: StatusSpi;
  direcao: 'ENVIADO' | 'RECEBIDO';
  valor: string;
  amount: { cents: number; currency: 'BRL' };
  contraparte: { nome: string; banco: string | null };
  motivoRejeicao?: string | null;
  devolucao?: {
    id: string;
    returnId: string;
    status: StatusDevolucao;
    valor: string;
    motivo: string;
  };
}

export function centavos(valor: Dinheiro): number {
  return valor.mul(100).toNumber();
}

export function valorDoEvento(valor: Dinheiro) {
  return {
    valor: paraTexto(valor),
    amount: { cents: centavos(valor), currency: 'BRL' as const },
  };
}

/** Grava o evento no outbox, no topico certo, particionado pelo E2E. */
export function registrarEventoPix(
  outbox: OutboxService,
  tx: Tx,
  tipo: TipoEventoPix,
  dados: DadosEventoPix,
  causa?: { correlationId?: string; causationId?: string },
) {
  const devolucao = tipo.startsWith('pix.return.');
  return outbox.registrar(tx, {
    topico: devolucao ? TOPICOS.DEVOLUCOES : TOPICOS.PAGAMENTOS,
    chave: dados.endToEndId ?? dados.transacaoId,
    eventType: tipo,
    aggregateType: devolucao ? 'PixDevolucao' : 'PixPagamento',
    aggregateId:
      dados.devolucao?.returnId ?? dados.endToEndId ?? dados.transacaoId,
    data: dados,
    correlationId: causa?.correlationId,
    causationId: causa?.causationId,
  });
}
