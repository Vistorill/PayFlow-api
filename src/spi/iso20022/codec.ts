import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import {
  RE_END_TO_END_ID,
  RE_ISPB,
  RE_MSG_ID,
  RE_RETURN_ID,
} from './identificadores';
import {
  MOTIVOS_DEVOLUCAO,
  type MensagemIso,
  type MotivoDevolucao,
  type Parte,
  type PixDevolucaoIso,
  type PixOrdemPagamento,
  type PixStatusPagamento,
  type StatusTransacaoIso,
  type TipoContaIso,
  type Valor,
} from './tipos';

/**
 * Codec XML ISO 20022 <-> modelo canonico para pacs.008, pacs.002 e pacs.004.
 *
 * AVISO: estrutura SIMPLIFICADA para desenvolvimento (mensageria.md, secao 7).
 * A fonte da verdade sao os XSDs e o Manual de Interfaces do SPI vigentes; em
 * homologacao, valide cada XML gerado contra o XSD e assine (XMLDSig) com o
 * certificado ICP-Brasil do PSP.
 */

export const NAMESPACES = {
  'pacs.008': 'urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08',
  'pacs.002': 'urn:iso:std:iso:20022:tech:xsd:pacs.002.001.10',
  'pacs.004': 'urn:iso:std:iso:20022:tech:xsd:pacs.004.001.09',
} as const;

export class ErroXmlInvalido extends Error {
  constructor(mensagem: string) {
    super(`XML ISO 20022 invalido: ${mensagem}`);
    this.name = 'ErroXmlInvalido';
  }
}

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  suppressEmptyNode: true,
  // Escapa & < > " ' nos textos: nome de cliente com "&" nao quebra o XML.
  processEntities: true,
});

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  // Tudo como texto: "00012345" e "12345678901" nao podem virar numero.
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

// ---------------------------------------------------------------------------
// Dinheiro
// ---------------------------------------------------------------------------

/** 15075 -> "150.75", sem passar por float. */
export function centavosParaIso(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    throw new ErroXmlInvalido(`valor em centavos invalido: ${cents}`);
  }
  return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/** "150.75" -> 15075. Aceita "150", "150.7", "150.75". */
export function isoParaCentavos(texto: string): number {
  const m = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(texto ?? '');
  if (!m) throw new ErroXmlInvalido(`valor invalido: "${texto}"`);
  const cents = Number(m[1]) * 100 + Number((m[2] ?? '0').padEnd(2, '0'));
  if (cents <= 0) throw new ErroXmlInvalido('valor deve ser positivo');
  return cents;
}

function valorXml(v: Valor) {
  return { '#text': centavosParaIso(v.cents), '@_Ccy': v.currency };
}

// ---------------------------------------------------------------------------
// Partes (pagador / recebedor)
// ---------------------------------------------------------------------------

function parteXml(p: Parte) {
  const id =
    p.document === undefined
      ? undefined
      : p.document.length === 14
        ? { OrgId: { Othr: { Id: p.document } } }
        : { PrvtId: { Othr: { Id: p.document } } };
  return {
    pessoa: { Nm: p.name, Id: id },
    conta: {
      Id: { Othr: { Id: p.account.number, Issr: p.account.branch } },
      Tp: { Cd: p.account.type },
      Prxy: p.dictKey ? { Id: p.dictKey } : undefined,
    },
    agente: { FinInstnId: { ClrSysMmbId: { MmbId: p.ispb } } },
  };
}

// ---------------------------------------------------------------------------
// Geracao
// ---------------------------------------------------------------------------

function documento(tipo: keyof typeof NAMESPACES, corpo: object): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    builder.build({ Document: { '@_xmlns': NAMESPACES[tipo], ...corpo } })
  );
}

export function gerarPacs008(o: PixOrdemPagamento): string {
  const dbtr = parteXml(o.debtor);
  const cdtr = parteXml(o.creditor);
  return documento('pacs.008', {
    FIToFICstmrCdtTrf: {
      GrpHdr: {
        MsgId: o.messageId,
        CreDtTm: o.createdAt,
        NbOfTxs: '1',
        SttlmInf: { SttlmMtd: 'CLRG' },
      },
      CdtTrfTxInf: {
        PmtId: { EndToEndId: o.endToEndId },
        IntrBkSttlmAmt: valorXml(o.amount),
        AccptncDtTm: o.createdAt,
        ChrgBr: 'SLEV',
        Dbtr: dbtr.pessoa,
        DbtrAcct: dbtr.conta,
        DbtrAgt: dbtr.agente,
        CdtrAgt: cdtr.agente,
        Cdtr: cdtr.pessoa,
        CdtrAcct: cdtr.conta,
        RmtInf: o.remittanceInfo ? { Ustrd: o.remittanceInfo } : undefined,
      },
    },
  });
}

