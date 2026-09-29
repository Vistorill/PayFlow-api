import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { paraTexto } from '../common/utils/dinheiro';
import { ContasService } from './contas.service';
import type { ConsultaSaldo } from './contas.types';
import { ExtratoQueryDto } from './dto/extrato-query.dto';
import {
  ExtratoResponseDto,
  LancamentoResponseDto,
  SaldoResponseDto,
} from './dto/contas-response.dto';

@ApiTags('contas')
@ApiBearerAuth()
@Controller('contas')
export class ContasController {
  constructor(private readonly contasService: ContasService) {}

  @Get('me')
  @ApiOperation({
    summary: 'Conta do usuario logado, com o saldo derivado do ledger',
  })
  @ApiOkResponse({ type: SaldoResponseDto })
  async meuSaldo(@CurrentUser('contaId') contaId: string) {
    return this.responderSaldo(await this.contasService.saldo(contaId));
  }

  @Get(':id/saldo')
  @ApiOperation({
    summary: 'Saldo da conta. Somente a propria conta.',
    description:
      'saldo = SUM(creditos) - SUM(debitos) sobre `lancamentos`. ' +
      'Nao existe coluna de saldo: o valor e sempre recalculado, e por isso ' +
      'reconstruivel do zero.',
  })
  @ApiOkResponse({ type: SaldoResponseDto })
  async saldo(
    @CurrentUser('contaId') contaIdDoToken: string,
    @Param('id') id: string,
  ) {
    this.contasService.exigirProprietaria(contaIdDoToken, id);
    return this.responderSaldo(await this.contasService.saldo(id));
  }

  @Get(':id/extrato')
  @ApiOperation({
    summary: 'Extrato paginado da conta. Somente a propria conta.',
    description:
      'Lista `lancamentos` do mais novo para o mais antigo. ' +
      'O ledger e append-only: nada aqui e atualizado ou removido.',
  })
  @ApiOkResponse({ type: ExtratoResponseDto })
  async extrato(
    @CurrentUser('contaId') contaIdDoToken: string,
    @Param('id') id: string,
    @Query() pagina: ExtratoQueryDto,
  ) {
    this.contasService.exigirProprietaria(contaIdDoToken, id);

    const resultado = await this.contasService.extrato(id, pagina);

    return {
      contaId: resultado.contaId,
      saldo: paraTexto(resultado.saldo),
      lancamentos: resultado.lancamentos.map<LancamentoResponseDto>(
        (lancamento) => ({
          id: lancamento.id,
          transacaoId: lancamento.transacaoId,
          tipo: lancamento.tipo,
          valor: paraTexto(lancamento.valor),
          descricao: lancamento.descricao,
          createdAt: lancamento.createdAt.toISOString(),
        }),
      ),
      take: resultado.take,
      skip: resultado.skip,
      total: resultado.total,
    };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Dados cadastrais da conta. Somente a propria conta.',
  })
  async detalhe(
    @CurrentUser('contaId') contaIdDoToken: string,
    @Param('id') id: string,
  ) {
    this.contasService.exigirProprietaria(contaIdDoToken, id);
    return this.contasService.detalhe(id);
  }

  /**
   * O service devolve Decimal cru (o tipo honesto do dominio). A conversao para
   * texto acontece AQUI, na fronteira HTTP -- um unico lugar no codigo inteiro
   * onde dinheiro vira string, em vez de `toFixed` espalhado pelo service.
   */
  private responderSaldo(resultado: ConsultaSaldo): SaldoResponseDto {
    return {
      contaId: resultado.contaId,
      saldo: paraTexto(resultado.saldo),
      totalLancamentos: resultado.totalLancamentos,
      calculadoEm: new Date().toISOString(),
    };
  }
}
