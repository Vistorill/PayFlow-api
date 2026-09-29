import { ApiProperty } from '@nestjs/swagger';

export class LancamentoDaTransacaoDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: ['DEBITO', 'CREDITO'] })
  tipo: string;

  @ApiProperty({ example: '50.00' })
  valor: string;

  @ApiProperty({ example: 'Pix enviado para Bruno Costa' })
  descricao: string;
}

export class TransferirResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    example: 'pix-8f2a1c9e-4b7d-4e3a-9c1f-0a5d6e8b2c47',
    description: 'A chave que o cliente mandou',
  })
  idempotencyKey: string;

  @ApiProperty({ example: 'PIX' })
  tipo: string;

  @ApiProperty({
    enum: ['PENDENTE', 'CONCLUIDA', 'FALHA'],
    description:
      'CONCLUIDA = dinheiro movimentado. FALHA = a intencao existe, mas o ' +
      'lancamento nao foi gravado. PENDENTE = ainda em processamento.',
  })
  status: string;

  @ApiProperty({ example: '50.00' })
  valor: string;

  @ApiProperty({
    example: 'Bruno Costa',
    description: 'Conta de destino, resolvida da chave Pix',
  })
  destino: { id: string; nome: string; cpfMasked: string };

  @ApiProperty({
    type: [LancamentoDaTransacaoDto],
    description:
      'Partida dobrada: exatamente 2 lancamentos que somam zero. Vazio se a ' +
      'transacao ainda nao foi concluida.',
  })
  lancamentos: LancamentoDaTransacaoDto[];

  @ApiProperty({
    example: '1000.00',
    description: 'Saldo da origem APOS a operacao',
  })
  saldoOrigem: string;

  @ApiProperty({ example: '2026-01-01T12:00:00.000Z' })
  createdAt: string;
}
