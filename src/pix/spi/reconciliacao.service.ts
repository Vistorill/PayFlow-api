import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ContasService } from '../../contas/contas.service';
import { OutboxService } from '../../mensageria/outbox.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SpiGateway } from '../../spi/spi.gateway';
import { EVENTOS_PIX, registrarEventoPix, valorDoEvento } from '../eventos-pix';
import { PixSpiService } from './pix-spi.service';

/**
 * Rede de seguranca para estado incerto (mensageria.md, secao 5.5).
 *
 *   ENVIADO sem pacs.002 ha mais de N s  -> RECONCILIANDO (+ pix.payment.timeout)
 *   RECONCILIANDO                         -> consulta o SPI:
 *        LIQUIDADO      -> aplica como ACCC
 *        REJEITADO      -> aplica como RJCT (estorna)
 *        NAO_ENCONTRADO -> depois da janela, RJCT AB03 (estorna)
 *        sem resposta   -> continua RECONCILIANDO
 *
 * Nunca reenvia com EndToEndId novo antes de confirmar: seria pagar duas vezes.
 */
@Injectable()
export class ReconciliacaoService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(ReconciliacaoService.name);
  private timer: NodeJS.Timeout | null = null;
  private rodando = false;
  private readonly aposSegundos: number;
  private readonly janelaNaoEncontradoSegundos: number;
  private readonly intervaloMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: SpiGateway,
    private readonly pixSpi: PixSpiService,
    private readonly contas: ContasService,
    private readonly outbox: OutboxService,
    config: ConfigService,
  ) {
    this.aposSegundos = Number(config.get('RECONCILIACAO_APOS_SEGUNDOS', 30));
    this.janelaNaoEncontradoSegundos = Number(
      config.get('RECONCILIACAO_JANELA_SEGUNDOS', 120),
    );
    this.intervaloMs = Number(config.get('RECONCILIACAO_INTERVALO_MS', 15_000));
  }

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.rodada(), this.intervaloMs);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async rodada(): Promise<void> {
    if (this.rodando) return;
    this.rodando = true;
    try {
      await this.marcarAtrasados();
      await this.consultarIncertos();
    } catch (erro) {
      this.logger.error(`Reconciliacao falhou: ${(erro as Error).message}`);
    } finally {
      this.rodando = false;
    }
  }

  private async marcarAtrasados(): Promise<void> {
    const limite = new Date(Date.now() - this.aposSegundos * 1000);
    // So ENVIADO. CRIADO parado = pacs.008 ainda no outbox (Kafka fora?): o
    // alerta e' de lag do outbox. Reconciliar ali poderia estornar um Pix que
    // o relay ainda vai enviar.
    const atrasados = await this.prisma.transacao.findMany({
      where: {
        direcaoSpi: 'ENVIADO',
        statusSpi: 'ENVIADO',
        updatedAt: { lt: limite },
      },
      take: 100,
    });
    for (const t of atrasados) {
      await this.prisma.$transaction(async (tx) => {
        const r = await tx.transacao.updateMany({
          where: { id: t.id, versao: t.versao },
          data: { statusSpi: 'RECONCILIANDO', versao: { increment: 1 } },
        });
        if (r.count === 0) return; // o pacs.002 chegou no meio: tudo certo
        await registrarEventoPix(this.outbox, tx, EVENTOS_PIX.TIMEOUT, {
          contaId: t.origemId,
          transacaoId: t.id,
          endToEndId: t.endToEndId,
          status: 'RECONCILIANDO',
          direcao: 'ENVIADO',
          ...valorDoEvento(t.valor),
          contraparte: {
            nome: t.favorecidoNome ?? 'Favorecido',
            banco: t.favorecidoBanco,
          },
        });
      });
      this.logger.warn(
        `Pix ${t.endToEndId} sem pacs.002 ha ${this.aposSegundos}s -> RECONCILIANDO`,
      );
    }
  }

  private async consultarIncertos(): Promise<void> {
    const incertos = await this.prisma.transacao.findMany({
      where: { statusSpi: 'RECONCILIANDO' },
      take: 100,
    });
    if (!incertos.length) return;
    const liquidacao = await this.contas.contaLiquidacaoPix();

    for (const t of incertos) {
      const r = await this.gateway.consultar(t.endToEndId!);
      if (!r) {
        this.logger.warn(
          `Pix ${t.endToEndId}: SPI sem resposta na consulta; segue RECONCILIANDO`,
        );
        continue;
      }
      if (r.situacao === 'NAO_ENCONTRADO') {
        const idade = (Date.now() - t.createdAt.getTime()) / 1000;
        if (idade < this.janelaNaoEncontradoSegundos) continue;
      }
      const status =
        r.situacao === 'LIQUIDADO'
          ? { status: 'ACCC' as const }
          : {
              status: 'RJCT' as const,
              reasonCode: r.situacao === 'REJEITADO' ? r.motivo : 'AB03',
            };

      await this.prisma.$transaction((tx) =>
        this.pixSpi.statusDePagamento(
          tx,
          { endToEndId: t.endToEndId!, ...status },
          liquidacao,
          { correlationId: t.id, causationId: `reconciliacao:${t.id}` },
        ),
      );
      this.logger.log(`Pix ${t.endToEndId} reconciliado: ${r.situacao}`);
    }
  }
}
