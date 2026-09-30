/**
 * Porta de comunicacao com o SPI (BACEN), direto via RSFN ou via PSP parceiro.
 * Hoje a unica implementacao e' o simulador (spi-simulador.ts); a conexao real
 * entra aqui sem mudar o adapter nem o core Pix.
 */
export type ResultadoConsultaSpi =
  | { situacao: 'LIQUIDADO' }
  | { situacao: 'REJEITADO'; motivo: string }
  | { situacao: 'NAO_ENCONTRADO' };

export type ReceptorXml = (xml: string) => Promise<void>;

export abstract class SpiGateway {
  /** Entrega um XML assinado ao SPI. Lanca se o SPI nao aceitou. */
  abstract enviar(xml: string): Promise<void>;

  /**
   * Consulta de status de um pagamento/devolucao (reconciliacao). null =
   * o SPI nao respondeu; o estado continua incerto.
   */
  abstract consultar(id: string): Promise<ResultadoConsultaSpi | null>;

  /** Registra quem recebe o que o SPI manda para nos (pull/push). */
  abstract aoReceber(receptor: ReceptorXml): void;
}