export function gerarPacs002(s: PixStatusPagamento): string {
  return documento('pacs.002', {
    FIToFIPmtStsRpt: {
      GrpHdr: { MsgId: s.messageId, CreDtTm: s.createdAt },
      OrgnlGrpInfAndSts: {
        OrgnlMsgId: s.originalMessageId,
        OrgnlMsgNmId:
          s.originalMessageType === 'pacs.008'
            ? 'pacs.008.001.08'
            : 'pacs.004.001.09',
      },
      TxInfAndSts: {
        // Resposta a devolucao: o id original e' o RtrId (prefixo D).
        OrgnlEndToEndId: s.returnId ?? s.endToEndId,
        TxSts: s.status,
        StsRsnInf:
          s.status === 'RJCT' ? { Rsn: { Prtry: s.reasonCode } } : undefined,
        AccptncDtTm: s.acceptedAt,
      },
    },
  });
}

export function gerarPacs004(d: PixDevolucaoIso): string {
  return documento('pacs.004', {
    PmtRtr: {
      GrpHdr: {
        MsgId: d.messageId,
        CreDtTm: d.createdAt,
        NbOfTxs: '1',
        SttlmInf: { SttlmMtd: 'CLRG' },
      },
      TxInf: {
        RtrId: d.returnId,
        OrgnlEndToEndId: d.originalEndToEndId,
        RtrdIntrBkSttlmAmt: valorXml(d.amount),
        ChrgBr: 'SLEV',
        RtrRsnInf: {
          Rsn: { Cd: d.reasonCode },
          AddtlInf: d.additionalInfo,
        },
      },
    },
  });
}

