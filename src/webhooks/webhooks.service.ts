import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma, WebhookEndpoint, WebhookEntrega } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import type {
  AtualizarWebhookDto,
  CriarWebhookDto,
  ListarEntregasQuery,
  WebhookEndpointDto,
} from './dto/webhooks.dto';
import { UrlWebhookInvalida, validarDestino } from './ssrf';
import { gerarSegredo } from './webhook-cripto';
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import { WebhookSegredosService } from './webhook-segredos.service';

/** Por quanto tempo o segredo antigo continua assinando depois da rotacao. */
const JANELA_ROTACAO_MS = 24 * 60 * 60 * 1000;

/**
 * Endpoint Manager: CRUD de endpoints, rotacao de segredo, teste e replay.
 * Tenant = conta: cada cliente so enxerga e so recebe os proprios eventos.
 */
@Injectable()
export class WebhooksService {
  private readonly permitirInseguro: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatcher: WebhookDispatcherService,
    private readonly segredos: WebhookSegredosService,
    config: ConfigService,
  ) {
    this.permitirInseguro = config.get('WEBHOOK_PERMITIR_INSEGURO') === 'true';
  }

  async criar(
    contaId: string,
    dto: CriarWebhookDto,
  ): Promise<WebhookEndpointDto> {
    await this.validarUrl(dto.url);
    const segredo = gerarSegredo();
    const e = await this.prisma.webhookEndpoint.create({
      data: {
        contaId,
        url: dto.url,
        descricao: dto.descricao ?? null,
        eventos: dto.eventos,
        segredoCifrado: this.segredos.cifrar(segredo),
      },
    });
    return { ...this.serializar(e), segredo };
  }

  async listar(contaId: string): Promise<WebhookEndpointDto[]> {
    const lista = await this.prisma.webhookEndpoint.findMany({
      where: { contaId },
      orderBy: { createdAt: 'desc' },
    });
    return lista.map((e) => this.serializar(e));
  }

  async detalhe(contaId: string, id: string): Promise<WebhookEndpointDto> {
    return this.serializar(await this.doDono(contaId, id));
  }

  async atualizar(
    contaId: string,
    id: string,
    dto: AtualizarWebhookDto,
  ): Promise<WebhookEndpointDto> {
    const atual = await this.doDono(contaId, id);
    if (dto.url) await this.validarUrl(dto.url);
    const reativando = dto.status === 'ATIVO' && atual.status !== 'ATIVO';

    const e = await this.prisma.webhookEndpoint.update({
      where: { id },
      data: {
        url: dto.url,
        eventos: dto.eventos,
        descricao: dto.descricao,
        status: dto.status,
        falhasConsecutivas: reativando ? 0 : undefined,
      },
    });

    if (reativando) {
      // Entregas estacionadas enquanto o endpoint estava suspenso voltam a fila.
      await this.prisma.webhookEntrega.updateMany({
        where: { endpointId: id, status: { in: ['PENDENTE', 'RETENTANDO'] } },
        data: { proximaTentativaEm: new Date() },
      });
    }
    return this.serializar(e);
  }

  async remover(contaId: string, id: string): Promise<void> {
    await this.doDono(contaId, id);
    await this.prisma.webhookEndpoint.delete({ where: { id } });
  }

  /** Novo segredo; o antigo continua assinando por 24h (duas assinaturas). */
  async rotacionarSegredo(
    contaId: string,
    id: string,
  ): Promise<WebhookEndpointDto> {
    const atual = await this.doDono(contaId, id);
    const segredo = gerarSegredo();
    const e = await this.prisma.webhookEndpoint.update({
      where: { id },
      data: {
        segredoCifrado: this.segredos.cifrar(segredo),
        segredoAnteriorCifrado: atual.segredoCifrado,
        segredoAnteriorAte: new Date(Date.now() + JANELA_ROTACAO_MS),
      },
    });
    return { ...this.serializar(e), segredo };
  }

  /** Dispara um evento `webhook.test` para o endpoint. */
  async testar(contaId: string, id: string): Promise<WebhookEntrega> {
    await this.doDono(contaId, id);
    const eventoId = randomUUID();
    const entrega = await this.prisma.webhookEntrega.create({
      data: {
        endpointId: id,
        eventoId,
        tipoEvento: 'webhook.test',
        payload: {
          id: eventoId,
          type: 'webhook.test',
          createdAt: new Date().toISOString(),
          data: { mensagem: 'Teste de webhook Cactvs' },
        },
      },
    });
    await this.dispatcher.agendarAgora(entrega.id);
    return entrega;
  }

  async entregas(
    contaId: string,
    q: ListarEntregasQuery,
  ): Promise<WebhookEntrega[]> {
    return this.prisma.webhookEntrega.findMany({
      where: {
        endpoint: { contaId },
        endpointId: q.endpointId,
        status: q.status,
      },
      orderBy: { createdAt: 'desc' },
      take: q.take,
    });
  }

  /** Reprocessa uma entrega (inclusive das que foram para a DLQ). */
  async replay(contaId: string, entregaId: string): Promise<WebhookEntrega> {
    const e = await this.prisma.webhookEntrega.findFirst({
      where: { id: entregaId, endpoint: { contaId } },
    });
    if (!e) throw new NotFoundException('Entrega nao encontrada');
    const atualizada = await this.prisma.webhookEntrega.update({
      where: { id: e.id },
      data: {
        status: 'PENDENTE',
        tentativa: 0,
        ultimoErro: null,
        ultimoHttpStatus: null,
      },
    });
    await this.dispatcher.agendarAgora(e.id);
    return atualizada;
  }

  private async validarUrl(url: string): Promise<void> {
    try {
      await validarDestino(url, this.permitirInseguro);
    } catch (erro) {
      if (erro instanceof UrlWebhookInvalida) {
        throw new BadRequestException({
          codigo: 'URL_WEBHOOK_INVALIDA',
          mensagem: erro.message,
        });
      }
      throw erro;
    }
  }

  private async doDono(contaId: string, id: string): Promise<WebhookEndpoint> {
    const e = await this.prisma.webhookEndpoint.findFirst({
      where: { id, contaId },
    });
    if (!e) throw new NotFoundException('Endpoint nao encontrado');
    return e;
  }

  private serializar(e: WebhookEndpoint): WebhookEndpointDto {
    return {
      id: e.id,
      url: e.url,
      descricao: e.descricao,
      eventos: e.eventos as Prisma.JsonArray as string[],
      status: e.status,
      falhasConsecutivas: e.falhasConsecutivas,
      createdAt: e.createdAt.toISOString(),
    };
  }
}
