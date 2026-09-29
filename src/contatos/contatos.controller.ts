import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ContatosService } from './contatos.service';
import { ContatoResponseDto } from './dto/contato-response.dto';
import { CriarContatoDto } from './dto/criar-contato.dto';

@ApiTags('contatos')
@ApiBearerAuth()
@Controller('contatos')
export class ContatosController {
  constructor(private readonly contatosService: ContatosService) {}

  @Get()
  @ApiOperation({ summary: 'Contatos Pix salvos pela conta logada' })
  @ApiOkResponse({ type: [ContatoResponseDto] })
  listar(
    @CurrentUser('contaId') contaId: string,
  ): Promise<ContatoResponseDto[]> {
    return this.contatosService.listar(contaId);
  }

  @Post()
  @ApiOperation({
    summary: 'Salva a chave Pix de alguem como contato',
    description:
      'A chave precisa existir (404 CHAVE_NAO_ENCONTRADA) e nao pode ser da ' +
      'propria conta (422 CONTATO_PROPRIA_CONTA).',
  })
  @ApiCreatedResponse({ type: ContatoResponseDto })
  @ApiConflictResponse({ description: 'CONTATO_JA_EXISTE' })
  criar(
    @CurrentUser('contaId') contaId: string,
    @Body() dto: CriarContatoDto,
  ): Promise<ContatoResponseDto> {
    return this.contatosService.criar(contaId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove um contato salvo' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'Nao existe ou nao e seu' })
  remover(
    @CurrentUser('contaId') contaId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    return this.contatosService.remover(contaId, id);
  }
}
