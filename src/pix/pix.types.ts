import type { Transacao } from '@prisma/client';
import type { Dinheiro } from '../common/utils/dinheiro';
import type { ContaPublica } from '../contas/contas.types';
/** Lancamento ja serializado (Decimal virou string na fronteira). */
export interface LancamentoSerializado {
  id: string;
  tipo: string;
  valor: string;
  descricao: string;
}

/** O que o controller devolve: transacao + destino + saldo da origem. */
export interface ResultadoTransferencia {
  transacao: Transacao;
  destino: ContaPublica;
  saldoOrigem: Dinheiro;
  lancamentos: LancamentoSerializado[];
}

/**
 * Reenvio idempotente: a chave ja foi usada e a transacao anterior terminou.
 * Nao e' erro do ponto de vista do cliente -- a operacao que ele pediu foi
 * feita. Devolvemos o MESMO resultado, para o retry ser seguro.
 */
export interface ReenvioIdempotente {
  resultado: ResultadoTransferencia;
  /** A transacao original ainda esta rodando em outra request. */
  emProcessamento: boolean;
}
