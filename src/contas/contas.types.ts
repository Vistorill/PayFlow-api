import type { Dinheiro } from '../common/utils/dinheiro';

/** Conta como o dominio a enxerga: identidade, nunca dinheiro. */
export interface ContaPublica {
  id: string;
  nome: string;
  cpfMasked: string;
}

export interface LancamentoExtrato {
  id: string;
  transacaoId: string;
  tipo: 'DEBITO' | 'CREDITO';
  valor: Dinheiro;
  descricao: string;
  createdAt: Date;
}

export interface ConsultaSaldo {
  contaId: string;
  saldo: Dinheiro;
  totalLancamentos: number;
}

export interface ConsultaExtrato {
  contaId: string;
  saldo: Dinheiro;
  lancamentos: LancamentoExtrato[];
  take: number;
  skip: number;
  total: number;
}
