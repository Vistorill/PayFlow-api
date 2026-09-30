import type { MensagemIso, TipoMensagemIso } from './iso20022/tipos';

/** eventType dos envelopes em pix.spi.outbound / pix.spi.inbound. */
export const EVENTO_SPI = {
  /** pix.spi.outbound: "monte, assine e envie esta mensagem ao SPI". */
  COMANDO_ENVIAR: 'spi.comando.enviar',
  /** pix.spi.inbound: o adapter confirmou a entrega de uma mensagem nossa. */
  ENVIADA: 'spi.mensagem.enviada',
  /** pix.spi.inbound: chegou uma mensagem do SPI (ja em canonico). */
  RECEBIDA: 'spi.mensagem.recebida',
} as const;

/** data de spi.comando.enviar e spi.mensagem.recebida. */
export type DadosMensagemSpi = MensagemIso;

/** data de spi.mensagem.enviada. */
export interface DadosMensagemEnviada {
  tipo: TipoMensagemIso;
  messageId: string;
  endToEndId?: string;
  returnId?: string;
  enviadaEm: string;
}

/**
 * Identificadores de negocio de uma mensagem e a chave de particao. Tudo que
 * e' do mesmo pagamento usa o EndToEndId; resposta a devolucao usa o ReturnId.
 */
export function idsDaMensagem(m: MensagemIso): {
  endToEndId?: string;
  returnId?: string;
  chave: string;
} {
  switch (m.tipo) {
    case 'pacs.008':
      return {
        endToEndId: m.mensagem.endToEndId,
        chave: m.mensagem.endToEndId,
      };
    case 'pacs.004':
      return {
        endToEndId: m.mensagem.originalEndToEndId,
        returnId: m.mensagem.returnId,
        chave: m.mensagem.originalEndToEndId,
      };
    case 'pacs.002': {
      const { endToEndId, returnId } = m.mensagem;
      return { endToEndId, returnId, chave: (endToEndId ?? returnId)! };
    }
  }
}
