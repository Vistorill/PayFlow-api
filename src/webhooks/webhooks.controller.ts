import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  AtualizarWebhookDto,
  CriarWebhookDto,
  ListarEntregasQuery,
  WebhookEndpointDto,
} from './dto/webhooks.dto';
import { WebhooksService } from './webhooks.service';

@ApiTags('webhooks')
@ApiBearerAuth()
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post('endpoints')
  @ApiOperation({
    summary: 'Cadastra um endpoint. O `segredo` volta UMA vez: guarde-o.',
    description: [
      'Cada entrega leva `X-Webhook-Signature: t=<ts>,v1=<hmac>` com',
      'HMAC-SHA256(segredo, `${t}.${corpoBruto}`). Verifique com o corpo',
      'BRUTO, recuse |agora - t| > 5 min e deduplique por `X-Webhook-Id`',
      '(entrega at-least-once, possivelmente fora de ordem).',
    ].join('\n'),
  })
  criar(
    @CurrentUser('contaId') contaId: string,
    @Body() dto: CriarWebhookDto,
  ): Promise<WebhookEndpointDto> {
    return this.webhooks.criar(contaId, dto);
  }

  @Get('endpoints')
  listar(@CurrentUser('contaId') contaId: string) {
    return this.webhooks.listar(contaId);
  }

  @Get('endpoints/:id')
  detalhe(
    @CurrentUser('contaId') contaId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.webhooks.detalhe(contaId, id);
  }

  @Patch('endpoints/:id')
  @ApiOperation({
    summary: 'Altera URL/eventos, desativa ou reativa (status ATIVO)',
  })
  atualizar(
    @CurrentUser('contaId') contaId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AtualizarWebhookDto,
  ) {
    return this.webhooks.atualizar(contaId, id, dto);
  }

  @Delete('endpoints/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remover(
    @CurrentUser('contaId') contaId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.webhooks.remover(contaId, id);
  }

  @Post('endpoints/:id/rotate-secret')
  @ApiOperation({ summary: 'Novo segredo; o antigo segue assinando por 24h' })
  rotacionar(
    @CurrentUser('contaId') contaId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.webhooks.rotacionarSegredo(contaId, id);
  }

  @Post('endpoints/:id/test')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Envia um evento `webhook.test`' })
  testar(
    @CurrentUser('contaId') contaId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.webhooks.testar(contaId, id);
  }

  @Get('entregas')
  @ApiOperation({
    summary: 'Historico de entregas (filtro por endpoint e status)',
  })
  entregas(
    @CurrentUser('contaId') contaId: string,
    @Query() q: ListarEntregasQuery,
  ) {
    return this.webhooks.entregas(contaId, q);
  }

  @Post('entregas/:id/replay')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Reenvia uma entrega (inclusive ESGOTADO/FALHA_PERMANENTE)',
  })
  replay(
    @CurrentUser('contaId') contaId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.webhooks.replay(contaId, id);
  }
}
