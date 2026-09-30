import {
  centavosParaIso,
  ErroXmlInvalido,
  gerarPacs002,
  gerarPacs004,
  gerarPacs008,
  isoParaCentavos,
  lerXml,
} from './codec';
import {
  gerarEndToEndId,
  gerarMsgId,
  gerarReturnId,
  RE_END_TO_END_ID,
  RE_MSG_ID,
  RE_RETURN_ID,
} from './identificadores';
import type { PixOrdemPagamento } from './tipos';

const ISPB = '12345678';

const ordem = (): PixOrdemPagamento => ({
  messageId: gerarMsgId(ISPB),
  endToEndId: gerarEndToEndId(ISPB),
  createdAt: '2026-09-29T12:00:00.000Z',
  amount: { cents: 15075, currency: 'BRL' },
  debtor: {
    name: 'Maria & Filhos <LTDA>',
    document: '12345678901',
    ispb: ISPB,
    account: { number: '1234567', branch: '0001', type: 'CACC' },
  },
  creditor: {
    name: 'Loja Exemplo',
    document: '12345678000199',
    ispb: '87654321',
    account: { number: '00012345', branch: '0001', type: 'CACC' },
    dictKey: 'loja@exemplo.com',
  },
  remittanceInfo: 'Pedido 10293',
});

describe('identificadores ISO 20022', () => {
  it('gera EndToEndId, ReturnId e MsgId com 32 caracteres no formato', () => {
    const agora = new Date('2026-09-29T12:34:00Z');
    const e2e = gerarEndToEndId(ISPB, agora);
    const rtr = gerarReturnId(ISPB, agora);
    const msg = gerarMsgId(ISPB);

    expect(e2e).toHaveLength(32);
    expect(e2e.startsWith('E12345678202609291234')).toBe(true);
    expect(e2e).toMatch(RE_END_TO_END_ID);
    expect(rtr).toMatch(RE_RETURN_ID);
    expect(msg).toHaveLength(32);
    expect(msg).toMatch(RE_MSG_ID);
  });

  it('recusa ISPB invalido', () => {
    expect(() => gerarEndToEndId('123')).toThrow('ISPB invalido');
  });
});

describe('dinheiro no XML', () => {
  it('converte centavos <-> texto sem float', () => {
    expect(centavosParaIso(15075)).toBe('150.75');
    expect(centavosParaIso(5)).toBe('0.05');
    expect(centavosParaIso(100000000000)).toBe('1000000000.00');
    expect(isoParaCentavos('150.75')).toBe(15075);
    expect(isoParaCentavos('150.7')).toBe(15070);
    expect(isoParaCentavos('150')).toBe(15000);
  });

  it('recusa valor zero, negativo ou com 3 casas', () => {
    expect(() => centavosParaIso(0)).toThrow(ErroXmlInvalido);
    expect(() => isoParaCentavos('0.00')).toThrow(ErroXmlInvalido);
    expect(() => isoParaCentavos('-1.00')).toThrow(ErroXmlInvalido);
    expect(() => isoParaCentavos('1.001')).toThrow(ErroXmlInvalido);
  });
});

describe('pacs.008', () => {
  it('ida e volta preserva o canonico (inclusive zeros a esquerda e &)', () => {
    const o = ordem();
    const xml = gerarPacs008(o);

    expect(xml).toContain('urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08');
    expect(xml).toContain('<IntrBkSttlmAmt Ccy="BRL">150.75</IntrBkSttlmAmt>');
    expect(xml).toContain('Maria &amp; Filhos &lt;LTDA&gt;');

    const lido = lerXml(xml);
    expect(lido.tipo).toBe('pacs.008');
    expect(lido.mensagem).toEqual(o);
  });

  it('CNPJ vai em OrgId, CPF em PrvtId', () => {
    const xml = gerarPacs008(ordem());
    expect(xml).toMatch(/<PrvtId>\s*<Othr>\s*<Id>12345678901</);
    expect(xml).toMatch(/<OrgId>\s*<Othr>\s*<Id>12345678000199</);
  });

  it('recusa EndToEndId fora do formato', () => {
    const xml = gerarPacs008(ordem()).replace(
      /<EndToEndId>[^<]+/,
      '<EndToEndId>E123',
    );
    expect(() => lerXml(xml)).toThrow('EndToEndId fora do formato');
  });
});

describe('pacs.002', () => {
  it('ACCC de um pacs.008', () => {
    const e2e = gerarEndToEndId(ISPB);
    const s = {
      messageId: gerarMsgId('87654321'),
      originalMessageId: gerarMsgId(ISPB),
      originalMessageType: 'pacs.008' as const,
      endToEndId: e2e,
      status: 'ACCC' as const,
      acceptedAt: '2026-09-29T12:00:02.100Z',
      createdAt: '2026-09-29T12:00:02.300Z',
    };
    const lido = lerXml(gerarPacs002(s));
    expect(lido).toEqual({
      tipo: 'pacs.002',
      mensagem: { ...s, reasonCode: undefined },
    });
  });

  it('RJCT de um pacs.004 carrega o returnId e o motivo', () => {
    const rtr = gerarReturnId(ISPB);
    const xml = gerarPacs002({
      messageId: gerarMsgId('87654321'),
      originalMessageId: gerarMsgId(ISPB),
      originalMessageType: 'pacs.004',
      returnId: rtr,
      status: 'RJCT',
      reasonCode: 'AM02',
      createdAt: '2026-09-29T12:00:02.300Z',
    });
    const lido = lerXml(xml);
    expect(lido.tipo).toBe('pacs.002');
    if (lido.tipo !== 'pacs.002') return;
    expect(lido.mensagem.returnId).toBe(rtr);
    expect(lido.mensagem.endToEndId).toBeUndefined();
    expect(lido.mensagem.reasonCode).toBe('AM02');
  });

  it('RJCT sem motivo e' + "' invalido", () => {
    const xml = gerarPacs002({
      messageId: gerarMsgId(ISPB),
      originalMessageId: gerarMsgId(ISPB),
      originalMessageType: 'pacs.008',
      endToEndId: gerarEndToEndId(ISPB),
      status: 'RJCT',
      createdAt: '2026-09-29T12:00:02.300Z',
    });
    expect(() => lerXml(xml)).toThrow('RJCT sem StsRsnInf');
  });
});

describe('pacs.004', () => {
  it('ida e volta', () => {
    const d = {
      messageId: gerarMsgId(ISPB),
      returnId: gerarReturnId(ISPB),
      originalEndToEndId: gerarEndToEndId('87654321'),
      amount: { cents: 5000, currency: 'BRL' as const },
      reasonCode: 'MD06' as const,
      additionalInfo: 'Devolucao solicitada pelo cliente',
      createdAt: '2026-09-29T12:05:00.000Z',
    };
    expect(lerXml(gerarPacs004(d))).toEqual({ tipo: 'pacs.004', mensagem: d });
  });
});

it('mensagem desconhecida e XML quebrado sao ErroXmlInvalido', () => {
  expect(() => lerXml('<Document><camt.053/></Document>')).toThrow(
    ErroXmlInvalido,
  );
  expect(() => lerXml('isto nao e xml')).toThrow(ErroXmlInvalido);
});
