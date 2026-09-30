import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Protecao SSRF das URLs de webhook (mensageria.md, secao 8.1): sem ela,
 * qualquer cliente cadastraria http://169.254.169.254/ ou http://localhost:3306
 * e usaria nosso servidor para varrer a rede interna.
 *
 * A validacao roda no cadastro E em cada envio (o DNS pode mudar depois).
 */
export class UrlWebhookInvalida extends Error {}

function ipv4Privado(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local / metadata de nuvem
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multicast e reservado
  );
}

function ipv6Privado(ip: string): boolean {
  const x = ip.toLowerCase();
  if (x === '::' || x === '::1') return true;
  if (x.startsWith('::ffff:')) return ipv4Privado(x.slice(7));
  return (
    x.startsWith('fc') ||
    x.startsWith('fd') || // ULA
    x.startsWith('fe8') ||
    x.startsWith('fe9') ||
    x.startsWith('fea') ||
    x.startsWith('feb') || // link-local
    x.startsWith('ff') // multicast
  );
}

export function ipPrivado(ip: string): boolean {
  const versao = isIP(ip);
  if (versao === 4) return ipv4Privado(ip);
  if (versao === 6) return ipv6Privado(ip);
  return true;
}

/**
 * Checagem sincrona de formato. `permitirInseguro` (so dev) aceita http e
 * localhost, para testar com um receptor local.
 */
export function validarFormatoUrl(url: string, permitirInseguro: boolean): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new UrlWebhookInvalida('URL invalida');
  }
  if (
    u.protocol !== 'https:' &&
    !(permitirInseguro && u.protocol === 'http:')
  ) {
    throw new UrlWebhookInvalida('A URL do webhook precisa ser https');
  }
  if (u.username || u.password) {
    throw new UrlWebhookInvalida('A URL nao pode conter credenciais');
  }
  return u;
}

/** Resolve o host e recusa se QUALQUER endereco for privado. */
export async function validarDestino(
  url: string,
  permitirInseguro: boolean,
): Promise<void> {
  const u = validarFormatoUrl(url, permitirInseguro);
  if (permitirInseguro) return;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const enderecos = isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true }).catch(() => {
        throw new UrlWebhookInvalida(`Nao foi possivel resolver ${host}`);
      });
  if (!enderecos.length || enderecos.some((e) => ipPrivado(e.address))) {
    throw new UrlWebhookInvalida('A URL aponta para uma rede interna/privada');
  }
}
