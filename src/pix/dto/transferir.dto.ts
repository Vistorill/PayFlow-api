import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import {
  TIPOS_CHAVE_PIX,
  type TipoChavePix,
} from '../../common/utils/chave-pix';

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

/** Igual a `paraTexto`, e ainda aceita virgula decimal ("50,00"). */
const valorParaTexto = ({ value }: { value: unknown }): unknown => {
  const texto = paraTexto({ value });
  return typeof texto === 'string' ? texto.trim().replace(',', '.') : texto;
};

/**
 * Positivo, ate 2 casas, abaixo de 1 bilhao (9 digitos inteiros).
 * Validado como TEXTO: se passasse por number, `@Type(() => Number)` e o
 * `@Transform` brigariam pela ordem e o valor chegaria ao validador como string
 * -- recusando qualquer entrada. O lookahead rejeita zero ("0", "0.00").
 */
const VALOR_VALIDO = /^(?!0+(?:\.0{1,2})?$)\d{1,9}(?:\.\d{1,2})?$/;

export class TransferirDto {
  @ApiProperty({
    enum: TIPOS_CHAVE_PIX,
    default: 'CPF',
    required: false,
    description:
      'Tipo da chave Pix de destino. Omitido = CPF (compatibilidade).',
  })
  @IsOptional()
  @IsIn(TIPOS_CHAVE_PIX, {
    message: `tipoChave deve ser um de: ${TIPOS_CHAVE_PIX.join(', ')}`,
  })
  tipoChave?: TipoChavePix;

  @ApiProperty({
    example: '123.456.789-09',
    description:
      'Chave Pix de destino: CPF (com ou sem mascara), e-mail ou celular ' +
      'com DDD. O formato e validado conforme `tipoChave`.',
  })
  @Transform(paraTexto)
  @IsString()
  @Length(3, 180)
  chaveDestino: string;

  @ApiProperty({
    example: '50.00',
    description: 'Valor positivo, com no maximo 2 casas decimais.',
  })
  @Transform(valorParaTexto)
  @IsString({ message: 'valor deve ser um numero ou texto numerico' })
  @Matches(VALOR_VALIDO, {
    message:
      'valor deve ser maior que zero, abaixo de 1 bilhao e ter no maximo 2 casas decimais',
  })
  valor: string;

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
