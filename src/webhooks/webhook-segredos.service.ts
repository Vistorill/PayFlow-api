import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { WebhookEndpoint } from '@prisma/client';
import { chaveDeCifra, cifrar, decifrar } from './webhook-cripto';

/** Cifra/decifra os segredos HMAC dos endpoints (AES-256-GCM). */
@Injectable()
export class WebhookSegredosService {
  private readonly chave: Buffer;

  constructor(config: ConfigService) {
    this.chave = chaveDeCifra(
      config.get<string>('WEBHOOK_CHAVE_CIFRA'),
      config.getOrThrow<string>('JWT_SECRET'),
    );
  }

  cifrar(segredo: string): string {
    return cifrar(this.chave, segredo);
  }

  /** Segredos que assinam agora: o atual e, na janela de rotacao, o anterior. */
  ativos(e: WebhookEndpoint): string[] {
    const segredos = [decifrar(this.chave, e.segredoCifrado)];
    if (
      e.segredoAnteriorCifrado &&
      e.segredoAnteriorAte &&
      e.segredoAnteriorAte > new Date()
    ) {
      segredos.push(decifrar(this.chave, e.segredoAnteriorCifrado));
    }
    return segredos;
  }
}
