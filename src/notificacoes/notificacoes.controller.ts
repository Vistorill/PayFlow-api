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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { NotificacoesService } from './notificacoes.service';

const PLATAFORMAS = ['ANDROID', 'IOS', 'WEB'] as const;

export class RegistrarDispositivoDto {
  @ApiProperty({
    example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
    description: 'Token de push do aparelho (Expo: getExpoPushTokenAsync)',
  })
  @IsString()
  @Length(10, 255)
  token: string;

  @ApiProperty({ enum: PLATAFORMAS })
  @IsIn(PLATAFORMAS)
  plataforma: (typeof PLATAFORMAS)[number];
}

export class ListarNotificacoesQuery {
  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  naoLidas = false;

  @ApiProperty({ required: false, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  take = 20;

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip = 0;
}

@ApiTags('notificacoes')
@ApiBearerAuth()
@Controller('notificacoes')
export class NotificacoesController {
  constructor(private readonly notificacoes: NotificacoesService) {}

  @Post('dispositivos')
  @ApiOperation({
    summary: 'App mobile registra o token de push apos o login',
    description:
      'Chame a cada abertura do app (o token pode mudar). No logout, DELETE.',
  })
  registrar(
    @CurrentUser('contaId') contaId: string,
    @Body() dto: RegistrarDispositivoDto,
  ) {
    return this.notificacoes.registrarDispositivo(
      contaId,
      dto.token,
      dto.plataforma,
    );
  }

  @Delete('dispositivos/:token')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Logout: para de mandar push para este aparelho' })
  remover(
    @CurrentUser('contaId') contaId: string,
    @Param('token') token: string,
  ) {
    return this.notificacoes.removerDispositivo(contaId, token);
  }

  @Get()
  @ApiOperation({ summary: 'Caixa de notificacoes (mais recentes primeiro)' })
  listar(
    @CurrentUser('contaId') contaId: string,
    @Query() q: ListarNotificacoesQuery,
  ) {
    return this.notificacoes.listar(contaId, q.naoLidas, q.take, q.skip);
  }

  @Patch(':id/lida')
  marcarLida(
    @CurrentUser('contaId') contaId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notificacoes.marcarLida(contaId, id);
  }

  @Post('lidas')
  @ApiOperation({ summary: 'Marca todas como lidas' })
  marcarTodas(@CurrentUser('contaId') contaId: string) {
    return this.notificacoes.marcarTodasLidas(contaId);
  }
}
