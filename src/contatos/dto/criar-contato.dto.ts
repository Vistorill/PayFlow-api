import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import {
  TIPOS_CHAVE_PIX,
  type TipoChavePix,
} from '../../common/utils/chave-pix';

export class CriarContatoDto {
  @ApiProperty({ enum: TIPOS_CHAVE_PIX, example: 'TELEFONE' })
  @IsIn(TIPOS_CHAVE_PIX, {
    message: `tipoChave deve ser um de: ${TIPOS_CHAVE_PIX.join(', ')}`,
  })
  tipoChave: TipoChavePix;

  @ApiProperty({
    example: '(11) 97777-2222',
    description: 'Chave Pix do contato, no formato do tipo informado',
  })
  @IsString()
  @Length(3, 180)
  chave: string;

  @ApiProperty({
    example: 'Joao Pereira',
    required: false,
    description:
      'So para chave de OUTRO banco (sem conta PayFlow): nome do favorecido. ' +
      'Se a chave for de cliente PayFlow, e ignorado -- o nome vem da conta.',
  })
  @IsOptional()
  @IsString()
  @Length(3, 120)
  nomeFavorecido?: string;

  @ApiProperty({
    example: 'Nubank',
    required: false,
    description: 'Banco do favorecido, para chave de outro banco',
  })
  @IsOptional()
  @IsString()
  @Length(2, 60)
  banco?: string;

  @ApiProperty({
    example: 'Bruno - aluguel',
    required: false,
    description: 'Nome para reconhecer o contato na lista',
  })
  @IsOptional()
  @IsString()
  @Length(1, 60)
  apelido?: string;
}
