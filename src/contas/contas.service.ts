import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { hashCpf } from '../common/utils/cpf';
import { saldoDoLedger } from '../common/utils/dinheiro';
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
   * Resolve a chave Pix de destino em uma Conta.
   *
   * A chave deste dominio e' o CPF -- que, aliás, e' um tipo de chave Pix
   * valido de verdade. Nao criamos coluna `chave_pix` porque o CPF ja e'
   * identificador unico da conta e o hash SHA-256 dele e' deterministico: hashear
   * a chave recebida e comparar com `cpf_hash` acha a conta em um indice unico,
   * sem varrer tabela. (Guardar o CPF em claro seria o oposto do certo: ele e'
   * dado pessoal e nao tem por que estar legivel no banco.)
   *
   * Devolve null em chave desconhecida -- quem decide o erro e' o chamador, que
   * conhece o contexto da operacao.
   */
  async buscarPorChavePix(chave: string): Promise<ContaPublica | null> {
    const conta = await this.prisma.conta.findUnique({
      where: { cpfHash: hashCpf(chave) },
      select: { id: true, nome: true, cpfMasked: true },
    });

    return conta;
  }
}
