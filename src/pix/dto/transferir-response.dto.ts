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

  @ApiProperty({
    example: 'E12345678202609291200A1B2C3D4E5F',
    nullable: true,
    description: 'EndToEndId ISO 20022. So em Pix para outro banco.',
  })
  endToEndId: string | null;

  @ApiProperty({
    enum: [
      'CRIADO',
      'ENVIADO',
      'LIQUIDADO',
      'REJEITADO',
      'RECONCILIANDO',
      'RECEBIDO',
      'DEVOLVIDO_PARCIAL',
      'DEVOLVIDO',
    ],
    nullable: true,
    description: 'Estado no SPI. Null em Pix interno (liquida na hora).',
  })
  statusSpi: string | null;

  @ApiProperty({ example: '50.00' })
  valor: string;

  @ApiProperty({
    enum: ['CPF', 'EMAIL', 'TELEFONE'],
    nullable: true,
    description: 'Tipo da chave Pix usada',
  })
  tipoChave: string | null;

  @ApiProperty({
    example: '(11) 97777-2222',
    nullable: true,
    description: 'Chave Pix usada, formatada para exibicao',
  })
  chaveDestino: string | null;

  @ApiProperty({
    example: 'Bruno Costa',
    description: 'Conta de destino, resolvida da chave Pix',
  })
  destino: {
    /** null quando o destino e' outro banco. */
    id: string | null;
    nome: string;
    cpfMasked: string | null;
    /** true = Pix para outra instituicao (cash-out via liquidacao SPI). */
    externo: boolean;
    banco: string | null;
  };

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
