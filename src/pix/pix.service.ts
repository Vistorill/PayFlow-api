import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, type Transacao } from '@prisma/client';
import {
  saldoCobre,
  saldoDoLedger,
  paraDecimal,
  paraTexto,
  type Dinheiro,
} from '../common/utils/dinheiro';
import { eConflitoDeUnico } from '../common/utils/prisma';
import { ContasService } from '../contas/contas.service';
import type { ContaPublica } from '../contas/contas.types';
import { PrismaService } from '../prisma/prisma.service';
import { TransferirDto } from './dto/transferir.dto';
import type { ReenvioIdempotente, ResultadoTransferencia } from './pix.types';

/**
 * Sinal interno, nunca vaza para o controller: distingue "a transacao foi
 * recusada por saldo" de "algo quebrou". Precisa ser lancado DE DENTRO da
 * transacao do banco para que o rollback aconteca, e reconhecido DEPOIS,
 * fora dela, para persistir o status FALHA.
 */
class SaldoInsuficienteError extends Error {
  constructor(
    readonly saldo: Dinheiro,
    readonly valor: Dinheiro,
  ) {
    super('saldo insuficiente');
  }
}

/**
 * Modulo Pix. Aqui -- e SO aqui -- existem lock de linha, checagem de saldo e
 * a escrita no ledger. O resto do sistema le.
 *
 * O fluxo segue as 4 fases do desenho:
 *   A. Validacao    -- antes de tocar em dinheiro
 *   B. Idempotencia -- a barreira anti-duplicidade, ANTES de debitar
 *   C. Contabil     -- lock, recalcular saldo, regra de negocio, partida dobrada
 */
@Injectable()
export class PixService {
  private readonly logger = new Logger(PixService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contasService: ContasService,
  ) {}

  /**
   * @returns resultado da transferencia, ou `undefined` + sinal de reenvio
   *          quando a chave ja foi usada antes.
   */
  async transferir(
    contaIdOrigem: string,
    dto: TransferirDto,
  ): Promise<ResultadoTransferencia | ReenvioIdempotente> {
    const valor = paraDecimal(dto.valor);

    // ------------------------------------------------------------------
    // Fase A -- Validacao. Nada de dinheiro foi tocado ate aqui.
    // ------------------------------------------------------------------
    // A origem vem do token. Se viesse do body, qualquer um pagaria pela
    // conta alheia so trocando um campo no curl.
    const origem = await this.contasService.detalhe(contaIdOrigem);

    const destino = await this.contasService.buscarPorChavePix(
      dto.chaveDestino,
    );
    if (!destino) {
      throw new NotFoundException('Chave Pix de destino nao encontrada');
    }

    if (destino.id === origem.id) {
      throw new UnprocessableEntityException({
        codigo: 'DESTINO_IGUAL_ORIGEM',
        mensagem: 'O destino nao pode ser a propria conta de origem',
      });
    }

    // ------------------------------------------------------------------
    // Fase B -- Idempotencia.
    // ------------------------------------------------------------------
    const intencao = await this.registrarIntencao(
      dto.idempotencyKey,
      origem.id,
      destino.id,
      valor,
    );

    if (intencao.replay) {
      return this.tratarReenvio(intencao.transacao, destino);
    }

    // ------------------------------------------------------------------
    // Fase C -- A transacao contabil.
    // ------------------------------------------------------------------
    await this.movimentar(intencao.transacao, origem, destino, valor);

    return this.montarResultado(intencao.transacao, destino);
  }

  // -------------------------------------------------------------------------
  // Fase B
  // -------------------------------------------------------------------------

