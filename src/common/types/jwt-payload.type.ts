/** Payload assinado no JWT. E' a unica fonte de identidade confiavel. */
export interface JwtPayload {
  /** Usuario.id */
  sub: string;
  /** Conta.id -- derivado do token, NUNCA lido do body da requisicao. */
  contaId: string;
  email: string;
}
