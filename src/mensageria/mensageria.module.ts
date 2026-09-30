import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Barramento } from './barramento';
import { BarramentoKafka } from './barramento-kafka';
import { BarramentoMemoria } from './barramento-memoria';
import { ConsumidorService } from './consumidor.service';
import { InboxService } from './inbox.service';
import { OutboxRelayService } from './outbox-relay.service';
import { OutboxService } from './outbox.service';

/**
 * Infraestrutura de mensageria, compartilhada por Pix, SPI, webhooks e push.
 *
 *   MENSAGERIA_DRIVER=kafka   -> Kafka real (docker compose up -d)
 *   MENSAGERIA_DRIVER=memoria -> barramento em processo (default; dev sem Docker)
 */
@Global()
@Module({
  providers: [
    {
      provide: Barramento,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Barramento => {
        const driver = config.get<string>('MENSAGERIA_DRIVER', 'memoria');
        const logger = new Logger('Mensageria');
        if (driver === 'kafka') {
          const brokers = config
            .get<string>('KAFKA_BROKERS', 'localhost:9092')
            .split(',')
            .map((b) => b.trim());
          logger.log(`Driver Kafka (${brokers.join(', ')})`);
          return new BarramentoKafka({
            brokers,
            clientId: config.get<string>('KAFKA_CLIENT_ID', 'cactvs-backend'),
            replicacao: Number(config.get('KAFKA_REPLICACAO', 1)),
          });
        }
        logger.log(
          'Driver em memoria (MENSAGERIA_DRIVER=kafka para usar Kafka)',
        );
        return new BarramentoMemoria();
      },
    },
    OutboxService,
    OutboxRelayService,
    InboxService,
    ConsumidorService,
  ],
  exports: [
    Barramento,
    OutboxService,
    OutboxRelayService,
    InboxService,
    ConsumidorService,
  ],
})
export class MensageriaModule {}
