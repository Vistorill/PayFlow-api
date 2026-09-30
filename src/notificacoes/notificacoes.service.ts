import {
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import type { Notificacao, PlataformaDispositivo } from '@prisma/client';
import { ConsumidorService } from '../mensageria/consumidor.service';
import type { Envelope } from '../mensageria/envelope';
import { InboxService } from '../mensageria/inbox.service';
import { TOPICOS } from '../mensageria/topicos';
import type { DadosEventoPix } from '../pix/eventos-pix';
import { PrismaService } from '../prisma/prisma.service';
import { textoNotificacao } from './mensagens';
import { PushProvider } from './push/push.provider';

const CONSUMIDOR = 'notificacoes';

/**
 * Notificacoes do app mobile.
 *
 * Consome pix.payments.events / pix.returns.events: grava na caixa de
 * notificacoes (idempotente por evento) e manda push para os dispositivos
 * ativos da conta. O push e' "melhor esforco" -- se falhar, a notificacao
 * continua na caixa e o app a mostra no proximo GET.
 */
@Injectable()
export class NotificacoesService implements OnModuleInit {
  private readonly logger = new Logger(NotificacoesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly consumidor: ConsumidorService,
    private readonly inbox: InboxService,
    private readonly push: PushProvider,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.consumidor.assinar({
      grupo: CONSUMIDOR,
      topicos: [TOPICOS.PAGAMENTOS, TOPICOS.DEVOLUCOES],
      processar: (e) => this.notificar(e as Envelope<DadosEventoPix>),
    });
  }

  async notificar(evento: Envelope<DadosEventoPix>): Promise<void> {
    const texto = textoNotificacao(evento.eventType, evento.data);
    if (!texto) return;

    const alvo: { criada?: Notificacao } = {};
    await this.inbox.processarUmaVez(CONSUMIDOR, evento.eventId, async (tx) => {
      alvo.criada = await tx.notificacao.create({
        data: {
          contaId: evento.data.contaId,
          eventoId: evento.eventId,
          tipo: evento.eventType,
          titulo: texto.titulo,
          corpo: texto.corpo,
          dados: {
            transacaoId: evento.data.transacaoId,
            endToEndId: evento.data.endToEndId,
            status: evento.data.status,
            valor: evento.data.valor,
            devolucaoId: evento.data.devolucao?.id ?? null,
          },
        },
      });
    });
    if (alvo.criada) await this.enviarPush(alvo.criada);
  }

  private async enviarPush(n: Notificacao): Promise<void> {
    const dispositivos = await this.prisma.dispositivoPush.findMany({
      where: { contaId: n.contaId, ativo: true },
      select: { token: true },
    });
    if (!dispositivos.length) return;
    try {
      const r = await this.push.enviar(
        dispositivos.map((d) => d.token),
        {
          titulo: n.titulo,
          corpo: n.corpo,
          // O app abre a tela certa ao tocar na notificacao.
          dados: { notificacaoId: n.id, tipo: n.tipo, ...(n.dados as object) },
        },
      );
      if (r.tokensInvalidos.length) {
        await this.prisma.dispositivoPush.updateMany({
          where: { token: { in: r.tokensInvalidos } },
          data: { ativo: false },
        });
      }
    } catch (erro) {
      this.logger.warn(
        `Push da notificacao ${n.id} falhou: ${(erro as Error).message}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // API do app
  // -------------------------------------------------------------------------

  /**
   * Registra (ou move) o token do aparelho para a conta logada. Um token e' de
   * um aparelho: se outro usuario logar nele, o token passa para a nova conta.
   */
  registrarDispositivo(
    contaId: string,
    token: string,
    plataforma: PlataformaDispositivo,
  ) {
    return this.prisma.dispositivoPush.upsert({
      where: { token },
      create: { contaId, token, plataforma },
      update: { contaId, plataforma, ativo: true },
    });
  }

  async removerDispositivo(contaId: string, token: string): Promise<void> {
    await this.prisma.dispositivoPush.updateMany({
      where: { contaId, token },
      data: { ativo: false },
    });
  }

  async listar(contaId: string, naoLidas: boolean, take: number, skip: number) {
    const where = { contaId, ...(naoLidas ? { lidaEm: null } : {}) };
    const [itens, total, naoLidasTotal] = await Promise.all([
      this.prisma.notificacao.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.notificacao.count({ where }),
      this.prisma.notificacao.count({ where: { contaId, lidaEm: null } }),
    ]);
    return { itens, total, naoLidas: naoLidasTotal, take, skip };
  }

  async marcarLida(contaId: string, id: string): Promise<Notificacao> {
    const n = await this.prisma.notificacao.findFirst({
      where: { id, contaId },
    });
    if (!n) throw new NotFoundException('Notificacao nao encontrada');
    if (n.lidaEm) return n;
    return this.prisma.notificacao.update({
      where: { id },
      data: { lidaEm: new Date() },
    });
  }

  async marcarTodasLidas(contaId: string): Promise<{ atualizadas: number }> {
    const r = await this.prisma.notificacao.updateMany({
      where: { contaId, lidaEm: null },
      data: { lidaEm: new Date() },
    });
    return { atualizadas: r.count };
  }
}
