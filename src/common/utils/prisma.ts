import { Prisma } from '@prisma/client';

/**
 * Violacao de indice UNIQUE (Prisma P2002).
 *
 * Este e' o unico lugar do codigo que sabe identificar esse erro, porque ele
 * e' a garantia real de unicidade contra concorrencia -- tanto no cadastro de
 * CPF/email quanto na chave de idempotencia do Pix.
 *
 * Um SELECT antes do INSERT NAO substitui isto: duas requisicoes simultaneas
 * veriam "nao existe" e as duas gravariam. O indice e' que serializa.
 */
export function eConflitoDeUnico(erro: unknown): boolean {
  return (
    erro instanceof Prisma.PrismaClientKnownRequestError &&
    erro.code === 'P2002'
  );
}

/** Nome da coluna que estourou o UNIQUE, quando o driver informa. */
export function colunaEmConflito(erro: unknown): string | undefined {
  if (!eConflitoDeUnico(erro)) return undefined;

  const alvo = (erro as { meta?: { target?: unknown } }).meta?.target;
  if (typeof alvo === 'string') return alvo;
  if (Array.isArray(alvo)) return alvo.join(', ');

  return undefined;
}
