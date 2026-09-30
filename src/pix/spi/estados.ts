import type { StatusDevolucao, StatusSpi } from '@prisma/client';

/**
 * Maquinas de estado (mensageria.md, secao 6). Transicoes SO avancam: um
 * pacs.002 atrasado ou duplicado para um estado terminal e' ignorado.
 *
 * CRIADO -> LIQUIDADO/REJEITADO direto e' permitido: o pacs.002 pode chegar
 * antes do evento "enviado" ser consumido, e ele prova que o pacs.008 saiu.
 */
const TRANSICOES_PIX: Record<StatusSpi, readonly StatusSpi[]> = {
  CRIADO: ['ENVIADO', 'LIQUIDADO', 'REJEITADO'],
  ENVIADO: ['LIQUIDADO', 'REJEITADO', 'RECONCILIANDO'],
  RECONCILIANDO: ['LIQUIDADO', 'REJEITADO'],
  LIQUIDADO: ['DEVOLVIDO_PARCIAL', 'DEVOLVIDO'],
  RECEBIDO: ['DEVOLVIDO_PARCIAL', 'DEVOLVIDO'],
  DEVOLVIDO_PARCIAL: ['DEVOLVIDO_PARCIAL', 'DEVOLVIDO'],
  REJEITADO: [],
  DEVOLVIDO: [],
};

const TRANSICOES_DEVOLUCAO: Record<
  StatusDevolucao,
  readonly StatusDevolucao[]
> = {
  SOLICITADA: ['ENVIADA', 'LIQUIDADA', 'REJEITADA'],
  ENVIADA: ['LIQUIDADA', 'REJEITADA'],
  LIQUIDADA: [],
  REJEITADA: [],
};

export function podeTransitarPix(de: StatusSpi, para: StatusSpi): boolean {
  return TRANSICOES_PIX[de].includes(para);
}

export function podeTransitarDevolucao(
  de: StatusDevolucao,
  para: StatusDevolucao,
): boolean {
  return TRANSICOES_DEVOLUCAO[de].includes(para);
}

export function eTerminalPix(status: StatusSpi): boolean {
  return TRANSICOES_PIX[status].length === 0;
}

/** Pix que ainda aceita devolucao (pacs.004). */
export function aceitaDevolucao(status: StatusSpi | null): boolean {
  return status !== null && podeTransitarPix(status, 'DEVOLVIDO');
}
