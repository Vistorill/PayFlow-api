import type { Transacao } from '@prisma/client';
import { somenteDigitos } from '../../common/utils/cpf';
import type { ContaPublica } from '../../contas/contas.types';
import { gerarMsgId } from '../../spi/iso20022/identificadores';
import type {
  PixOrdemPagamento,
  PixStatusPagamento,
  StatusTransacaoIso,
} from '../../spi/iso20022/tipos';
import { centavos } from '../eventos-pix';

/** Numero de conta exibido ao SPI: derivado do id, estavel, sem expor o uuid inteiro. */
export const numeroConta = (contaId: string): string =>
  contaId.replace(/-/g, '').slice(0, 12);

/** pacs.008 de SAIDA a partir de um Pix nosso para outro banco. */
export function montarOrdemPagamento(
  t: Transacao,
  origem: ContaPublica,
  ispb: string,
  ispbContraparte: string,
): PixOrdemPagamento {
  const cpfOrigem = somenteDigitos(origem.cpfMasked);
  // A chave CPF identifica o documento do recebedor; e-mail/celular nao.
  const cpfRecebedor =
    t.tipoChave === 'CPF' && t.chaveDestino
      ? somenteDigitos(t.chaveDestino)
      : undefined;
  return {
    messageId: gerarMsgId(ispb),
    endToEndId: t.endToEndId!,
    createdAt: new Date().toISOString(),
    amount: { cents: centavos(t.valor), currency: 'BRL' },
    debtor: {
      name: origem.nome,
      document: cpfOrigem.length === 11 ? cpfOrigem : undefined,
      ispb,
      account: { number: numeroConta(origem.id), branch: '0001', type: 'CACC' },
    },
    creditor: {
      name: t.favorecidoNome ?? 'Favorecido',
      document: cpfRecebedor,
      ispb: ispbContraparte,
      // Conta real do recebedor viria da consulta ao DICT.
      account: { number: '0', branch: '0001', type: 'TRAN' },
      dictKey: t.chaveDestino ?? undefined,
    },
    remittanceInfo: undefined,
  };
}

/** pacs.002 de resposta a um pacs.008 ou pacs.004 que RECEBEMOS. */
export function montarStatus(
  ispb: string,
  original: { messageId: string; tipo: 'pacs.008' | 'pacs.004'; id: string },
  status: StatusTransacaoIso,
  reasonCode?: string,
): PixStatusPagamento {
  const agora = new Date().toISOString();
  return {
    messageId: gerarMsgId(ispb),
    originalMessageId: original.messageId,
    originalMessageType: original.tipo,
    ...(original.tipo === 'pacs.004'
      ? { returnId: original.id }
      : { endToEndId: original.id }),
    status,
    reasonCode: status === 'RJCT' ? reasonCode : undefined,
    acceptedAt: status === 'RJCT' ? undefined : agora,
    createdAt: agora,
  };
}
