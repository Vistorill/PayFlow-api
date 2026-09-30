import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificacoesController } from './notificacoes.controller';
import { NotificacoesService } from './notificacoes.service';
import {
  ExpoPushProvider,
  LogPushProvider,
  PushProvider,
} from './push/push.provider';

@Module({
  controllers: [NotificacoesController],
  providers: [
    NotificacoesService,
    {
      provide: PushProvider,
      inject: [ConfigService],
      useFactory: (config: ConfigService): PushProvider => {
        const provedor = config.get<string>('PUSH_PROVEDOR', 'log');
        new Logger('Push').log(`Provedor de push: ${provedor}`);
        return provedor === 'expo'
          ? new ExpoPushProvider(config.get<string>('EXPO_ACCESS_TOKEN'))
          : new LogPushProvider();
      },
    },
  ],
})
export class NotificacoesModule {}
