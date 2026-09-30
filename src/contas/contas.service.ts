import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { TipoChavePix } from '../common/utils/chave-pix';
import { hashCpf } from '../common/utils/cpf';
import { saldoDoLedger } from '../common/utils/dinheiro';
import { eConflitoDeUnico } from '../common/utils/prisma';

export const CONTA_LIQUIDACAO_PIX = 'LIQUIDACAO_PIX';
import type {
  ConsultaExtrato,
  ConsultaSaldo,
  ContaPublica,
} from './contas.types';
import type { ExtratoQueryDto } from './dto/extrato-query.dto';

/**
 * Servico de Contas: QUEM e' a conta. Leitura e consulta -- a criacao acontece
 * no Auth (register cria Conta + Usuario na mesma transacao, porque nao existe
 * usuario sem conta neste dominio).
 *
 * Nenhum metodo deste servico escreve em `contas` alem do register. E nenhum
 * toca em `lancamentos`: o ledger e' append-only e so o Pix escreve nele.
 */
@Injectable()
export class ContasService {
  constructor(private readonly prisma: PrismaService) {}

  private contaLiquidacaoId: string | null = null;

  /**
   * Conta de liquidacao Pix (SPI): contrapartida de todo Pix enviado para
   * OUTRA instituicao. O cliente e' debitado e esta conta e' creditada -- o
   * dinheiro "sai do banco" sem quebrar a partida dobrada, e o saldo dela e'
   * quanto o PayFlow deve liquidar com os outros bancos.
   *
   * Criada sob demanda (nao depende do seed). Nao tem usuario, logo nao loga;
   * e o cpf_hash e' derivado de um marcador, nunca de um CPF real, entao
   * nenhuma chave Pix a encontra.
   */
  async contaLiquidacaoPix(): Promise<ContaPublica> {
    const select = { id: true, nome: true, cpfMasked: true } as const;
    if (this.contaLiquidacaoId) {
      return this.prisma.conta.findUniqueOrThrow({
        where: { id: this.contaLiquidacaoId },
        select,
      });
    }

    const where = { sistema: CONTA_LIQUIDACAO_PIX };
    let conta = await this.prisma.conta.findUnique({ where, select });
    if (!conta) {
      try {
        conta = await this.prisma.conta.create({
          data: {
            sistema: CONTA_LIQUIDACAO_PIX,
            nome: 'Liquidacao Pix (SPI)',
            cpfMasked: '-',
            cpfHash: createHash('sha256')
              .update(`sistema:${CONTA_LIQUIDACAO_PIX}`)
              .digest('hex'),
          },
          select,
        });
      } catch (erro) {
        // Duas requisicoes criando ao mesmo tempo: a outra venceu, usa a dela.
        if (!eConflitoDeUnico(erro)) throw erro;
        conta = await this.prisma.conta.findUniqueOrThrow({ where, select });
      }
    }

    this.contaLiquidacaoId = conta.id;
    return conta;
  }

  /**
   * Fecho de propriedade.
   *
   * A identidade vem SEMPRE do token (via @CurrentUser). O :id da URL existe
   * para o endpoint ser legivel e para eu poder trocar a regra depois sem
   * quebrar o contrato -- mas a comparacao e' com o token, nunca o contrario.
   * Sem isto, qualquer um logado trocaria o id e leria o extrato de outra
   * pessoa. Autorizacao real (ver extrato de terceiro) e' um caso de negocio
   * separado, com a sua propria decisao -- nao um `if` largado no controller.
   */
  exigirProprietaria(contaIdDoToken: string, contaIdDaUrl: string): void {
    if (contaIdDoToken !== contaIdDaUrl) {
      throw new ForbiddenException('Voce so pode consultar os proprios dados');
    }
  }

  async saldo(contaId: string): Promise<ConsultaSaldo> {
    // As duas metades do saldo numa ida so ao banco. O indice
    // (conta_id, created_at) cobre o filtro, e o groupBy devolve no maximo
    // duas linhas (CREDITO e DEBITO) para agregar em memoria.
    const [agrupado, totalLancamentos] = await Promise.all([
      this.prisma.lancamento.groupBy({
        by: ['tipo'],
        where: { contaId },
        _sum: { valor: true },
      }),
      this.prisma.lancamento.count({ where: { contaId } }),
    ]);

    return {
      contaId,
      saldo: saldoDoLedger(agrupado),
      totalLancamentos,
    };
  }

  async extrato(
    contaId: string,
    pagina: ExtratoQueryDto,
  ): Promise<ConsultaExtrato> {
    const [lancamentos, total, agrupado] = await Promise.all([
      this.prisma.lancamento.findMany({
        where: { contaId },
        orderBy: { createdAt: 'desc' },
        take: pagina.take,
        skip: pagina.skip,
        // Resumo da transacao para a linha do extrato (a chave Pix usada);
        // o detalhe completo fica em GET /transacoes/:id.
        include: {
          transacao: {
            select: {
              tipo: true,
              tipoChave: true,
              chaveDestino: true,
              status: true,
              statusSpi: true,
            },
          },
        },
      }),
      this.prisma.lancamento.count({ where: { contaId } }),
      this.prisma.lancamento.groupBy({
        by: ['tipo'],
        where: { contaId },
        _sum: { valor: true },
      }),
    ]);

    return {
      contaId,
      saldo: saldoDoLedger(agrupado),
      lancamentos,
      take: pagina.take,
      skip: pagina.skip,
      total,
    };
  }

  async detalhe(contaId: string): Promise<ContaPublica> {
    const conta = await this.prisma.conta.findUnique({
      where: { id: contaId },
      select: { id: true, nome: true, cpfMasked: true },
    });

    if (!conta) {
      throw new NotFoundException('Conta nao encontrada');
    }

    return conta;
  }

  /**
   * Resolve a chave Pix de destino em uma Conta. A chave chega JA normalizada
   * (ver `normalizarChavePix`), e cada tipo aponta para um indice unico:
   *
   *   CPF      -> `contas.cpf_hash`. Nao ha CPF em claro no banco: hashear a
   *               chave e comparar acha a conta sem expor dado pessoal.
   *   EMAIL    -> `usuarios.email`, o mesmo e-mail do login (1:1 com a conta).
   *   TELEFONE -> `contas.telefone`, so digitos.
   *
   * Devolve null em chave desconhecida -- quem decide o erro e' o chamador, que
   * conhece o contexto da operacao.
   */
  async buscarPorChavePix(
    tipo: TipoChavePix,
    chaveNormalizada: string,
  ): Promise<ContaPublica | null> {
    const select = { id: true, nome: true, cpfMasked: true } as const;

    switch (tipo) {
      case 'CPF':
        return this.prisma.conta.findUnique({
          where: { cpfHash: hashCpf(chaveNormalizada) },
          select,
        });
      case 'TELEFONE':
        return this.prisma.conta.findUnique({
          where: { telefone: chaveNormalizada },
          select,
        });
      case 'EMAIL': {
        const usuario = await this.prisma.usuario.findUnique({
          where: { email: chaveNormalizada },
          select: { conta: { select } },
        });
        return usuario?.conta ?? null;
      }
    }
  }
}
