/**
 * Modelo canonico interno (mensageria.md, secao 7.5). O SPI Adapter converte
 * XML <-> canonico; o resto do sistema NUNCA manipula XML.
 *
 * Dinheiro em centavos inteiros: nunca float.
 */
export interface Valor {
  cents: number;
  currency: 'BRL';
}

export type TipoContaIso = 'CACC' | 'SVGS' | 'SLRY' | 'TRAN';

export interface Parte {
  name: string;
  /** CPF (11) ou CNPJ (14). Opcional quando so a chave DICT e' conhecida. */
  document?: string;
  ispb: string;
  account: { number: string; branch: string; type: TipoContaIso };
  /** Chave Pix (DICT) usada para achar o recebedor. */
  dictKey?: string;
}

/** pacs.008 -- ordem de pagamento (FIToFICustomerCreditTransfer). */
export interface PixOrdemPagamento {
  messageId: string;
  endToEndId: string;
  createdAt: string;
  amount: Valor;
  debtor: Parte;
  creditor: Parte;
  remittanceInfo?: string;
}

export type StatusTransacaoIso = 'ACSP' | 'ACCC' | 'ACSC' | 'RJCT';

/** pacs.002 -- relatorio de status (FIToFIPaymentStatusReport). */
export interface PixStatusPagamento {
  messageId: string;
  originalMessageId: string;
  originalMessageType: 'pacs.008' | 'pacs.004';
  /** Presente quando responde a um pacs.008. */
  endToEndId?: string;
  /** Presente quando responde a um pacs.004. */
  returnId?: string;
  status: StatusTransacaoIso;
  /** Obrigatorio em RJCT. */
  reasonCode?: string;
  acceptedAt?: string;
  createdAt: string;
}

export const MOTIVOS_DEVOLUCAO = ['BE08', 'FR01', 'MD06', 'SL02'] as const;
export type MotivoDevolucao = (typeof MOTIVOS_DEVOLUCAO)[number];

/** pacs.004 -- devolucao (PaymentReturn). */
export interface PixDevolucaoIso {
  messageId: string;
  returnId: string;
  originalEndToEndId: string;
  amount: Valor;
  reasonCode: MotivoDevolucao;
  additionalInfo?: string;
  createdAt: string;
}

export type MensagemIso =
  | { tipo: 'pacs.008'; mensagem: PixOrdemPagamento }
  | { tipo: 'pacs.002'; mensagem: PixStatusPagamento }
  | { tipo: 'pacs.004'; mensagem: PixDevolucaoIso };

export type TipoMensagemIso = MensagemIso['tipo'];
