import { ApiProperty } from '@nestjs/swagger';

export class DonoDaChaveDto {
  @ApiProperty({ example: 'Bruno Costa' })
  nome: string;

  @ApiProperty({
    example: '***.456.789-**',
    nullable: true,
    description:
      'CPF parcial, como em comprovante Pix. null para contato de outro banco.',
  })
  cpf: string | null;

  @ApiProperty({
    description: 'true = chave de outro banco (sem conta PayFlow)',
  })
  externo: boolean;

  @ApiProperty({ example: 'Nubank', nullable: true })
  banco: string | null;
}

export class ContatoResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Bruno - aluguel', nullable: true })
  apelido: string | null;

  @ApiProperty({ enum: ['CPF', 'EMAIL', 'TELEFONE'] })
  tipoChave: string;

  @ApiProperty({ example: '(11) 97777-2222' })
  chave: string;

  @ApiProperty({
    type: DonoDaChaveDto,
    description: 'Dono da chave, confirmado no cadastro do contato',
  })
  destino: DonoDaChaveDto;

  @ApiProperty({ example: '2026-09-28T21:00:00.000Z' })
  createdAt: string;
}
