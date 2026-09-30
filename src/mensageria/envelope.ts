import { randomUUID } from 'node:crypto';

/**
 * Envelope padrao de TODO evento no barramento (mensageria.md, secao 4.1).
 * `eventId` e' o que a inbox usa para deduplicar.
 */
export interface Envelope<T = unknown> {
  eventId: string;
  eventType: string;
  eventVersion: number;
  occurredAt: string;
  correlationId: string;
  causationId: string | null;
  aggregateType: string;
  aggregateId: string;
  data: T;
}

export interface NovoEnvelope<T> {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  data: T;
  correlationId?: string;
  /** eventId do evento que causou este (rastreio da cadeia). */
  causationId?: string | null;
  eventVersion?: number;
}

export function criarEnvelope<T>(novo: NovoEnvelope<T>): Envelope<T> {
  const eventId = randomUUID();
  return {
    eventId,
    eventType: novo.eventType,
    eventVersion: novo.eventVersion ?? 1,
    occurredAt: new Date().toISOString(),
    correlationId: novo.correlationId ?? eventId,
    causationId: novo.causationId ?? null,
    aggregateType: novo.aggregateType,
    aggregateId: novo.aggregateId,
    data: novo.data,
  };
}

/** Headers Kafka derivados do envelope. */
export function headersDoEnvelope(e: Envelope): Record<string, string> {
  return {
    'event-type': e.eventType,
    'event-version': String(e.eventVersion),
    'correlation-id': e.correlationId,
    'content-type': 'application/json',
  };
}
