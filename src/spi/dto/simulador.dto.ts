import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { MOTIVOS_DEVOLUCAO, type MotivoDevolucao } from '../iso20022/tipos';

const VALOR = /^(?!0+(?:\.0{1,2})?$)\d{1,9}(?:\.\d{1,2})?$/;

export class SimularPixRecebidoDto {
  @ApiProperty({
    example: 'ana@email.com',
    description:
      'Chave Pix do cliente Cactvs que vai receber (CPF, e-mail ou celular)',
  })
  @IsString()
  @Length(3, 180)
  chave: string;

  @ApiProperty({ example: '25.00' })
  @IsString()
  @Matches(VALOR, { message: 'valor invalido' })
  valor: string;

  @ApiProperty({ example: 'Carlos Pereira', required: false })
  @IsOptional()
  @IsString()
  @Length(2, 120)
  pagadorNome?: string;

  @ApiProperty({ example: 'Almoco', required: false })
  @IsOptional()
  @IsString()
  @Length(1, 140)
  mensagem?: string;
}

export class SimularDevolucaoRecebidaDto {
  @ApiProperty({
    example: 'E12345678202609291200A1B2C3D4E5F',
    description: 'EndToEndId de um Pix que NOS enviamos para outro banco',
  })
  @IsString()
  @Length(32, 32)
  endToEndId: string;

  @ApiProperty({ example: '10.00' })
  @IsString()
  @Matches(VALOR, { message: 'valor invalido' })
  valor: string;

  @ApiProperty({ enum: MOTIVOS_DEVOLUCAO, default: 'MD06', required: false })
  @IsOptional()
  @IsIn(MOTIVOS_DEVOLUCAO)
  motivo?: MotivoDevolucao;
}
