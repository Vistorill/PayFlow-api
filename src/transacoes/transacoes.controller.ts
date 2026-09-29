import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TransacaoDetalheDto } from './dto/transacao-detalhe.dto';
import { TransacoesService } from './transacoes.service';

@ApiTags('transacoes')
@ApiBearerAuth()
@Controller('transacoes')
export class TransacoesController {
  constructor(private readonly transacoesService: TransacoesService) {}

  @Get(':id')
  @ApiOperation({
    summary: 'Detalhe/comprovante de uma transacao',
    description:
      'Partes, chave Pix usada, status e as 2 pernas da partida dobrada. ' +
      'So a origem ou o destino podem ver; para qualquer outra conta o ' +
      'resultado e 404, igual a um id inexistente.',
  })
  @ApiOkResponse({ type: TransacaoDetalheDto })
  @ApiNotFoundResponse({ description: 'Nao existe ou nao e sua' })
  detalhe(
    @CurrentUser('contaId') contaId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<TransacaoDetalheDto> {
    return this.transacoesService.detalhe(contaId, id);
  }
}
