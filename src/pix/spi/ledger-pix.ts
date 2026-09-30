import type { TipoTransacao, Transacao } from '@prisma/client';
import { saldoDoLedger, type Dinheiro } from '../../common/utils/dinheiro';
import type { Tx } from '../../mensageria/outbox.service';

/** `lancamentos.descricao` e' VARCHAR(140). */
export const limitar = (texto: string): string =>
  texto.length <= 140 ? texto : `${texto.slice(0, 139)}…`;

export interface NovaPartida {
  tipo: TipoTransacao;
  /**
   * Chave deterministica ("estorno:<id>", "devolucao:<returnId>", "spi:<e2e>"):
   * o indice UNIQUE garante que o mesmo movimento nunca e' lancado duas vezes,
   * mesmo com a mensagem reentregue.
   */
  idempotencyKey: string;
  origemId: string;
  destinoId: string;
  valor: Dinheiro;
  descricaoDebito: string;
  descricaoCredito: string;
  extra?: Partial<
    Pick<
      Transacao,
      | 'endToEndId'
      | 'direcaoSpi'
      | 'statusSpi'
      | 'pagadorNome'
      | 'pagadorBanco'
      | 'favorecidoNome'
      | 'favorecidoBanco'
      | 'tipoChave'
      | 'chaveDestino'
    >
  >;
}

/**
 * Transacao ja CONCLUIDA + partida dobrada (2 lancamentos que somam zero), na
 * transacao do chamador. Mesmas regras do PixService: ledger append-only,
 * nunca UPDATE em lancamento.
 */
export async function lancarPartida(
  tx: Tx,
  p: NovaPartida,
): Promise<Transacao> {
  const transacao = await tx.transacao.create({
    data: {
      idempotencyKey: p.idempotencyKey,
      tipo: p.tipo,
      status: 'CONCLUIDA',
      valor: p.valor,
      origemId: p.origemId,
      destinoId: p.destinoId,
      ...p.extra,
    },
  });
  await tx.lancamento.createMany({
    data: [
      {
        transacaoId: transacao.id,
        contaId: p.origemId,
        tipo: 'DEBITO',
        valor: p.valor,
        descricao: limitar(p.descricaoDebito),
      },
      {
        transacaoId: transacao.id,
        contaId: p.destinoId,
        tipo: 'CREDITO',
        valor: p.valor,
        descricao: limitar(p.descricaoCredito),
      },
    ],
  });
  return transacao;
}

/**
 * Trava a conta (SELECT ... FOR UPDATE) e recalcula o saldo do ledger. Mesma
 * ordem do PixService.movimentar: lock ANTES do calculo, senao o saldo sai de
 * um snapshot antigo.
 */
export async function saldoComLock(tx: Tx, contaId: string): Promise<Dinheiro> {
  await tx.$queryRaw`SELECT id FROM contas WHERE id = ${contaId} FOR UPDATE`;
  const agrupado = await tx.lancamento.groupBy({
    by: ['tipo'],
    where: { contaId },
    _sum: { valor: true },
  });
  return saldoDoLedger(agrupado);
}
