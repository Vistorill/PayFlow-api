import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiAcceptedResponse,
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
import { DevolucoesService } from './devolucoes.service';
import {
  DevolucaoResponseDto,
  SolicitarDevolucaoDto,
} from './dto/devolucao.dto';
import { PixService } from './pix.service';
import { TransferirDto } from './dto/transferir.dto';
import { TransferirResponseDto } from './dto/transferir-response.dto';
import type { ReenvioIdempotente, ResultadoTransferencia } from './pix.types';

@ApiTags('pix')
@ApiBearerAuth()
@Controller('pix')
export class PixController {
  constructor(
    private readonly pixService: PixService,
    private readonly devolucoes: DevolucoesService,
  ) {}

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
      '',
      "**Pix para outro banco (assincrono):** o valor e' debitado na hora e a",
      "resposta e' **202** com `status: PENDENTE` e o `endToEndId`. O pacs.008",
      'segue pelo Kafka ao SPI; o resultado (pacs.002) chega por push,',
      'webhook (`pix.payment.settled` / `pix.payment.rejected`) e em',
      'GET /api/transacoes/:id. Rejeitado = estorno automatico.',
    ].join('\n'),
  })
  @ApiAcceptedResponse({
    type: TransferirResponseDto,
    description: 'Pix para outro banco aceito; aguardando o SPI',
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
      // ele so ve que deu certo. Pix externo ainda no SPI continua 202.
      resposta.status(
        saida.emProcessamento ? HttpStatus.ACCEPTED : HttpStatus.OK,
      );
      return this.responder(saida.resultado);
    }

    resposta.status(
      saida.transacao.statusSpi ? HttpStatus.ACCEPTED : HttpStatus.CREATED,
    );
    return this.responder(saida);
  }

  @Post('transacoes/:id/devolucoes')
  @ApiOperation({
    summary: 'Devolve (pacs.004) um Pix recebido de outro banco',
    description: [
      'So para Pix RECEBIDO de outra instituicao. Pode ser parcial; a soma das',
      'devolucoes nunca passa do valor original. O valor sai da conta na hora',
      '(202, status SOLICITADA); o pacs.004 vai ao SPI pelo Kafka e o pacs.002',
      'conclui (LIQUIDADA) ou estorna (REJEITADA). Idempotente por',
      '`idempotencyKey`.',
    ].join('\n'),
  })
  @ApiAcceptedResponse({ type: DevolucaoResponseDto })
  async devolver(
    @CurrentUser('contaId') contaId: string,
    @Param('id', ParseUUIDPipe) transacaoId: string,
    @Body() dto: SolicitarDevolucaoDto,
    @Res({ passthrough: true }) resposta: Response,
  ): Promise<DevolucaoResponseDto> {
    const { devolucao, nova } = await this.devolucoes.solicitar(
      contaId,
      transacaoId,
      dto,
    );
    resposta.status(nova ? HttpStatus.ACCEPTED : HttpStatus.OK);
    return DevolucoesService.serializar(devolucao);
  }

  @Get('transacoes/:id/devolucoes')
  @ApiOperation({ summary: 'Devolucoes (enviadas e recebidas) de um Pix' })
  @ApiOkResponse({ type: [DevolucaoResponseDto] })
  async listarDevolucoes(
    @CurrentUser('contaId') contaId: string,
    @Param('id', ParseUUIDPipe) transacaoId: string,
  ): Promise<DevolucaoResponseDto[]> {
    const lista = await this.devolucoes.listar(contaId, transacaoId);
    return lista.map((d) => DevolucoesService.serializar(d));
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
      endToEndId: resultado.transacao.endToEndId,
      statusSpi: resultado.transacao.statusSpi,
      valor: paraTexto(resultado.transacao.valor),
      tipoChave: resultado.transacao.tipoChave,
      chaveDestino: resultado.transacao.chaveDestino,
      destino: resultado.destino.externo
        ? {
            // Pix para outro banco: quem aparece e' o favorecido, nao a conta
            // de liquidacao interna (cujo id nao interessa ao cliente).
            id: null,
            nome: resultado.destino.externo.nome,
            cpfMasked: null,
            externo: true,
            banco: resultado.destino.externo.banco,
          }
        : {
            ...resultado.destino.conta,
            externo: false,
            banco: null,
          },
      lancamentos: resultado.lancamentos,
      saldoOrigem: paraTexto(resultado.saldoOrigem),
      createdAt: resultado.transacao.createdAt.toISOString(),
    };
  }
}
