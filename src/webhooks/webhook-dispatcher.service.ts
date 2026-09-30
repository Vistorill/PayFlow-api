import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { WebhookEntrega } from '@prisma/client';
import { Barramento } from '../mensageria/barramento';
import { ConsumidorService } from '../mensageria/consumidor.service';
import {
  criarEnvelope,
  headersDoEnvelope,
  type Envelope,
} from '../mensageria/envelope';
import { dlq, TOPICOS } from '../mensageria/topicos';
import { PrismaService } from '../prisma/prisma.service';
import {
  atrasoRetry,
  classificarResposta,
  FALHAS_PARA_SUSPENDER,
  MAX_TENTATIVAS,
  TIMEOUT_MS,
} from './politica-entrega';
import { UrlWebhookInvalida, validarDestino } from './ssrf';
import { cabecalhoAssinatura } from './webhook-cripto';
import { WebhookSegredosService } from './webhook-segredos.service';

/** Tempo que uma entrega fica "reservada" entre agendar e o dispatcher pegar. */
const LEASE_MS = 60_000;

export interface DadosDispatch {
  entregaId: string;
}

/**
 * Dispatcher de webhooks (mensageria.md, secao 5.4).
 *
 * A agenda de retry mora em `webhook_entregas.proxima_tentativa_em` (decisao
 * #4 do doc: scheduler em banco) e o Kafka (pix.webhooks.dispatch) distribui o
 * trabalho entre instancias, particionado por endpoint:
 *
 *   agendar  -> proxima_tentativa_em = agora + lease, publica {entregaId}
 *   consumir -> "claim" atomico (proxima_tentativa_em := null); se outro
 *               ja pegou, ignora. Faz o POST e grava o resultado.
 *   varredura-> a cada N s republica o que venceu (retries e mensagens perdidas).
 */
