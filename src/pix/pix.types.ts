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

/**
 * Para onde vai o dinheiro.
 *   - Pix interno: `conta` e' o cliente PayFlow dono da chave; `externo` null.
 *   - Pix para outro banco: `conta` e' a conta de liquidacao (SPI), que recebe
 *     o CREDITO no ledger; `externo` e' o favorecido real, do contato salvo.
 */
export interface DestinoPix {
  conta: ContaPublica;
  externo: { nome: string; banco: string | null } | null;
}

/** O que o controller devolve: transacao + destino + saldo da origem. */
export interface ResultadoTransferencia {
  transacao: Transacao;
  destino: DestinoPix;
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
