import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import {
  MOTIVOS_DEVOLUCAO,
  type MotivoDevolucao,
} from '../../spi/iso20022/tipos';

const VALOR = /^(?!0+(?:\.0{1,2})?$)\d{1,9}(?:\.\d{1,2})?$/;

export class SolicitarDevolucaoDto {
  @ApiProperty({
    example: '10.00',
    description: 'Ate o saldo devolvivel do Pix',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'number'
      ? value.toString()
      : typeof value === 'string'
        ? value.trim().replace(',', '.')
        : value,
  )
  @IsString()
  @Matches(VALOR, { message: 'valor deve ser positivo com no maximo 2 casas' })
  valor: string;

  @ApiProperty({
    enum: MOTIVOS_DEVOLUCAO,
    default: 'MD06',
    required: false,
    description:
      'MD06 pedido do pagador, SL02 do recebedor, BE08 erro, FR01 fraude',
  })
  @IsOptional()
  @IsIn(MOTIVOS_DEVOLUCAO)
  motivo?: MotivoDevolucao;

  @ApiProperty({ example: 'Cobranca em duplicidade', required: false })
  @IsOptional()
  @IsString()
  @Length(1, 140)
  infoAdicional?: string;

  @ApiProperty({ example: 'dev-7b1e3c1a-2f4d-4a9e-8c21-5d9f0e7a6b34' })
  @IsString()
  @Length(8, 100)
  idempotencyKey: string;
}

export class DevolucaoResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'D12345678202609291205X9Y8Z7W6V5U' })
  returnId: string;

  @ApiProperty({ format: 'uuid' })
  transacaoOriginalId: string;

  @ApiProperty({ enum: ['ENVIADA', 'RECEBIDA'] })
  direcao: string;

  @ApiProperty({ enum: ['SOLICITADA', 'ENVIADA', 'LIQUIDADA', 'REJEITADA'] })
  status: string;

  @ApiProperty({ example: '10.00' })
  valor: string;

  @ApiProperty({ example: 'MD06' })
  motivo: string;

  @ApiProperty({ nullable: true })
  infoAdicional: string | null;

  @ApiProperty({ nullable: true, example: 'AM02' })
  motivoRejeicao: string | null;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;
}
