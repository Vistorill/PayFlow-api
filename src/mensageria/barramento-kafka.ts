import { Logger, type OnModuleDestroy } from '@nestjs/common';
import {
  Kafka,
  logLevel,
  Partitioners,
  type Consumer,
  type Producer,
} from 'kafkajs';
import {
  Barramento,
  type Assinatura,
  type MensagemBarramento,
} from './barramento';
import { CONFIG_TOPICOS } from './topicos';

export interface ConfigKafka {
  brokers: string[];
  clientId: string;
  replicacao: number;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Barramento real sobre Kafka (kafkajs).
 *
 * Producer idempotente (acks=all, enable.idempotence) e consumer com commit
 * so depois do manipulador resolver -- o kafkajs so marca o offset como
 * resolvido quando o `eachMessage` termina sem erro.
 *
 * Se o broker estiver fora do ar na subida, a API continua de pe: o outbox
 * acumula e o relay tenta de novo; os consumidores reconectam em background.
 */
export class BarramentoKafka extends Barramento implements OnModuleDestroy {
  private readonly logger = new Logger(BarramentoKafka.name);
  private readonly kafka: Kafka;
  private readonly producer: Producer;
  private readonly consumers: Consumer[] = [];
  private conectado: Promise<void> | null = null;
  private encerrando = false;

  constructor(private readonly config: ConfigKafka) {
    super();
    this.kafka = new Kafka({
      clientId: config.clientId,
      brokers: config.brokers,
      logLevel: logLevel.WARN,
      retry: { initialRetryTime: 300, retries: 8 },
    });
    this.producer = this.kafka.producer({
      idempotent: true,
      // Idempotencia do kafkajs exige 1 requisicao em voo por conexao.
      maxInFlightRequests: 1,
      createPartitioner: Partitioners.DefaultPartitioner,
    });
  }

  private conectarProducer(): Promise<void> {
    this.conectado ??= (async () => {
      await this.criarTopicos();
      await this.producer.connect();
      this.logger.log(`Kafka conectado em ${this.config.brokers.join(',')}`);
    })().catch((erro: unknown) => {
      // Permite nova tentativa na proxima publicacao.
      this.conectado = null;
      throw erro;
    });
    return this.conectado;
  }

  private async criarTopicos(): Promise<void> {
    const admin = this.kafka.admin();
    await admin.connect();
    try {
      const existentes = new Set(await admin.listTopics());
      const faltando = CONFIG_TOPICOS.filter((t) => !existentes.has(t.topico));
      if (faltando.length) {
        await admin.createTopics({
          waitForLeaders: true,
          topics: faltando.map((t) => ({
            topic: t.topico,
            numPartitions: t.particoes,
            replicationFactor: this.config.replicacao,
          })),
        });
        this.logger.log(
          `Topicos criados: ${faltando.map((t) => t.topico).join(', ')}`,
        );
      }
    } finally {
      await admin.disconnect();
    }
  }

  async publicar(
    topico: string,
    mensagens: MensagemBarramento[],
  ): Promise<void> {
    await this.conectarProducer();
    await this.producer.send({
      topic: topico,
      acks: -1,
      messages: mensagens.map((m) => ({
        key: m.chave,
        value: m.valor,
        headers: m.headers,
      })),
    });
  }

  async assinar(assinatura: Assinatura): Promise<void> {
    // Nao bloqueia a subida da aplicacao esperando o broker.
    void this.iniciarConsumer(assinatura);
    return Promise.resolve();
  }

  private async iniciarConsumer(a: Assinatura): Promise<void> {
    for (let tentativa = 1; !this.encerrando; tentativa++) {
      const consumer = this.kafka.consumer({
        groupId: a.grupo,
        // Leitura so do que foi commitado por produtores transacionais.
        readUncommitted: false,
      });
      try {
        await this.conectarProducer(); // garante os topicos criados
        await consumer.connect();
        await consumer.subscribe({ topics: a.topicos, fromBeginning: true });
        await consumer.run({
          autoCommit: true,
          eachMessage: async ({ topic, partition, message }) => {
            await a.manipulador({
              topico: topic,
              particao: partition,
              offset: message.offset,
              chave: message.key?.toString() ?? '',
              valor: message.value?.toString() ?? '',
              headers: Object.fromEntries(
                Object.entries(message.headers ?? {}).map(([k, v]) => [
                  k,
                  v?.toString() ?? '',
                ]),
              ),
            });
          },
        });
        this.consumers.push(consumer);
        this.logger.log(`Consumer ${a.grupo} ouvindo ${a.topicos.join(', ')}`);
        return;
      } catch (erro) {
        await consumer.disconnect().catch(() => undefined);
        const espera = Math.min(30_000, 1_000 * 2 ** Math.min(tentativa, 5));
        this.logger.warn(
          `Consumer ${a.grupo} sem Kafka (${(erro as Error).message}); nova tentativa em ${espera}ms`,
        );
        await esperar(espera);
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.encerrando = true;
    await Promise.allSettled(this.consumers.map((c) => c.disconnect()));
    await this.producer.disconnect().catch(() => undefined);
  }
}
