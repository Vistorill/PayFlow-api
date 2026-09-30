import { ApiProperty } from '@nestjs/swagger';

export class LancamentoResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    enum: ['DEBITO', 'CREDITO'],
    description: 'DEBITO sai da conta. CREDITO entra.',
  })
  tipo: string;

  @ApiProperty({
    example: '50.00',
    description:
      'String com 2 casas. Nunca number: double nao representa centavos.',
  })
  valor: string;

  @ApiProperty({ example: 'Pix enviado para Bruno Costa' })
  descricao: string;

  @ApiProperty({ format: 'uuid', description: 'Transacao que originou o fato' })
  transacaoId: string;

  @ApiProperty({ example: '2026-01-01T12:00:00.000Z' })
  createdAt: string;

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
  tipoTransacao: string;

  @ApiProperty({ enum: ['CPF', 'EMAIL', 'TELEFONE'], nullable: true })
  tipoChave: string | null;

  @ApiProperty({
    example: '(11) 97777-2222',
    nullable: true,
    description: 'Chave Pix usada na transacao (null se nao for Pix)',
  })
  chaveDestino: string | null;

  @ApiProperty({
    enum: ['PENDENTE', 'CONCLUIDA', 'FALHA'],
    description: 'Status da transacao dona do lancamento',
  })
  statusTransacao: string;

  @ApiProperty({
    nullable: true,
    description: 'Estado no SPI (so Pix entre instituicoes)',
  })
  statusSpi: string | null;
}

export class SaldoResponseDto {
  @ApiProperty({ format: 'uuid' })
  contaId: string;

  @ApiProperty({
    example: '1000.00',
    description:
      'Derivado do ledger: SUM(creditos) - SUM(debitos). Nunca fica salvo ' +
      'em coluna.',
  })
  saldo: string;

  @ApiProperty({ example: '1', description: 'Total de lancamentos no ledger' })
  totalLancamentos: number;

  @ApiProperty({ example: '2026-01-01T12:00:00.000Z' })
  calculadoEm: string;
}

export class ExtratoResponseDto {
  @ApiProperty({ format: 'uuid' })
  contaId: string;

  @ApiProperty({
    example: '1000.00',
    description: 'Saldo no instante da consulta, derivado do ledger',
  })
  saldo: string;

  @ApiProperty({ type: () => LancamentoResponseDto })
  lancamentos: LancamentoResponseDto[];

  @ApiProperty({ example: 20, description: 'Tamanho da pagina' })
  take: number;

  @ApiProperty({ example: 0, description: 'Offset da pagina' })
  skip: number;

  @ApiProperty({ example: 4, description: 'Total de lancamentos da conta' })
  total: number;
}
