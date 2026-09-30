import { ApiProperty } from '@nestjs/swagger';

export class ParteDaTransacaoDto {
  @ApiProperty({ example: 'Bruno Costa' })
  nome: string;

  @ApiProperty({
    example: '***.456.789-**',
    description:
      'CPF da parte. Inteiro quando e a propria conta; do contrario so os ' +
      '6 digitos do meio, como nos comprovantes Pix.',
  })
  cpf: string | null;

  @ApiProperty({ description: 'true se esta parte e a conta logada' })
  eVoce: boolean;

  @ApiProperty({ description: 'true = favorecido de outro banco' })
  externo: boolean;

  @ApiProperty({ example: 'Nubank', nullable: true })
  banco: string | null;
}

export class LancamentoDetalheDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: ['DEBITO', 'CREDITO'] })
  tipo: string;

  @ApiProperty({ example: '50.00' })
  valor: string;

  @ApiProperty({ example: 'Pix enviado para Bruno Costa' })
  descricao: string;

  @ApiProperty({ example: 'Ana Souza', description: 'Dona do lancamento' })
  conta: string;

  @ApiProperty({ example: '2026-09-28T21:00:00.000Z' })
  createdAt: string;
}

export class TransacaoDetalheDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    enum: [
      'PIX',
      'BOLETO',
      'CARTAO',
      'SAQUE',
      'CREDITO',
      'ESTORNO',
      'DEVOLUCAO',
    ],
  })
  tipo: string;

  @ApiProperty({ enum: ['PENDENTE', 'CONCLUIDA', 'FALHA'] })
  status: string;

  @ApiProperty({
    enum: ['ENVIADA', 'RECEBIDA'],
    description: 'Sentido da transacao do ponto de vista da conta logada',
  })
  direcao: 'ENVIADA' | 'RECEBIDA';

  @ApiProperty({ example: '50.00' })
  valor: string;

  @ApiProperty({
    nullable: true,
    example: 'E12345678202609291200A1B2C3D4E5F',
    description: 'EndToEndId ISO 20022 (so Pix entre instituicoes)',
  })
  endToEndId: string | null;

  @ApiProperty({
    nullable: true,
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
    description: 'Estado no SPI. Null em Pix interno.',
  })
  statusSpi: string | null;

  @ApiProperty({
    nullable: true,
    example: 'AC03',
    description: 'Motivo do pacs.002 RJCT',
  })
  motivoRejeicao: string | null;

  @ApiProperty({ type: ParteDaTransacaoDto })
  origem: ParteDaTransacaoDto;

  @ApiProperty({ type: ParteDaTransacaoDto })
  destino: ParteDaTransacaoDto;

  @ApiProperty({ enum: ['CPF', 'EMAIL', 'TELEFONE'], nullable: true })
  tipoChave: string | null;

  @ApiProperty({ example: '(11) 97777-2222', nullable: true })
  chaveDestino: string | null;

  @ApiProperty({
    nullable: true,
    description: 'So para quem ENVIOU: e a chave gerada pelo app dele.',
  })
  idempotencyKey: string | null;

  @ApiProperty({
    type: [LancamentoDetalheDto],
    description: 'As 2 pernas da partida dobrada (vazio se nao concluida)',
  })
  lancamentos: LancamentoDetalheDto[];

  @ApiProperty({ example: '2026-09-28T21:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-09-28T21:00:00.120Z' })
  updatedAt: string;
}
