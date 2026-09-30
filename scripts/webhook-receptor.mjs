// Receptor de webhook para DEMO: mostra cada evento e valida a assinatura HMAC.
//
//   SEGREDO=whsec_... node scripts/webhook-receptor.mjs
//
// Cadastre o endpoint com url "http://localhost:4010/hook" (exige
// WEBHOOK_PERMITIR_INSEGURO=true no .env -- so em dev).
// FALHAR=1 faz o receptor responder 503, para demonstrar o retry.
import http from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';

const SEGREDO = process.env.SEGREDO;
const PORTA = Number(process.env.PORTA ?? 4010);
const FALHAR = process.env.FALHAR === '1';
if (!SEGREDO) {
  console.error('Defina SEGREDO=whsec_... (devolvido ao cadastrar o endpoint)');
  process.exit(1);
}

const vistos = new Set();

function assinaturaValida(cabecalho, corpo) {
  const partes = cabecalho.split(',').map((p) => p.split('='));
  const t = Number(partes.find(([k]) => k === 't')?.[1]);
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const esperado = createHmac('sha256', SEGREDO).update(`${t}.${corpo}`).digest();
  return partes
    .filter(([k]) => k === 'v1')
    .some(([, v]) => {
      const b = Buffer.from(v ?? '', 'hex');
      return b.length === esperado.length && timingSafeEqual(b, esperado);
    });
}

http
  .createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => (corpo += c));
    req.on('end', () => {
      const hora = new Date().toLocaleTimeString('pt-BR');
      if (FALHAR) {
        console.log(`${hora}  503 (FALHAR=1) tentativa ${req.headers['x-webhook-attempt']}`);
        return res.writeHead(503).end();
      }
      const valida = assinaturaValida(req.headers['x-webhook-signature'] ?? '', corpo);
      if (!valida) {
        console.log(`${hora}  ✗ ASSINATURA INVALIDA -> 401`);
        return res.writeHead(401).end();
      }
      const evento = JSON.parse(corpo);
      const id = req.headers['x-webhook-id'];
      const duplicado = vistos.has(id);
      vistos.add(id);
      const d = evento.data ?? {};
      console.log(
        `${hora}  ✓ ${evento.type.padEnd(22)} ${String(d.status ?? '').padEnd(17)}` +
          ` R$ ${d.valor ?? '-'}  ${d.contraparte?.nome ?? ''}` +
          `  (tentativa ${req.headers['x-webhook-attempt']}${duplicado ? ', DUPLICADO ignorado' : ''})`,
      );
      res.writeHead(200).end();
    });
  })
  .listen(PORTA, () =>
    console.log(`Receptor de webhook em http://localhost:${PORTA}/hook${FALHAR ? ' (modo falha)' : ''}\n`),
  );
