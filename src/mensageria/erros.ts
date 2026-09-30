/**
 * Classificacao de falha no consumidor (mensageria.md, secao 11):
 *   - transitoria: tenta de novo com backoff (ex.: pacs.002 chegou antes do
 *     registro local do envio, banco fora, deadlock);
 *   - permanente: vai direto para a DLQ (mensagem invalida, regra violada).
 * Erro nao classificado e' tratado como transitorio.
 */
export class ErroPermanente extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroPermanente';
  }
}

export class ErroTransitorio extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroTransitorio';
  }
}
