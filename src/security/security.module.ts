import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

/**
 * Isola a configuracao de seguranca do resto da aplicacao.
 *
 * Precisa ser @Global porque o JwtAuthGuard e' registrado como APP_GUARD no
 * modulo raiz. Guard global e' instanciado no contexto do AppModule, entao ele
 * so enxerga o que estiver exportado por modulos globais -- se o JwtModule
 * ficasse so dentro do AuthModule (modulo irmao), a resolucao falharia com
 * UnknownDependenciesException.
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { algorithm: 'HS256' },
      }),
    }),
  ],
  providers: [
    {
      // Default fechado: TODA rota exige token. Libere com @Public().
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
  exports: [JwtModule],
})
export class SecurityModule {}
