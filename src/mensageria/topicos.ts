/**
 * Topicos Kafka (ver mensageria.md, secao 4). A chave de particao de tudo que
 * e' Pix e' o EndToEndId: pacs.008 -> pacs.002 -> pacs.004 do mesmo pagamento
 * caem na mesma particao e sao consumidos em ordem.
 */
export const TOPICOS = {
  /** Comandos para o SPI Adapter montar e enviar pacs.008 / pacs.004 / pacs.002. */
  SPI_SAIDA: 'pix.spi.outbound',
  /** Mensagens vindas do SPI (ja em modelo canonico) + confirmacoes de envio. */
  SPI_ENTRADA: 'pix.spi.inbound',
  /** Eventos de negocio de pagamento: webhooks, push, BI, antifraude. */
  PAGAMENTOS: 'pix.payments.events',
  /** Eventos de negocio de devolucao. */
  DEVOLUCOES: 'pix.returns.events',
  /** Uma entrega de webhook a tentar (chave = endpointId). */
  WEBHOOKS_DISPATCH: 'pix.webhooks.dispatch',
} as const;

export type Topico = (typeof TOPICOS)[keyof typeof TOPICOS];

/** Dead Letter Queue de um topico: mensagem que falhou de vez. */
export const dlq = (topico: string): string => `${topico}.dlq`;

/** Configuracao de criacao (particoes); replicacao vem do ambiente. */
export const CONFIG_TOPICOS: { topico: string; particoes: number }[] = [
  { topico: TOPICOS.SPI_SAIDA, particoes: 12 },
  { topico: TOPICOS.SPI_ENTRADA, particoes: 12 },
  { topico: TOPICOS.PAGAMENTOS, particoes: 12 },
  { topico: TOPICOS.DEVOLUCOES, particoes: 6 },
  { topico: TOPICOS.WEBHOOKS_DISPATCH, particoes: 12 },
  { topico: dlq(TOPICOS.SPI_SAIDA), particoes: 3 },
  { topico: dlq(TOPICOS.SPI_ENTRADA), particoes: 3 },
  { topico: dlq(TOPICOS.PAGAMENTOS), particoes: 3 },
  { topico: dlq(TOPICOS.DEVOLUCOES), particoes: 3 },
  { topico: dlq(TOPICOS.WEBHOOKS_DISPATCH), particoes: 3 },
];
