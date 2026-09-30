import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { ContasModule } from './contas/contas.module';
import { ContatosModule } from './contatos/contatos.module';
import { PixModule } from './pix/pix.module';
import { PrismaModule } from './prisma/prisma.module';
import { HealthController } from './health.controller';
import { MensageriaModule } from './mensageria/mensageria.module';
import { NotificacoesModule } from './notificacoes/notificacoes.module';
import { SecurityModule } from './security/security.module';
import { SpiModule } from './spi/spi.module';
import { TransacoesModule } from './transacoes/transacoes.module';
import { WebhooksModule } from './webhooks/webhooks.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    SecurityModule,
    MensageriaModule,
    AuthModule,
    ContasModule,
    SpiModule,
    PixModule,
    TransacoesModule,
    ContatosModule,
    WebhooksModule,
    NotificacoesModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
