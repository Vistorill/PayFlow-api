import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Segredo de webhook: gerado aqui, mostrado ao cliente UMA vez, guardado
 * cifrado (AES-256-GCM). Precisa ser reversivel -- e' com ele que assinamos
 * cada entrega -- por isso cifra, e nao hash.
 */
export function gerarSegredo(): string {
  return `whsec_${randomBytes(32).toString('base64url')}`;
}

/** Chave de 32 bytes a partir de WEBHOOK_CHAVE_CIFRA (base64) ou derivada. */
export function chaveDeCifra(
  base64: string | undefined,
  fallback: string,
): Buffer {
  if (base64) {
    const chave = Buffer.from(base64, 'base64');
    if (chave.length !== 32) {
      throw new Error('WEBHOOK_CHAVE_CIFRA deve ter 32 bytes em base64');
    }
    return chave;
  }
  return createHash('sha256').update(`webhook:${fallback}`).digest();
}

/** "iv.tag.cifrado" em base64url. */
export function cifrar(chave: Buffer, texto: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', chave, iv);
  const cifrado = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), cifrado]
    .map((b) => b.toString('base64url'))
    .join('.');
}

export function decifrar(chave: Buffer, pacote: string): string {
  const [iv, tag, cifrado] = pacote
    .split('.')
    .map((p) => Buffer.from(p, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', chave, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(cifrado), decipher.final()]).toString(
    'utf8',
  );
}

/**
 * Assinatura (mensageria.md, secao 8.3):
 *   signed_payload = timestamp + "." + raw_body
 *   v1 = HMAC_SHA256(secret, signed_payload) em hex
 */
export function assinar(
  segredo: string,
  timestamp: number,
  corpo: string,
): string {
  return createHmac('sha256', segredo)
    .update(`${timestamp}.${corpo}`)
    .digest('hex');
}

/**
 * "t=<ts>,v1=<assinatura>[,v1=<assinatura com o segredo anterior>]". Durante a
 * rotacao vao as duas, para o cliente trocar o segredo sem janela de falha.
 */
export function cabecalhoAssinatura(
  segredos: string[],
  timestamp: number,
  corpo: string,
): string {
  return [
    `t=${timestamp}`,
    ...segredos.map((s) => `v1=${assinar(s, timestamp, corpo)}`),
  ].join(',');
}

/**
 * Verificacao do lado do CLIENTE (referencia para a documentacao e testes):
 * tolerancia anti-replay + comparacao em tempo constante.
 */
export function verificarAssinatura(
  segredo: string,
  cabecalho: string,
  corpo: string,
  agoraSegundos = Math.floor(Date.now() / 1000),
  toleranciaSegundos = 300,
): boolean {
  const partes = cabecalho.split(',').map((p) => p.trim().split('='));
  const t = Number(partes.find(([k]) => k === 't')?.[1]);
  if (!Number.isFinite(t) || Math.abs(agoraSegundos - t) > toleranciaSegundos)
    return false;
  const esperado = Buffer.from(assinar(segredo, t, corpo), 'hex');
  return partes
    .filter(([k]) => k === 'v1')
    .some(([, v]) => {
      const recebido = Buffer.from(v ?? '', 'hex');
      return (
        recebido.length === esperado.length &&
        timingSafeEqual(recebido, esperado)
      );
    });
}
