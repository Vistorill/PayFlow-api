import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { criarEnvelope, type Envelope, type NovoEnvelope } from './envelope';

export type Tx = Prisma.TransactionClient;

export interface NovoEventoOutbox<T> extends NovoEnvelope<T> {
  topico: string;
  /** Chave de particao. Pix: endToEndId. Webhook: endpointId. */
  chave: string;
}

/**
 * Transactional Outbox (mensageria.md, secao 3.1).
 *
 * `registrar` recebe o `tx` de proposito: o evento so existe se a transacao de
 * negocio commitar, e a transacao so commita com o evento gravado. Publicar no
 * Kafka dentro da request abriria as duas falhas classicas -- "gravou e nao
 * publicou" e "publicou e deu rollback".
 */
@Injectable()
export class OutboxService {
  async registrar<T>(tx: Tx, novo: NovoEventoOutbox<T>): Promise<Envelope<T>> {
    const envelope = criarEnvelope(novo);
    await tx.outboxEvento.create({
      data: {
        id: envelope.eventId,
        aggregateId: envelope.aggregateId,
        topico: novo.topico,
        chave: novo.chave,
        tipoEvento: envelope.eventType,
        payload: envelope as unknown as Prisma.InputJsonValue,
      },
    });
    return envelope;
  }
}
