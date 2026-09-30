import { Logger } from '@nestjs/common';
import {
  Barramento,
  type Assinatura,
  type MensagemBarramento,
} from './barramento';

/**
 * Barramento em memoria, para desenvolvimento sem Docker e para testes.
 *
 * Mesma semantica que importa do Kafka: cada consumer group recebe todas as
 * mensagens do topico, em ordem, uma de cada vez; se o manipulador lancar, a
 * mensagem e' reentregue (at-least-once). Nao sobrevive a restart -- quem
 * garante isso em dev e' o outbox, que continua no MySQL.
 */
export class BarramentoMemoria extends Barramento {
  private readonly logger = new Logger(BarramentoMemoria.name);
  private readonly assinaturas: Assinatura[] = [];
  /** Uma fila (cadeia de promises) por grupo+topico: preserva a ordem. */
  private readonly filas = new Map<string, Promise<void>>();
  private offset = 0;

  constructor(private readonly maxReentregas = 5) {
    super();
  }

  publicar(topico: string, mensagens: MensagemBarramento[]): Promise<void> {
    for (const m of mensagens) {
      const offset = String(this.offset++);
      for (const a of this.assinaturas.filter((x) =>
        x.topicos.includes(topico),
      )) {
        const fila = `${a.grupo}|${topico}`;
        const anterior = this.filas.get(fila) ?? Promise.resolve();
        const proxima = anterior.then(() =>
          this.entregar(a, { ...m, topico, particao: 0, offset }),
        );
        this.filas.set(fila, proxima);
      }
    }
    return Promise.resolve();
  }

  private async entregar(
    a: Assinatura,
    m: Parameters<Assinatura['manipulador']>[0],
  ): Promise<void> {
    for (let tentativa = 1; ; tentativa++) {
      try {
        await a.manipulador(m);
        return;
      } catch (erro) {
        if (tentativa >= this.maxReentregas) {
          this.logger.error(
            `[${a.grupo}] mensagem ${m.topico}@${m.offset} descartada apos ${tentativa} reentregas: ${(erro as Error).message}`,
          );
          return;
        }
        await new Promise((r) => setTimeout(r, 100 * tentativa));
      }
    }
  }

  assinar(assinatura: Assinatura): Promise<void> {
    this.assinaturas.push(assinatura);
    return Promise.resolve();
  }

  /** Testes: espera todas as filas esvaziarem. */
  async drenar(): Promise<void> {
    let antes = -1;
    while (antes !== this.offset) {
      antes = this.offset;
      await Promise.all(this.filas.values());
    }
  }
}
