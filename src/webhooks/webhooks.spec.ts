import {
  assinar,
  cabecalhoAssinatura,
  chaveDeCifra,
  cifrar,
  decifrar,
  gerarSegredo,
  verificarAssinatura,
} from './webhook-cripto';
import { atrasoRetry, classificarResposta } from './politica-entrega';
import {
  ipPrivado,
  UrlWebhookInvalida,
  validarDestino,
  validarFormatoUrl,
} from './ssrf';

describe('assinatura HMAC de webhook', () => {
  const segredo = 'whsec_teste';
  const corpo = '{"id":"evt_1","type":"pix.payment.settled"}';

  it('segue t.body com HMAC-SHA256 hex', () => {
    const v1 = assinar(segredo, 1790683203, corpo);
    expect(v1).toMatch(/^[0-9a-f]{64}$/);
    expect(cabecalhoAssinatura([segredo], 1790683203, corpo)).toBe(
      `t=1790683203,v1=${v1}`,
    );
  });

  it('cliente verifica e recusa corpo alterado ou timestamp velho', () => {
    const agora = 1790683203;
    const cab = cabecalhoAssinatura([segredo], agora, corpo);
    expect(verificarAssinatura(segredo, cab, corpo, agora)).toBe(true);
    expect(verificarAssinatura(segredo, cab, corpo + ' ', agora)).toBe(false);
    expect(verificarAssinatura('outro', cab, corpo, agora)).toBe(false);
    expect(verificarAssinatura(segredo, cab, corpo, agora + 301)).toBe(false);
  });

  it('na rotacao, as duas assinaturas vao juntas e ambas verificam', () => {
    const novo = gerarSegredo();
    const cab = cabecalhoAssinatura([novo, segredo], 100, corpo);
    expect(verificarAssinatura(novo, cab, corpo, 100)).toBe(true);
    expect(verificarAssinatura(segredo, cab, corpo, 100)).toBe(true);
  });
});

describe('cifra do segredo em repouso', () => {
  it('AES-GCM ida e volta; adulteracao falha', () => {
    const chave = chaveDeCifra(undefined, 'jwt-secret');
    const pacote = cifrar(chave, 'whsec_abc');
    expect(pacote).not.toContain('whsec_abc');
    expect(decifrar(chave, pacote)).toBe('whsec_abc');
    const [iv, tag, c] = pacote.split('.');
    expect(() =>
      decifrar(chave, [iv, tag, c.slice(0, -2) + 'AA'].join('.')),
    ).toThrow();
  });

  it('exige 32 bytes na chave explicita', () => {
    expect(() =>
      chaveDeCifra(Buffer.alloc(16).toString('base64'), 'x'),
    ).toThrow('32 bytes');
  });
});

describe('SSRF', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.0.10',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
  ])('%s e privado', (ip) => expect(ipPrivado(ip)).toBe(true));

  it.each(['8.8.8.8', '200.160.2.3', '2001:4860:4860::8888'])(
    '%s e publico',
    (ip) => expect(ipPrivado(ip)).toBe(false),
  );

  it('so https, sem credenciais', () => {
    expect(() => validarFormatoUrl('http://cliente.com/hook', false)).toThrow(
      UrlWebhookInvalida,
    );
    expect(() =>
      validarFormatoUrl('https://u:p@cliente.com/hook', false),
    ).toThrow(UrlWebhookInvalida);
    expect(validarFormatoUrl('https://cliente.com/hook', false).hostname).toBe(
      'cliente.com',
    );
    expect(validarFormatoUrl('http://localhost:4000/hook', true).hostname).toBe(
      'localhost',
    );
  });

  it('recusa IP interno literal no envio', async () => {
    await expect(
      validarDestino('https://169.254.169.254/latest', false),
    ).rejects.toThrow('rede interna');
    await expect(validarDestino('https://[::1]/x', false)).rejects.toThrow(
      'rede interna',
    );
  });
});

describe('politica de entrega', () => {
  it('classifica respostas', () => {
    expect(classificarResposta(200)).toBe('ENTREGUE');
    expect(classificarResposta(204)).toBe('ENTREGUE');
    expect(classificarResposta(400)).toBe('PERMANENTE');
    expect(classificarResposta(301)).toBe('PERMANENTE');
    expect(classificarResposta(410)).toBe('GONE');
    expect(classificarResposta(408)).toBe('RETENTAR');
    expect(classificarResposta(429)).toBe('RETENTAR');
    expect(classificarResposta(503)).toBe('RETENTAR');
    expect(classificarResposta(null)).toBe('RETENTAR');
  });

  it('backoff 1m 5m 30m 2h 6h 24h com jitter de 20%, e Retry-After manda', () => {
    const base = [60, 300, 1800, 7200, 21600, 86400];
    base.forEach((s, i) => {
      const ms = atrasoRetry(i + 1, null);
      expect(ms).toBeGreaterThanOrEqual(s * 1000 * 0.8);
      expect(ms).toBeLessThanOrEqual(s * 1000 * 1.2);
    });
    expect(atrasoRetry(1, '120')).toBe(120_000);
  });
});
