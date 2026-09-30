import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { eConflitoDeUnico } from '../common/utils/prisma';
import { PrismaService } from '../prisma/prisma.service';
import type { Tx } from './outbox.service';

/**
 * Inbox (mensageria.md, secao 3.2): consumo idempotente.
 *
 * O INSERT na inbox vai na MESMA transacao do efeito. Duas entregas da mesma
 * mensagem em paralelo: a segunda bloqueia no indice ate a primeira commitar e
 * entao estoura P2002 -- e ai sabemos que ja foi feito. Se o efeito falhar, a
 * inbox sai junto no rollback e a reentrega processa de novo.
 */
@Injectable()
export class InboxService {
  constructor(private readonly prisma: PrismaService) {}

  /** @returns false se a mensagem ja tinha sido processada por este consumidor. */
  async processarUmaVez(
    consumidor: string,
    messageId: string,
    efeito: (tx: Tx) => Promise<void>,
  ): Promise<boolean> {
    try {
      await this.prisma.$transaction(
        async (tx) => {
          await tx.inboxEvento.create({ data: { consumidor, messageId } });
          await efeito(tx);
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
          timeout: 15_000,
        },
      );
      return true;
    } catch (erro) {
      if (
        eConflitoDeUnico(erro) &&
        (await this.jaProcessada(consumidor, messageId))
      ) {
        return false;
      }
      throw erro;
    }
  }

  async jaProcessada(consumidor: string, messageId: string): Promise<boolean> {
    const linha = await this.prisma.inboxEvento.findUnique({
      where: { consumidor_messageId: { consumidor, messageId } },
    });
    return linha !== null;
  }

  /** Para efeitos que nao cabem numa transacao (HTTP externo). */
  async marcar(consumidor: string, messageId: string): Promise<void> {
    try {
      await this.prisma.inboxEvento.create({ data: { consumidor, messageId } });
    } catch (erro) {
      if (!eConflitoDeUnico(erro)) throw erro;
    }
  }
}
