import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { ContasModule } from './contas/contas.module';
import { ContatosModule } from './contatos/contatos.module';
import { PixModule } from './pix/pix.module';
import { PrismaModule } from './prisma/prisma.module';
import { HealthController } from './health.controller';
import { SecurityModule } from './security/security.module';
import { TransacoesModule } from './transacoes/transacoes.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    SecurityModule,
    AuthModule,
    ContasModule,
    PixModule,
    TransacoesModule,
    ContatosModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