export function gerarXml(m: MensagemIso): string {
  switch (m.tipo) {
    case 'pacs.008':
      return gerarPacs008(m.mensagem);
    case 'pacs.002':
      return gerarPacs002(m.mensagem);
    case 'pacs.004':
      return gerarPacs004(m.mensagem);
  }
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

type No = Record<string, unknown>;

function no(pai: unknown, caminho: string): unknown {
  let atual: unknown = pai;
  for (const parte of caminho.split('/')) {
    if (atual === null || typeof atual !== 'object') return undefined;
    atual = (atual as No)[parte];
  }
  return atual;
}

function texto(pai: unknown, caminho: string): string | undefined {
  const v = no(pai, caminho);
  if (v === undefined || v === null) return undefined;
  const valor = typeof v === 'object' ? (v as No)['#text'] : v;
  // parseTagValue=false: folhas sao sempre texto.
  return typeof valor === 'string' ? valor : undefined;
}

function exigir(pai: unknown, caminho: string): string {
  const v = texto(pai, caminho);
  if (v === undefined || v === '') {
    throw new ErroXmlInvalido(`campo obrigatorio ausente: ${caminho}`);
  }
  return v;
}

function conferir(re: RegExp, valor: string, campo: string): string {
  if (!re.test(valor))
    throw new ErroXmlInvalido(`${campo} fora do formato: ${valor}`);
  return valor;
}

function lerValor(pai: unknown, caminho: string): Valor {
  const moeda = texto(pai, `${caminho}/@_Ccy`);
  if (moeda !== 'BRL')
    throw new ErroXmlInvalido(`moeda nao suportada: ${moeda}`);
  return { cents: isoParaCentavos(exigir(pai, caminho)), currency: 'BRL' };
}

function lerParte(
  tx: unknown,
  pessoa: string,
  conta: string,
  agente: string,
): Parte {
  const tipo = (texto(tx, `${conta}/Tp/Cd`) ?? 'CACC') as TipoContaIso;
  if (!['CACC', 'SVGS', 'SLRY', 'TRAN'].includes(tipo)) {
    throw new ErroXmlInvalido(`tipo de conta invalido: ${tipo}`);
  }
  return {
    name: exigir(tx, `${pessoa}/Nm`),
    document:
      texto(tx, `${pessoa}/Id/PrvtId/Othr/Id`) ??
      texto(tx, `${pessoa}/Id/OrgId/Othr/Id`),
    ispb: conferir(
      RE_ISPB,
      exigir(tx, `${agente}/FinInstnId/ClrSysMmbId/MmbId`),
      `${agente} ISPB`,
    ),
    account: {
      number: exigir(tx, `${conta}/Id/Othr/Id`),
      branch: texto(tx, `${conta}/Id/Othr/Issr`) ?? '0001',
      type: tipo,
    },
    dictKey: texto(tx, `${conta}/Prxy/Id`),
  };
}

function lerPacs008(raiz: unknown): PixOrdemPagamento {
  const tx = no(raiz, 'CdtTrfTxInf');
  if (Array.isArray(tx))
    throw new ErroXmlInvalido('so 1 transacao por mensagem');
  return {
    messageId: conferir(RE_MSG_ID, exigir(raiz, 'GrpHdr/MsgId'), 'MsgId'),
    createdAt: exigir(raiz, 'GrpHdr/CreDtTm'),
    endToEndId: conferir(
      RE_END_TO_END_ID,
      exigir(tx, 'PmtId/EndToEndId'),
      'EndToEndId',
    ),
    amount: lerValor(tx, 'IntrBkSttlmAmt'),
    debtor: lerParte(tx, 'Dbtr', 'DbtrAcct', 'DbtrAgt'),
    creditor: lerParte(tx, 'Cdtr', 'CdtrAcct', 'CdtrAgt'),
    remittanceInfo: texto(tx, 'RmtInf/Ustrd'),
  };
}

function lerPacs002(raiz: unknown): PixStatusPagamento {
  const tx = no(raiz, 'TxInfAndSts');
  const status = exigir(tx, 'TxSts') as StatusTransacaoIso;
  if (!['ACSP', 'ACCC', 'ACSC', 'RJCT'].includes(status)) {
    throw new ErroXmlInvalido(`TxSts desconhecido: ${status}`);
  }
  const nome = exigir(raiz, 'OrgnlGrpInfAndSts/OrgnlMsgNmId');
  const originalMessageType = nome.startsWith('pacs.004')
    ? 'pacs.004'
    : 'pacs.008';
  const idOriginal = exigir(tx, 'OrgnlEndToEndId');
  const reasonCode =
    texto(tx, 'StsRsnInf/Rsn/Prtry') ?? texto(tx, 'StsRsnInf/Rsn/Cd');
  if (status === 'RJCT' && !reasonCode) {
    throw new ErroXmlInvalido('RJCT sem StsRsnInf');
  }
  return {
    messageId: conferir(RE_MSG_ID, exigir(raiz, 'GrpHdr/MsgId'), 'MsgId'),
    createdAt: exigir(raiz, 'GrpHdr/CreDtTm'),
    originalMessageId: exigir(raiz, 'OrgnlGrpInfAndSts/OrgnlMsgId'),
    originalMessageType,
    ...(originalMessageType === 'pacs.004'
      ? { returnId: conferir(RE_RETURN_ID, idOriginal, 'RtrId original') }
      : {
          endToEndId: conferir(RE_END_TO_END_ID, idOriginal, 'OrgnlEndToEndId'),
        }),
    status,
    reasonCode: status === 'RJCT' ? reasonCode : undefined,
    acceptedAt: texto(tx, 'AccptncDtTm'),
  };
}

function lerPacs004(raiz: unknown): PixDevolucaoIso {
  const tx = no(raiz, 'TxInf');
  const motivo = exigir(tx, 'RtrRsnInf/Rsn/Cd');
  if (!MOTIVOS_DEVOLUCAO.includes(motivo as MotivoDevolucao)) {
    throw new ErroXmlInvalido(`motivo de devolucao desconhecido: ${motivo}`);
  }
  return {
    messageId: conferir(RE_MSG_ID, exigir(raiz, 'GrpHdr/MsgId'), 'MsgId'),
    createdAt: exigir(raiz, 'GrpHdr/CreDtTm'),
    returnId: conferir(RE_RETURN_ID, exigir(tx, 'RtrId'), 'RtrId'),
    originalEndToEndId: conferir(
      RE_END_TO_END_ID,
      exigir(tx, 'OrgnlEndToEndId'),
      'OrgnlEndToEndId',
    ),
    amount: lerValor(tx, 'RtrdIntrBkSttlmAmt'),
    reasonCode: motivo as MotivoDevolucao,
    additionalInfo: texto(tx, 'RtrRsnInf/AddtlInf'),
  };
}

/** Detecta o tipo pela raiz do Document e devolve o canonico validado. */
export function lerXml(xml: string): MensagemIso {
  let doc: unknown;
  try {
    doc = parser.parse(xml, true);
  } catch (erro) {
    throw new ErroXmlInvalido((erro as Error).message);
  }
  const documento = no(doc, 'Document');
  if (!documento || typeof documento !== 'object') {
    throw new ErroXmlInvalido('raiz <Document> ausente');
  }
  if ('FIToFICstmrCdtTrf' in documento) {
    return {
      tipo: 'pacs.008',
      mensagem: lerPacs008(no(documento, 'FIToFICstmrCdtTrf')),
    };
  }
  if ('FIToFIPmtStsRpt' in documento) {
    return {
      tipo: 'pacs.002',
      mensagem: lerPacs002(no(documento, 'FIToFIPmtStsRpt')),
    };
  }
  if ('PmtRtr' in documento) {
    return { tipo: 'pacs.004', mensagem: lerPacs004(no(documento, 'PmtRtr')) };
  }
  throw new ErroXmlInvalido(
    'mensagem nao suportada (esperado pacs.008/002/004)',
  );
}
