import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type PixDevolucao } from '@prisma/client';
import { paraDecimal, paraTexto, saldoCobre } from '../common/utils/dinheiro';
import { eConflitoDeUnico } from '../common/utils/prisma';
import { ContasService } from '../contas/contas.service';
import { OutboxService } from '../mensageria/outbox.service';
import { TOPICOS } from '../mensageria/topicos';
import { PrismaService } from '../prisma/prisma.service';
import { gerarMsgId, gerarReturnId } from '../spi/iso20022/identificadores';
import { EVENTO_SPI, type DadosMensagemSpi } from '../spi/spi.eventos';
import type {
  DevolucaoResponseDto,
  SolicitarDevolucaoDto,
} from './dto/devolucao.dto';
import {
  centavos,
  EVENTOS_PIX,
  registrarEventoPix,
  valorDoEvento,
} from './eventos-pix';
import { aceitaDevolucao } from './spi/estados';
import { lancarPartida, saldoComLock } from './spi/ledger-pix';

class RecusaDevolucao extends Error {
  constructor(
    readonly resposta: UnprocessableEntityException | ConflictException,
  ) {
    super(resposta.message);
  }
}

/**
 * Devolucao Pix de SAIDA (pacs.004): o cliente que RECEBEU um Pix de outro
 * banco devolve tudo ou parte.
 *
 * Mesmo desenho do Pix de saida: o dinheiro sai da conta do cliente JA (lock +
 * saldo recalculado + partida dobrada) e o pacs.004 vai pelo outbox. Se o SPI
 * rejeitar (pacs.002 RJCT), o consumidor estorna.
 */
