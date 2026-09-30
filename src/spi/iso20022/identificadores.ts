import { randomInt } from 'node:crypto';

/**
 * Identificadores ISO 20022 do SPI (mensageria.md, secao 7.1). Todos com 32
 * caracteres:
 *   EndToEndId  E + ISPB(8) + yyyyMMddHHmm(12) + 11 alfanumericos
 *   ReturnId    D + ISPB(8) + yyyyMMddHHmm(12) + 11 alfanumericos
 *   MsgId       M + ISPB(8) + 23 alfanumericos
 */
export const RE_END_TO_END_ID = /^E\d{8}\d{12}[A-Za-z0-9]{11}$/;
export const RE_RETURN_ID = /^D\d{8}\d{12}[A-Za-z0-9]{11}$/;
export const RE_MSG_ID = /^M\d{8}[A-Za-z0-9]{23}$/;
export const RE_ISPB = /^\d{8}$/;

const ALFANUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function aleatorio(tamanho: number): string {
  let s = '';
  for (let i = 0; i < tamanho; i++) s += ALFANUM[randomInt(ALFANUM.length)];
  return s;
}

/** yyyyMMddHHmm em UTC (o SPI trabalha em UTC). */
export function carimboUtc(data: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    data.getUTCFullYear().toString() +
    p(data.getUTCMonth() + 1) +
    p(data.getUTCDate()) +
    p(data.getUTCHours()) +
    p(data.getUTCMinutes())
  );
}

function exigirIspb(ispb: string): void {
  if (!RE_ISPB.test(ispb)) throw new Error(`ISPB invalido: ${ispb}`);
}

export function gerarEndToEndId(ispb: string, agora = new Date()): string {
  exigirIspb(ispb);
  return `E${ispb}${carimboUtc(agora)}${aleatorio(11)}`;
}

export function gerarReturnId(ispb: string, agora = new Date()): string {
  exigirIspb(ispb);
  return `D${ispb}${carimboUtc(agora)}${aleatorio(11)}`;
}

export function gerarMsgId(ispb: string): string {
  exigirIspb(ispb);
  return `M${ispb}${aleatorio(23)}`;
}