  /**
   * A intencao de pagamento entra em `transacoes` ANTES de qualquer debito.
   * Status PENDENTE: existe a intencao, o dinheiro ainda nao andou.
   *
   * O indice UNIQUE de `idempotency_key` e' o que impede duplicidade. Se ele
   * estoura, alguem ja fez essa requisicao -- e a resposta certa NAO e' erro,
   * e' devolver a transacao que ja existe. E por isso que o INSERT vem antes
   * do lock: se viesse depois, duas requisicoes simultaneas passariam pelas
   * validacoes e uma delas so bateria no indice depois de mover dinheiro.
   */
  private async registrarIntencao(
    idempotencyKey: string,
    origemId: string,
    destinoId: string,
    valor: Dinheiro,
  ): Promise<{ transacao: Transacao; replay: boolean }> {
    try {
      const transacao = await this.prisma.transacao.create({
        data: {
          idempotencyKey,
          tipo: 'PIX',
          status: 'PENDENTE',
          valor,
          origemId,
          destinoId,
        },
      });

      return { transacao, replay: false };
    } catch (erro) {
      if (!eConflitoDeUnico(erro)) throw erro;

      const existente = await this.prisma.transacao.findUnique({
        where: { idempotencyKey },
      });

      // Sem isto, o indice estourou por outro motivo e o erro real sumiria.
      if (!existente) throw erro;

      this.logger.log(
        `Reenvio idempotente: chave ${idempotencyKey} ja usada pela transacao ${existente.id} (status ${existente.status})`,
      );

      return { transacao: existente, replay: true };
    }
  }

  /**
   * Reenvio com a MESMA chave. Nao cria nada e nao debita de novo.
   *
   * Tres casos:
   *   - CONCLUIDA: devolve o mesmo resultado com 200. O cliente pediu, foi feito.
   *   - PENDENTE: a request original ainda esta em voo. 409 + "reenvie em
   *     instantes" -- prometer sucesso aqui seria mentir sobre o dinheiro.
   *   - FALHA: devolve 422 com o mesmo codigo de erro da primeira tentativa,
   *     para o front tratar as duas respostas igual.
   */
  private async tratarReenvio(
    transacao: Transacao,
    destino: ContaPublica,
  ): Promise<ReenvioIdempotente> {
    if (transacao.status === 'PENDENTE') {
      throw new ConflictException({
        codigo: 'TRANSACAO_EM_PROCESSAMENTO',
        mensagem:
          'Uma requisicao com esta idempotencyKey ainda esta em andamento. ' +
          'Reenvie em instantes com a MESMA chave.',
        transacaoId: transacao.id,
      });
    }

    if (transacao.status === 'FALHA') {
      throw new UnprocessableEntityException({
        codigo: 'TRANSACAO_ANTERIOR_FALHOU',
        mensagem:
          'Esta idempotencyKey ja foi usada e a transferencia anterior falhou. ' +
          'Gere uma nova chave para tentar de novo.',
        transacaoId: transacao.id,
      });
    }

    return {
      emProcessamento: false,
      resultado: await this.montarResultado(transacao, destino),
    };
  }

  // -------------------------------------------------------------------------
  // Fase C
  // -------------------------------------------------------------------------

