import type { JwtPayload } from '../common/types/jwt-payload.type';

/** Resposta de login/register. */
export interface TokenEmitido {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

/** Payload assinado no JWT (re-exportado para o controller). */
export type PayloadUsuario = JwtPayload;

/** Token + dados da conta, como devolvido por login e register. */
export interface RespostaAutenticacao extends TokenEmitido {
  conta: DadosConta;
}

export interface DadosConta {
  id: string;
  nome: string;
  cpfMasked: string;
}
