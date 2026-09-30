import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ConsumidorService } from '../mensageria/consumidor.service';
import type { Envelope } from '../mensageria/envelope';
import { InboxService } from '../mensageria/inbox.service';
import { TOPICOS } from '../mensageria/topicos';
import type { DadosEventoPix } from '../pix/eventos-pix';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookDispatcherService } from './webhook-dispatcher.service';

const CONSUMIDOR = 'webhooks';

/**
 * Consome os eventos de negocio e cria uma entrega por endpoint inscrito do
 * dono do evento. `UNIQUE(endpoint_id, evento_id)` + inbox: reentrega do Kafka
 * nunca gera webhook duplicado do nosso lado.
 */
@Injectable()
export class WebhookFanoutService implements OnModuleInit {
  private readonly logger = new Logger(WebhookFanoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly consumidor: ConsumidorService,
    private readonly inbox: InboxService,
    private readonly dispatcher: WebhookDispatcherService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.consumidor.assinar({
      grupo: CONSUMIDOR,
      topicos: [TOPICOS.PAGAMENTOS, TOPICOS.DEVOLUCOES],
      processar: (e) => this.distribuir(e as Envelope<DadosEventoPix>),
    });
  }

  async distribuir(evento: Envelope<DadosEventoPix>): Promise<void> {
    const criadas: string[] = [];

    await this.inbox.processarUmaVez(CONSUMIDOR, evento.eventId, async (tx) => {
      const endpoints = await tx.webhookEndpoint.findMany({
        where: {
          contaId: evento.data.contaId,
          status: { in: ['ATIVO', 'SUSPENSO'] },
        },
      });
      const inscritos = endpoints.filter((e) => {
        const eventos = e.eventos as string[];
        return eventos.includes('*') || eventos.includes(evento.eventType);
      });
      if (!inscritos.length) return;

      // O cliente recebe o evento sem o contaId interno (ele ja sabe quem e').
      const dados: Partial<DadosEventoPix> = { ...evento.data };
      delete dados.contaId;
      const payload = {
        id: evento.eventId,
        type: evento.eventType,
        createdAt: evento.occurredAt,
        data: dados,
      } as unknown as Prisma.InputJsonValue;

      for (const e of inscritos) {
        const entrega = await tx.webhookEntrega.create({
          data: {
            endpointId: e.id,
            eventoId: evento.eventId,
            tipoEvento: evento.eventType,
            payload,
            // Suspenso: fica registrado e parado ate o endpoint ser reativado.
            proximaTentativaEm:
              e.status === 'ATIVO' ? new Date(Date.now() + 60_000) : null,
          },
        });
        if (e.status === 'ATIVO') criadas.push(entrega.id);
      }
    });

    // Depois do commit. Se cair aqui, a varredura republica quando o lease vencer.
    if (criadas.length) {
      await this.dispatcher.publicar(criadas);
      this.logger.log(
        `${evento.eventType}: ${criadas.length} webhook(s) na fila`,
      );
    }
  }
}
