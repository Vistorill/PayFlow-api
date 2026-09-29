import { ApiProperty } from '@nestjs/swagger';

export class ContaResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Ana Souza' })
  nome: string;

  @ApiProperty({
    example: '123.456.789-09',
    description: 'Sempre mascarado. CPF nao e',
  })
  cpf: string;
}

export class AuthResponseDto {
  @ApiProperty({ description: 'Bearer token. Expiracao curta (1h).' })
  accessToken: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType: string;

  @ApiProperty({ example: 3600, description: 'Segundos ate expirar' })
  expiresIn: number;

  @ApiProperty({ type: () => ContaResponseDto })
  conta: ContaResponseDto;
}