@Injectable()
export class WebhookDispatcherService
  implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(WebhookDispatcherService.name);
  private timer: NodeJS.Timeout | null = null;
  private varrendo = false;
  private readonly permitirInseguro: boolean;
  private readonly intervaloMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly barramento: Barramento,
    private readonly consumidor: ConsumidorService,
    private readonly segredos: WebhookSegredosService,
    config: ConfigService,
  ) {
    this.permitirInseguro = config.get('WEBHOOK_PERMITIR_INSEGURO') === 'true';
    this.intervaloMs = Number(config.get('WEBHOOK_VARREDURA_MS', 5_000));
  }

  async onModuleInit(): Promise<void> {
    await this.consumidor.assinar({
      grupo: 'webhooks-dispatcher',
      topicos: [TOPICOS.WEBHOOKS_DISPATCH],
      processar: (e) =>
        this.tentar((e as Envelope<DadosDispatch>).data.entregaId),
    });
  }

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.varrer(), this.intervaloMs);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Coloca a entrega na fila ja (entrega nova, teste, replay). */
  async agendarAgora(entregaId: string): Promise<void> {
    await this.prisma.webhookEntrega.update({
      where: { id: entregaId },
      data: { proximaTentativaEm: new Date(Date.now() + LEASE_MS) },
    });
    await this.publicar([entregaId]);
  }

  async publicar(entregaIds: string[]): Promise<void> {
    if (!entregaIds.length) return;
    const entregas = await this.prisma.webhookEntrega.findMany({
      where: { id: { in: entregaIds } },
      select: { id: true, endpointId: true },
    });
    await this.barramento.publicar(
      TOPICOS.WEBHOOKS_DISPATCH,
      entregas.map((e) => {
        const env = criarEnvelope<DadosDispatch>({
          eventType: 'webhook.dispatch',
          aggregateType: 'WebhookEntrega',
          aggregateId: e.id,
          data: { entregaId: e.id },
        });
        return {
          chave: e.endpointId,
          valor: JSON.stringify(env),
          headers: headersDoEnvelope(env),
        };
      }),
    );
  }

  /** Republica entregas vencidas, renovando o lease para nao duplicar. */
  async varrer(): Promise<void> {
    if (this.varrendo) return;
    this.varrendo = true;
    try {
      const vencidas = await this.prisma.webhookEntrega.findMany({
        where: {
          status: { in: ['PENDENTE', 'RETENTANDO'] },
          proximaTentativaEm: { lte: new Date() },
          endpoint: { status: 'ATIVO' },
        },
        select: { id: true, proximaTentativaEm: true },
        take: 200,
      });
      const reservadas: string[] = [];
      for (const v of vencidas) {
        const r = await this.prisma.webhookEntrega.updateMany({
          where: { id: v.id, proximaTentativaEm: v.proximaTentativaEm },
          data: { proximaTentativaEm: new Date(Date.now() + LEASE_MS) },
        });
        if (r.count) reservadas.push(v.id);
      }
      await this.publicar(reservadas);
    } catch (erro) {
      this.logger.warn(
        `Varredura de webhooks falhou: ${(erro as Error).message}`,
      );
    } finally {
      this.varrendo = false;
    }
  }

  /** Uma tentativa de entrega. */
  async tentar(entregaId: string): Promise<void> {
    // Claim: so um dispatcher passa daqui por agendamento.
    const claim = await this.prisma.webhookEntrega.updateMany({
      where: {
        id: entregaId,
        status: { in: ['PENDENTE', 'RETENTANDO'] },
        proximaTentativaEm: { not: null },
      },
      data: { proximaTentativaEm: null },
    });
    if (claim.count === 0) return;

    const entrega = await this.prisma.webhookEntrega.findUniqueOrThrow({
      where: { id: entregaId },
      include: { endpoint: true },
    });
    const endpoint = entrega.endpoint;
    if (endpoint.status !== 'ATIVO') {
      // Estaciona (sem agenda). Reativar o endpoint reagenda.
      this.logger.log(
        `Entrega ${entrega.id} estacionada: endpoint ${endpoint.status}`,
      );
      return;
    }

    const tentativa = entrega.tentativa + 1;
    const corpo = JSON.stringify(entrega.payload);
    const timestamp = Math.floor(Date.now() / 1000);

    let status: number | null = null;
    let erro: string | null = null;
    let retryAfter: string | null = null;
    try {
      await validarDestino(endpoint.url, this.permitirInseguro);
      const resposta = await fetch(endpoint.url, {
        method: 'POST',
        body: corpo,
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Cactvs-Webhooks/1.0',
          'X-Webhook-Id': entrega.eventoId,
          'X-Webhook-Delivery': entrega.id,
          'X-Webhook-Attempt': String(tentativa),
          'X-Webhook-Timestamp': String(timestamp),
          'X-Webhook-Signature': cabecalhoAssinatura(
            this.segredos.ativos(endpoint),
            timestamp,
            corpo,
          ),
        },
      });
      status = resposta.status;
      retryAfter = resposta.headers.get('retry-after');
      await resposta.body?.cancel().catch(() => undefined);
    } catch (e) {
      if (e instanceof UrlWebhookInvalida) {
        return this.finalizar(
          entrega,
          tentativa,
          'FALHA_PERMANENTE',
          null,
          e.message,
        );
      }
      erro =
        (e as Error).name === 'TimeoutError' ? 'timeout' : (e as Error).message;
    }

    switch (classificarResposta(status)) {
      case 'ENTREGUE':
        await this.prisma.$transaction([
          this.prisma.webhookEntrega.update({
            where: { id: entrega.id },
            data: {
              status: 'ENTREGUE',
              tentativa,
              ultimoHttpStatus: status,
              ultimoErro: null,
              entregueEm: new Date(),
            },
          }),
          this.prisma.webhookEndpoint.update({
            where: { id: endpoint.id },
            data: { falhasConsecutivas: 0 },
          }),
        ]);
        this.logger.log(
          `Webhook ${entrega.tipoEvento} entregue em ${endpoint.url} (${status})`,
        );
        return;
      case 'GONE':
        await this.prisma.webhookEndpoint.update({
          where: { id: endpoint.id },
          data: { status: 'SUSPENSO' },
        });
        return this.finalizar(
          entrega,
          tentativa,
          'FALHA_PERMANENTE',
          status,
          '410 Gone: endpoint suspenso',
        );
      case 'PERMANENTE':
        return this.finalizar(
          entrega,
          tentativa,
          'FALHA_PERMANENTE',
          status,
          erro ?? `HTTP ${status}`,
        );
      case 'RETENTAR':
        if (tentativa >= MAX_TENTATIVAS) {
          return this.finalizar(
            entrega,
            tentativa,
            'ESGOTADO',
            status,
            erro ?? `HTTP ${status}`,
          );
        }
        await this.prisma.webhookEntrega.update({
          where: { id: entrega.id },
          data: {
            status: 'RETENTANDO',
            tentativa,
            ultimoHttpStatus: status,
            ultimoErro: (erro ?? `HTTP ${status}`).slice(0, 500),
            proximaTentativaEm: new Date(
              Date.now() + atrasoRetry(tentativa, retryAfter),
            ),
          },
        });
        await this.contarFalha(endpoint.id);
        this.logger.warn(
          `Webhook ${entrega.id} falhou (${erro ?? status}); tentativa ${tentativa}/${MAX_TENTATIVAS}`,
        );
    }
  }

  /** Estado terminal de falha: registra, conta a falha e manda para a DLQ. */
  private async finalizar(
    entrega: WebhookEntrega,
    tentativa: number,
    status: 'ESGOTADO' | 'FALHA_PERMANENTE',
    httpStatus: number | null,
    erro: string,
  ): Promise<void> {
    await this.prisma.webhookEntrega.update({
      where: { id: entrega.id },
      data: {
        status,
        tentativa,
        ultimoHttpStatus: httpStatus,
        ultimoErro: erro.slice(0, 500),
        proximaTentativaEm: null,
      },
    });
    await this.contarFalha(entrega.endpointId);
    await this.barramento.publicar(dlq(TOPICOS.WEBHOOKS_DISPATCH), [
      {
        chave: entrega.endpointId,
        valor: JSON.stringify({
          entregaId: entrega.id,
          eventoId: entrega.eventoId,
          status,
          erro,
        }),
        headers: { 'dlq-erro': erro.slice(0, 500) },
      },
    ]);
    this.logger.error(
      `Webhook ${entrega.id} -> ${status} (${erro}); enviado para DLQ. Replay: POST /api/webhooks/entregas/${entrega.id}/replay`,
    );
  }

  /** Circuit breaker: falhas seguidas demais suspendem o endpoint. */
  private async contarFalha(endpointId: string): Promise<void> {
    const e = await this.prisma.webhookEndpoint.update({
      where: { id: endpointId },
      data: { falhasConsecutivas: { increment: 1 } },
    });
    if (e.status === 'ATIVO' && e.falhasConsecutivas >= FALHAS_PARA_SUSPENDER) {
      await this.prisma.webhookEndpoint.update({
        where: { id: endpointId },
        data: { status: 'SUSPENSO' },
      });
      // Em producao: e-mail ao dono do endpoint.
      this.logger.error(
        `Endpoint ${endpointId} SUSPENSO apos ${e.falhasConsecutivas} falhas seguidas`,
      );
    }
  }
}