@Injectable()
export class DevolucoesService {
  private readonly logger = new Logger(DevolucoesService.name);
  private readonly ispb: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly contas: ContasService,
    private readonly outbox: OutboxService,
    config: ConfigService,
  ) {
    this.ispb = config.get<string>('PIX_ISPB', '12345678');
  }

  /** @returns a devolucao e se ela foi criada agora (false = reenvio idempotente). */
  async solicitar(
    contaId: string,
    transacaoId: string,
    dto: SolicitarDevolucaoDto,
  ): Promise<{ devolucao: PixDevolucao; nova: boolean }> {
    const existente = await this.prisma.pixDevolucao.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
    });
    if (existente) return this.reenvio(existente, transacaoId);

    const original = await this.prisma.transacao.findFirst({
      where: { id: transacaoId, destinoId: contaId, direcaoSpi: 'RECEBIDO' },
    });
    if (!original) {
      throw new NotFoundException({
        codigo: 'PIX_NAO_DEVOLVIVEL',
        mensagem: 'Pix recebido de outro banco nao encontrado para esta conta',
      });
    }

    const valor = paraDecimal(dto.valor);
    const liquidacao = await this.contas.contaLiquidacaoPix();
    const returnId = gerarReturnId(this.ispb);

    try {
      const devolucao = await this.prisma.$transaction(
        async (tx) => {
          // Serializa devolucoes do mesmo Pix; depois a conta, para o saldo.
          const [atual] = await tx.$queryRaw<{ status_spi: string | null }[]>`
            SELECT status_spi FROM transacoes WHERE id = ${original.id} FOR UPDATE`;
          if (!aceitaDevolucao((atual?.status_spi ?? null) as never)) {
            throw new RecusaDevolucao(
              new ConflictException({
                codigo: 'PIX_NAO_DEVOLVIVEL',
                mensagem: `Pix em status ${atual?.status_spi} nao aceita devolucao`,
              }),
            );
          }

          const soma = await tx.pixDevolucao.aggregate({
            where: {
              transacaoOriginalId: original.id,
              direcao: 'ENVIADA',
              status: { not: 'REJEITADA' },
            },
            _sum: { valor: true },
          });
          const devolvivel = original.valor.sub(soma._sum.valor ?? 0);
          if (valor.greaterThan(devolvivel)) {
            throw new RecusaDevolucao(
              new UnprocessableEntityException({
                codigo: 'VALOR_EXCEDE_DEVOLVIVEL',
                mensagem: 'Valor maior que o saldo devolvivel deste Pix',
                devolvivel: paraTexto(devolvivel),
              }),
            );
          }

          const saldo = await saldoComLock(tx, contaId);
          if (!saldoCobre(saldo, valor)) {
            throw new RecusaDevolucao(
              new UnprocessableEntityException({
                codigo: 'SALDO_INSUFICIENTE',
                mensagem: 'Saldo insuficiente para devolver',
                saldo: paraTexto(saldo),
              }),
            );
          }

          const ledger = await lancarPartida(tx, {
            tipo: 'DEVOLUCAO',
            idempotencyKey: `devolucao:${returnId}`,
            origemId: contaId,
            destinoId: liquidacao.id,
            valor,
            descricaoDebito: `Devolucao Pix para ${original.pagadorNome ?? 'pagador'}`,
            descricaoCredito: `Liquidacao SPI: devolucao ${returnId}`,
          });

          const motivo = dto.motivo ?? 'MD06';
          const dev = await tx.pixDevolucao.create({
            data: {
              returnId,
              idempotencyKey: dto.idempotencyKey,
              transacaoOriginalId: original.id,
              transacaoLedgerId: ledger.id,
              direcao: 'ENVIADA',
              status: 'SOLICITADA',
              valor,
              motivo,
              infoAdicional: dto.infoAdicional ?? null,
            },
          });

          const comando = await this.outbox.registrar<DadosMensagemSpi>(tx, {
            topico: TOPICOS.SPI_SAIDA,
            chave: original.endToEndId!,
            eventType: EVENTO_SPI.COMANDO_ENVIAR,
            aggregateType: 'PixDevolucao',
            aggregateId: returnId,
            data: {
              tipo: 'pacs.004',
              mensagem: {
                messageId: gerarMsgId(this.ispb),
                returnId,
                originalEndToEndId: original.endToEndId!,
                amount: { cents: centavos(valor), currency: 'BRL' },
                reasonCode: motivo,
                additionalInfo: dto.infoAdicional,
                createdAt: new Date().toISOString(),
              },
            },
          });

          await registrarEventoPix(
            this.outbox,
            tx,
            EVENTOS_PIX.DEVOLUCAO_SOLICITADA,
            {
              contaId,
              transacaoId: original.id,
              endToEndId: original.endToEndId,
              status: original.statusSpi ?? 'RECEBIDO',
              direcao: 'RECEBIDO',
              ...valorDoEvento(valor),
              contraparte: {
                nome: original.pagadorNome ?? 'Pagador',
                banco: original.pagadorBanco,
              },
              devolucao: {
                id: dev.id,
                returnId,
                status: 'SOLICITADA',
                valor: paraTexto(valor),
                motivo,
              },
            },
            {
              correlationId: comando.correlationId,
              causationId: comando.eventId,
            },
          );

          return dev;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );

      this.logger.log(
        `Devolucao ${returnId} solicitada (${paraTexto(valor)}) do Pix ${original.endToEndId}`,
      );
      return { devolucao, nova: true };
    } catch (erro) {
      if (erro instanceof RecusaDevolucao) throw erro.resposta;
      if (eConflitoDeUnico(erro)) {
        const outra = await this.prisma.pixDevolucao.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
        });
        if (outra) return this.reenvio(outra, transacaoId);
      }
      throw erro;
    }
  }

  private reenvio(dev: PixDevolucao, transacaoId: string) {
    if (dev.transacaoOriginalId !== transacaoId) {
      throw new UnprocessableEntityException({
        codigo: 'IDEMPOTENCY_KEY_REUTILIZADA',
        mensagem: 'Esta idempotencyKey ja foi usada em outra devolucao',
      });
    }
    return { devolucao: dev, nova: false };
  }

  /** Devolucoes de um Pix em que a conta e' parte (pagador ou recebedor). */
  async listar(contaId: string, transacaoId: string): Promise<PixDevolucao[]> {
    const t = await this.prisma.transacao.findFirst({
      where: {
        id: transacaoId,
        OR: [{ origemId: contaId }, { destinoId: contaId }],
      },
      select: { id: true },
    });
    if (!t) throw new NotFoundException('Transacao nao encontrada');
    return this.prisma.pixDevolucao.findMany({
      where: { transacaoOriginalId: t.id },
      orderBy: { createdAt: 'asc' },
    });
  }

  static serializar(d: PixDevolucao): DevolucaoResponseDto {
    return {
      id: d.id,
      returnId: d.returnId,
      transacaoOriginalId: d.transacaoOriginalId,
      direcao: d.direcao,
      status: d.status,
      valor: paraTexto(d.valor),
      motivo: d.motivo,
      infoAdicional: d.infoAdicional,
      motivoRejeicao: d.motivoRejeicao,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
    };
  }
}
