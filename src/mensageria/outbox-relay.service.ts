import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { Barramento } from './barramento';
import { headersDoEnvelope, type Envelope } from './envelope';

interface LinhaOutbox {
  id: string;
  topico: string;
  chave: string;
  payload: unknown;
}

/**
 * Le `outbox_eventos` PENDENTE e publica no barramento (polling).
 *
 * `FOR UPDATE SKIP LOCKED` (MySQL 8+) deixa rodar varias instancias da API
 * sem publicar o mesmo evento duas vezes na mesma rodada: cada uma pega um
 * lote diferente. Se o Kafka cair, o lote volta a PENDENTE (rollback) e a
 * proxima rodada tenta de novo -- a API continua aceitando Pix normalmente.
 *
 * Reentrega ainda e' possivel (publicou e caiu antes do UPDATE); por isso
 * todo consumidor e' idempotente pela inbox.
 */
@Injectable()
export class OutboxRelayService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(OutboxRelayService.name);
  private timer: NodeJS.Timeout | null = null;
  private rodando = false;
  private readonly intervaloMs: number;
  private readonly lote: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly barramento: Barramento,
    config: ConfigService,
  ) {
    this.intervaloMs = Number(config.get('OUTBOX_INTERVALO_MS', 500));
    this.lote = Number(config.get('OUTBOX_LOTE', 100));
  }

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.rodada(), this.intervaloMs);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Publica um lote. Publico para testes e para forcar um flush. */
  async rodada(): Promise<number> {
    if (this.rodando) return 0;
    this.rodando = true;
    try {
      let total = 0;
      // Esvazia o backlog em lotes antes de devolver o controle ao timer.
      for (;;) {
        const publicados = await this.publicarLote();
        total += publicados;
        if (publicados < this.lote) return total;
      }
    } catch (erro) {
      this.logger.warn(
        `Outbox: publicacao adiada -- ${(erro as Error).message}`,
      );
      return 0;
    } finally {
      this.rodando = false;
    }
  }

  private async publicarLote(): Promise<number> {
    return this.prisma.$transaction(
      async (tx) => {
        const linhas = await tx.$queryRaw<LinhaOutbox[]>`
          SELECT id, topico, chave, payload
            FROM outbox_eventos
           WHERE status = 'PENDENTE'
           ORDER BY created_at
           LIMIT ${this.lote}
             FOR UPDATE SKIP LOCKED`;
        if (!linhas.length) return 0;

        // Agrupa por topico mantendo a ordem de criacao dentro de cada um.
        const porTopico = new Map<string, LinhaOutbox[]>();
        for (const l of linhas) {
          porTopico.set(l.topico, [...(porTopico.get(l.topico) ?? []), l]);
        }

        for (const [topico, eventos] of porTopico) {
          await this.barramento.publicar(
            topico,
            eventos.map((e) => {
              const envelope = (
                typeof e.payload === 'string'
                  ? JSON.parse(e.payload)
                  : e.payload
              ) as Envelope;
              return {
                chave: e.chave,
                valor: JSON.stringify(envelope),
                headers: headersDoEnvelope(envelope),
              };
            }),
          );
        }

        await tx.outboxEvento.updateMany({
          where: { id: { in: linhas.map((l) => l.id) } },
          data: { status: 'PUBLICADO', publicadoEm: new Date() },
        });
        return linhas.length;
      },
      { timeout: 30_000 },
    );
  }
}
