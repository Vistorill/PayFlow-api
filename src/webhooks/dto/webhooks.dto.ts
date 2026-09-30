import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { TIPOS_EVENTO_PIX } from '../../pix/eventos-pix';

const EVENTOS_ACEITOS = ['*', ...TIPOS_EVENTO_PIX];

export class CriarWebhookDto {
  @ApiProperty({ example: 'https://cliente.com/hooks/pix' })
  @IsString()
  @MaxLength(500)
  url: string;

  @ApiProperty({
    example: [
      'pix.payment.settled',
      'pix.payment.rejected',
      'pix.payment.received',
    ],
    description: `Eventos assinados. "*" = todos. Aceitos: ${EVENTOS_ACEITOS.join(', ')}`,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(EVENTOS_ACEITOS, { each: true })
  eventos: string[];

  @ApiProperty({ example: 'Producao - ERP', required: false })
  @IsOptional()
  @IsString()
  @Length(1, 140)
  descricao?: string;
}

export class AtualizarWebhookDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  url?: string;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(EVENTOS_ACEITOS, { each: true })
  eventos?: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 140)
  descricao?: string;

  @ApiProperty({
    required: false,
    enum: ['ATIVO', 'DESATIVADO'],
    description:
      'ATIVO reativa um endpoint SUSPENSO e reagenda as entregas paradas',
  })
  @IsOptional()
  @IsIn(['ATIVO', 'DESATIVADO'])
  status?: 'ATIVO' | 'DESATIVADO';
}

export class ListarEntregasQuery {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  endpointId?: string;

  @ApiProperty({
    required: false,
    enum: [
      'PENDENTE',
      'ENTREGUE',
      'RETENTANDO',
      'ESGOTADO',
      'FALHA_PERMANENTE',
    ],
  })
  @IsOptional()
  @IsIn(['PENDENTE', 'ENTREGUE', 'RETENTANDO', 'ESGOTADO', 'FALHA_PERMANENTE'])
  status?:
    'PENDENTE' | 'ENTREGUE' | 'RETENTANDO' | 'ESGOTADO' | 'FALHA_PERMANENTE';

  @ApiProperty({ required: false, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  take = 50;
}

export class WebhookEndpointDto {
  @ApiProperty() id: string;
  @ApiProperty() url: string;
  @ApiProperty({ nullable: true }) descricao: string | null;
  @ApiProperty({ type: [String] }) eventos: string[];
  @ApiProperty({ enum: ['ATIVO', 'SUSPENSO', 'DESATIVADO'] }) status: string;
  @ApiProperty() falhasConsecutivas: number;
  @ApiProperty() createdAt: string;
  @ApiProperty({
    required: false,
    description:
      'So na criacao e no rotate-secret. Guarde: nao e exibido de novo.',
  })
  segredo?: string;
}
