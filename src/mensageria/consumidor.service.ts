import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Barramento, type MensagemRecebida } from './barramento';
import type { Envelope } from './envelope';
import { ErroPermanente } from './erros';
import { dlq } from './topicos';

export interface OpcoesConsumidor {
  grupo: string;
  topicos: string[];
  processar: (envelope: Envelope, mensagem: MensagemRecebida) => Promise<void>;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Consumidor padrao: desserializa o envelope, tenta com backoff exponencial e,
 * esgotadas as tentativas (ou em ErroPermanente), manda para `<topico>.dlq`
 * com o motivo nos headers e segue em frente. Uma mensagem venenosa nunca
 * trava a particao.
 *
 * O retry fica no proprio consumidor (e nao em topicos de retry) porque os
 * casos transitorios daqui -- corrida pacs.002 x gravacao local, deadlock --
 * se resolvem em milissegundos. O retry LONGO (minutos/horas) e' o de webhook,
 * que tem agenda propria em banco.
 */
@Injectable()
export class ConsumidorService {
  private readonly logger = new Logger(ConsumidorService.name);
  private readonly maxTentativas: number;
  private readonly backoffBaseMs: number;

  constructor(
    private readonly barramento: Barramento,
    config: ConfigService,
  ) {
    this.maxTentativas = Number(config.get('CONSUMIDOR_MAX_TENTATIVAS', 5));
    this.backoffBaseMs = Number(config.get('CONSUMIDOR_BACKOFF_MS', 200));
  }

  assinar(opcoes: OpcoesConsumidor): Promise<void> {
    return this.barramento.assinar({
      grupo: opcoes.grupo,
      topicos: opcoes.topicos,
      manipulador: (m) => this.manipular(opcoes, m),
    });
  }

  private async manipular(
    opcoes: OpcoesConsumidor,
    mensagem: MensagemRecebida,
  ): Promise<void> {
    let envelope: Envelope;
    try {
      envelope = JSON.parse(mensagem.valor) as Envelope;
      if (!envelope?.eventId || !envelope?.eventType) {
        throw new ErroPermanente('envelope sem eventId/eventType');
      }
    } catch (erro) {
      return this.paraDlq(opcoes.grupo, mensagem, erro as Error, 0);
    }

    for (let tentativa = 1; ; tentativa++) {
      try {
        await opcoes.processar(envelope, mensagem);
        return;
      } catch (erro) {
        const permanente = erro instanceof ErroPermanente;
        if (permanente || tentativa >= this.maxTentativas) {
          return this.paraDlq(opcoes.grupo, mensagem, erro as Error, tentativa);
        }
        const espera = this.backoffBaseMs * 2 ** (tentativa - 1);
        this.logger.warn(
          `[${opcoes.grupo}] ${envelope.eventType} ${envelope.eventId} falhou (tentativa ${tentativa}): ${(erro as Error).message}; nova tentativa em ${espera}ms`,
        );
        await esperar(espera);
      }
    }
  }

  private async paraDlq(
    grupo: string,
    m: MensagemRecebida,
    erro: Error,
    tentativas: number,
  ): Promise<void> {
    this.logger.error(
      `[${grupo}] ${m.topico}@${m.particao}/${m.offset} -> DLQ apos ${tentativas} tentativa(s): ${erro.message}`,
    );
    // Se nem a DLQ aceitar, o erro sobe e o offset nao anda: melhor parar a
    // particao do que perder a mensagem.
    await this.barramento.publicar(dlq(m.topico), [
      {
        chave: m.chave,
        valor: m.valor,
        headers: {
          ...m.headers,
          'dlq-grupo': grupo,
          'dlq-erro': erro.message.slice(0, 500),
          'dlq-tentativas': String(tentativas),
          'dlq-origem': `${m.topico}@${m.particao}/${m.offset}`,
        },
      },
    ]);
  }
}
