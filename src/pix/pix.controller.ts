import { Body, Controller, HttpStatus, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { paraTexto } from '../common/utils/dinheiro';
import { PixService } from './pix.service';
import { TransferirDto } from './dto/transferir.dto';
import { TransferirResponseDto } from './dto/transferir-response.dto';
import type { ReenvioIdempotente, ResultadoTransferencia } from './pix.types';

@ApiTags('pix')
@ApiBearerAuth()
@Controller('pix')
export class PixController {
  constructor(private readonly pixService: PixService) {}

  @Post('transferir')
  @ApiOperation({
    summary: 'Transfere por Pix. Idempotente por `idempotencyKey`.',
    description: [
      'Fluxo: valida -> registra a intencao -> trava a conta de origem ->',
      'recalcula o saldo do ledger -> checa saldo -> grava a partida dobrada',
      '(2 lancamentos que somam zero) -> marca a transacao como concluida.',
      '',
      'A conta de origem vem do JWT, nunca do corpo da requisicao.',
      '',
      '**Idempotencia:** reenviar com a MESMA `idempotencyKey` nao debita de',
      'novo -- devolve 200 com a transacao original. E o que protege contra o',
      'botao clicado duas vezes e contra o app reenviando a requisicao.',
    ].join('\n'),
  })
  @ApiCreatedResponse({
    type: TransferirResponseDto,
    description: 'Transferencia executada pela primeira vez',
  })
  @ApiOkResponse({
    type: TransferirResponseDto,
    description: 'Reenvio idempotente: a chave ja tinha sido usada',
  })
  @ApiUnprocessableEntityResponse({
    description: 'SALDO_INSUFICIENTE ou DESTINO_IGUAL_ORIGEM',
  })
  @ApiConflictResponse({
    description: 'TRANSACAO_EM_PROCESSAMENTO (reenvio enquanto a 1a roda)',
  })
  async transferir(
    @CurrentUser('contaId') contaIdOrigem: string,
    @Body() dto: TransferirDto,
    @Res({ passthrough: true }) resposta: Response,
  ): Promise<TransferirResponseDto> {
    const saida = await this.pixService.transferir(contaIdOrigem, dto);

    if (this.eReenvio(saida)) {
      // Reenvio: mesma representacao, 200 em vez de 201. O corpo e' identico
      // ao da primeira chamada, entao o front nao precisa de nenhum branch --
      // ele so ve que deu certo.
      resposta.status(HttpStatus.OK);
      return this.responder(saida.resultado);
    }

    resposta.status(HttpStatus.CREATED);
    return this.responder(saida);
  }

  private eReenvio(
    saida: ResultadoTransferencia | ReenvioIdempotente,
  ): saida is ReenvioIdempotente {
    return 'emProcessamento' in saida;
  }

  /**
   * Mesma politica do modulo Contas: o service devolve Decimal, o controller
   * serializa. `saldoOrigem` e' o saldo da conta de origem no instante da
   * resposta -- na transferencia nova ele ja e' pos-operacao, porque o lock
   * segura a conta ate o COMMIT.
   */
  private responder(resultado: ResultadoTransferencia): TransferirResponseDto {
    return {
      id: resultado.transacao.id,
      idempotencyKey: resultado.transacao.idempotencyKey,
      tipo: resultado.transacao.tipo,
      status: resultado.transacao.status,
      valor: paraTexto(resultado.transacao.valor),
      destino: resultado.destino,
      lancamentos: resultado.lancamentos,
      saldoOrigem: paraTexto(resultado.saldoOrigem),
      createdAt: resultado.transacao.createdAt.toISOString(),
    };
  }
}
