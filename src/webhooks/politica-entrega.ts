/** Politica de entrega (mensageria.md, secao 8.4). */
export const MAX_TENTATIVAS = 7;
export const FALHAS_PARA_SUSPENDER = 20;
export const TIMEOUT_MS = 5_000;

/** Espera ANTES da tentativa n+1, em segundos: 1m, 5m, 30m, 2h, 6h, 24h. */
const ESPERAS_S = [60, 300, 1_800, 7_200, 21_600, 86_400];

export type Classificacao = 'ENTREGUE' | 'RETENTAR' | 'PERMANENTE' | 'GONE';

/** `null` = sem resposta HTTP (timeout, conexao recusada, DNS). */
export function classificarResposta(status: number | null): Classificacao {
  if (status === null) return 'RETENTAR';
  if (status >= 200 && status < 300) return 'ENTREGUE';
  if (status === 410) return 'GONE';
  if (status === 408 || status === 429 || status >= 500) return 'RETENTAR';
  // 3xx (nao seguimos redirect) e demais 4xx: o cliente precisa corrigir.
  return 'PERMANENTE';
}

/**
 * Atraso ate a proxima tentativa, depois da tentativa `tentativa` (1-based).
 * Jitter de +-20% espalha a rajada quando um endpoint volta do ar. Retry-After
 * (segundos) do cliente tem precedencia, limitado a 24h.
 */
export function atrasoRetry(
  tentativa: number,
  retryAfter: string | null,
): number {
  const pedido = retryAfter !== null ? Number(retryAfter) : NaN;
  if (Number.isFinite(pedido) && pedido >= 0) {
    return Math.min(pedido, 86_400) * 1000;
  }
  const base = ESPERAS_S[Math.min(tentativa, ESPERAS_S.length) - 1] * 1000;
  const jitter = 1 + (Math.random() * 0.4 - 0.2);
  return Math.round(base * jitter);
}