  /**
   * BEGIN
   *   SELECT ... FOR UPDATE na conta de origem
   *   recalcula o saldo a partir do ledger
   *   saldo >= valor?
   *     nao  -> lanca (ROLLBACK) e a transacao vira FALHA
   *     sim  -> grava os 2 lancamentos e marca CONCLUIDA
   * COMMIT
   */
  private async movimentar(
    transacao: Transacao,
    origem: ContaPublica,
    destino: ContaPublica,
    valor: Dinheiro,
  ): Promise<void> {
    try {
      await this.prisma.$transaction(
        async (tx) => {
          // ---- Lock de linha ----
          // Trancamos a LINHA DA CONTA, e nao as linhas do lancamento.
          //
          // Razao: o saldo e' derivado do ledger, entao o que precisa ser
          // serializado e "calcular o saldo desta conta e grava-lo" como um
          // todo. A linha da conta e' um unico ponto de serializacao, sempre
          // existente, e barata de trancar. Travar os lancamentos exigiria um
          // SELECT ... WHERE conta_id que pode nao trazer linha nenhuma (conta
          // sem saldo) -- e ai o lock nao pegaria, abrindo caminho para duas
          // transacoes passarem.
          //
          // E a ordem importa: o lock vem ANTES do calculo. No MySQL, sob
          // REPEATABLE READ, `FOR UPDATE` e' uma *current read* (le o ultimo
          // commit) e nao abre o snapshot. O snapshot so e' aberto pelo primeiro
          // SELECT normal, que aqui e' o groupBy do saldo -- e ele abre depois
          // que a transacao concorrente ja commitou. Sem essa ordem, o saldo
          // sairia de um snapshot antigo e os dois Pix "passariam" juntos.
          await tx.$queryRaw`SELECT id FROM contas WHERE id = ${origem.id} FOR UPDATE`;

          // ---- Recalcula o saldo ----
          const agrupado = await tx.lancamento.groupBy({
            by: ['tipo'],
            where: { contaId: origem.id },
            _sum: { valor: true },
          });
          const saldo = saldoDoLedger(agrupado);

          // ---- Regra de negocio: saldo cobre o valor? ----
          if (!saldoCobre(saldo, valor)) {
            throw new SaldoInsuficienteError(saldo, valor);
          }

          // ---- Partida dobrada: exatamente 2 lancamentos que somam zero ----
          // Nao ha coluna de saldo para atualizar: a verdade e' o par de
          // lancamentos, e todo o resto do sistema e' leitura derivada dele.
          await tx.lancamento.createMany({
            data: [
              {
                transacaoId: transacao.id,
                contaId: origem.id,
                tipo: 'DEBITO',
                valor,
                descricao: `Pix enviado para ${destino.nome}`,
              },
              {
                transacaoId: transacao.id,
                contaId: destino.id,
                tipo: 'CREDITO',
                valor,
                descricao: `Pix recebido de ${origem.nome}`,
              },
            ],
          });

          await tx.transacao.update({
            where: { id: transacao.id },
            data: { status: 'CONCLUIDA' },
          });
        },
        {
          // Declarado explicitamente mesmo sendo o default do MySQL: fixa o
          // contrato de isolamento em vez de depender de configuracao do servidor.
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        },
      );

      // Fase D (planejada, fora do escopo atual): publicar
      // TRANSACAO_CONCLUIDA num event bus. Consumidores -- notificacao push,
      // ETL, antifraude -- reagem ao evento, nunca a chamada HTTP. E' o que
      // separa ledger de liquidacao: o livro fecha aqui, a conciliacao
      // acontece depois, e uma falha la nao desfaz o Pix.
      this.logger.log(
        `Pix ${transacao.id} concluido: ${paraTexto(valor)} de ${origem.nome} para ${destino.nome}`,
      );
    } catch (erro) {
      if (erro instanceof SaldoInsuficienteError) {
        // O ROLLBACK ja aconteceu. O UPDATE de status FALHA precisa ser uma
        // escrita SEPARADA: dentro da transacao que ja caiu, ele cairia
        // junto e a intencao ficaria PENDENTE para sempre.
        await this.marcarFalha(transacao.id);

        this.logger.warn(
          `Pix ${transacao.id} recusado: saldo ${paraTexto(erro.saldo)} < valor ${paraTexto(erro.valor)}`,
        );

        throw new UnprocessableEntityException({
          codigo: 'SALDO_INSUFICIENTE',
          mensagem: 'Saldo insuficiente para concluir a transferencia',
          saldo: paraTexto(erro.saldo),
          valorSolicitado: paraTexto(erro.valor),
          transacaoId: transacao.id,
        });
      }

      throw erro;
    }
  }

  /** A intencao falhou, mas a intencao EXISTE. E por isso que ela e' registrada. */
  private async marcarFalha(transacaoId: string): Promise<void> {
    await this.prisma.transacao.update({
      where: { id: transacaoId },
      data: { status: 'FALHA' },
    });
  }

  // -------------------------------------------------------------------------
  // Montagem da resposta
  // -------------------------------------------------------------------------

  /**
   * Um caminho de montagem so, para transferencia nova e reenvio produzirem
   * exatamente o mesmo corpo -- e para o cliente nao conseguir distinguir os
   * dois casos pela forma da resposta.
   */
  private async montarResultado(
    transacao: Transacao,
    destino: ContaPublica,
  ): Promise<ResultadoTransferencia> {
    const [lancamentos, agrupado] = await Promise.all([
      this.prisma.lancamento.findMany({
        where: { transacaoId: transacao.id },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.lancamento.groupBy({
        by: ['tipo'],
        where: { contaId: transacao.origemId },
        _sum: { valor: true },
      }),
    ]);

    return {
      transacao,
      destino,
      saldoOrigem: saldoDoLedger(agrupado),
      lancamentos: lancamentos.map((lancamento) => ({
        id: lancamento.id,
        tipo: lancamento.tipo,
        valor: paraTexto(lancamento.valor),
        descricao: lancamento.descricao,
      })),
    };
  }
}
