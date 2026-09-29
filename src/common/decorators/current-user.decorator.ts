import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import type { JwtPayload } from '../types/jwt-payload.type';

export type RequisicaoComUsuario = Request & { user: JwtPayload };

/**
 * Extrai o payload do JWT validado pelo JwtAuthGuard.
 *
 * Regra de ouro: a identidade vem SEMPRE daqui, nunca do body/query params.
 * Se o contaId viesse do body, qualquer um faria uma operacao na conta alheia
 * so trocando um campo no curl.
 */
export const CurrentUser = createParamDecorator(
  (dado: keyof JwtPayload | undefined, contexto: ExecutionContext) => {
    const request = contexto.switchToHttp().getRequest<RequisicaoComUsuario>();
    return dado ? request.user?.[dado] : request.user;
  },
);
