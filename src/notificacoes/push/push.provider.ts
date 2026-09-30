import { Logger } from '@nestjs/common';

export interface MensagemPush {
  titulo: string;
  corpo: string;
  dados: Record<string, unknown>;
}

export interface ResultadoPush {
  /** Tokens que o provedor disse nao existirem mais: desativar. */
  tokensInvalidos: string[];
}

/** Porta de envio de push. PUSH_PROVEDOR=expo | log. */
export abstract class PushProvider {
  abstract enviar(tokens: string[], m: MensagemPush): Promise<ResultadoPush>;
}

/** Dev: so registra no log. */
export class LogPushProvider extends PushProvider {
  private readonly logger = new Logger('Push');

  enviar(tokens: string[], m: MensagemPush): Promise<ResultadoPush> {
    this.logger.log(
      `[push -> ${tokens.length} dispositivo(s)] ${m.titulo}: ${m.corpo}`,
    );
    return Promise.resolve({ tokensInvalidos: [] });
  }
}

interface TicketExpo {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

/**
 * Expo Push API: o app React Native (Expo) obtem o token com
 * `Notifications.getExpoPushTokenAsync()` e registra em
 * POST /api/notificacoes/dispositivos. O Expo entrega via FCM (Android) e
 * APNs (iOS) sem credencial no backend; EXPO_ACCESS_TOKEN e' opcional.
 */
export class ExpoPushProvider extends PushProvider {
  private readonly logger = new Logger('ExpoPush');
  private static readonly URL = 'https://exp.host/--/api/v2/push/send';

  constructor(private readonly accessToken?: string) {
    super();
  }

  async enviar(tokens: string[], m: MensagemPush): Promise<ResultadoPush> {
    const tokensInvalidos: string[] = [];
    // Limite da API: 100 mensagens por requisicao.
    for (let i = 0; i < tokens.length; i += 100) {
      const lote = tokens.slice(i, i + 100);
      const resposta = await fetch(ExpoPushProvider.URL, {
        method: 'POST',
        signal: AbortSignal.timeout(10_000),
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(this.accessToken
            ? { Authorization: `Bearer ${this.accessToken}` }
            : {}),
        },
        body: JSON.stringify(
          lote.map((to) => ({
            to,
            title: m.titulo,
            body: m.corpo,
            data: m.dados,
            sound: 'default',
            priority: 'high',
            channelId: 'pix',
          })),
        ),
      });
      if (!resposta.ok) {
        throw new Error(`Expo push HTTP ${resposta.status}`);
      }
      const { data } = (await resposta.json()) as { data: TicketExpo[] };
      data.forEach((ticket, idx) => {
        if (ticket.status === 'error') {
          this.logger.warn(
            `Push recusado para ${lote[idx]}: ${ticket.message}`,
          );
          if (ticket.details?.error === 'DeviceNotRegistered')
            tokensInvalidos.push(lote[idx]);
        }
      });
    }
    return { tokensInvalidos };
  }
}
