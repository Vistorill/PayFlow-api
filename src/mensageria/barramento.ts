/**
 * Porta do barramento de mensagens. O resto do sistema so conhece isto:
 * trocar Kafka por memoria (dev/teste) e' uma variavel de ambiente
 * (MENSAGERIA_DRIVER), sem tocar em nenhum produtor ou consumidor.
 */
export interface MensagemBarramento {
  chave: string;
  valor: string;
  headers?: Record<string, string>;
}

export interface MensagemRecebida extends MensagemBarramento {
  topico: string;
  particao: number;
  offset: string;
}

export type Manipulador = (mensagem: MensagemRecebida) => Promise<void>;

export interface Assinatura {
  /** Consumer group: cada grupo recebe TODAS as mensagens do topico. */
  grupo: string;
  topicos: string[];
  manipulador: Manipulador;
}

export abstract class Barramento {
  abstract publicar(
    topico: string,
    mensagens: MensagemBarramento[],
  ): Promise<void>;

  /**
   * Registra um consumidor. O offset so e' confirmado depois que o
   * manipulador resolve: se ele lancar, a mensagem volta (at-least-once).
   */
  abstract assinar(assinatura: Assinatura): Promise<void>;
}
