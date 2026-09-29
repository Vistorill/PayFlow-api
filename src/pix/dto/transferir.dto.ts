import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsNumber,
  IsPositive,
  IsString,
  Length,
  Matches,
  Max,
} from 'class-validator';

/**
 * Aceita "50", "50.00" e 50, e normaliza para string.
 *
 * O corpo chega como number quando o front manda `50.00` no JSON, e como
 * string quando manda "50,00" de um form. Aceitar os dois evita a classe
 * inteira de bug "no navegador funciona, no curl nao" -- e como o dominio e'
 * DECIMAL, guardar o valor como texto ate o ultimo momento evita que o
 * round-trip do JSON mude o numero.
 */
const paraTexto = ({ value }: { value: unknown }): unknown =>
  typeof value === 'number' ? value.toString() : value;

export class TransferirDto {
  @ApiProperty({
    example: '123.456.789-09',
    description: 'Chave Pix de destino. Neste dominio, a chave e o CPF.',
  })
  @Transform(paraTexto)
  @IsString()
  @Length(11, 14)
  @Matches(/^[\d.\-\s]{11,14}$/, {
    message: 'chaveDestino deve ser um CPF (com ou sem mascara)',
  })
  chaveDestino: string;

  @ApiProperty({
    example: '50.00',
    description: 'Valor positivo, com no maximo 2 casas decimais.',
  })
  @Transform(paraTexto)
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    {
      message: 'valor deve ser um numero com no maximo 2 casas decimais',
    },
  )
  @IsPositive({ message: 'valor deve ser maior que zero' })
  @Max(1_000_000_000, { message: 'valor excede o limite de uma transferencia' })
  valor: number;

  @ApiProperty({
    example: 'pix-8f2a1c9e-4b7d-4e3a-9c1f-0a5d6e8b2c47',
    description:
      'Chave de idempotencia. Gerada pelo CLIENTE, uma vez por transferencia. ' +
      'Reenviar com a mesma chave nunca debita duas vezes.',
    maxLength: 100,
  })
  @IsString()
  @Length(8, 100)
  idempotencyKey: string;
}
