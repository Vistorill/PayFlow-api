import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api', { exclude: ['health'] });

  app.useGlobalPipes(
    new ValidationPipe({
      // Payload sem campo declarado e' descartado, nao propagado para o service.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({ origin: true, credentials: true });

  // SIGTERM/SIGINT disparam onModuleDestroy: consumers Kafka saem do grupo
  // (rebalance limpo) e os timers do outbox/reconciliacao/webhooks param.
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Cactvs Payments API')
    .setDescription(
      [
        'Core de pagamentos com ledger em partida dobrada.',
        '',
        'Regras estruturais deste dominio:',
        '- Nenhuma tabela guarda saldo. Saldo = SUM(creditos) - SUM(debitos)',
        '  sobre `lancamentos`, sempre recalculado.',
        "- `lancamentos` e' append-only: nunca UPDATE, nunca DELETE.",
        '- Toda transferencia gera exatamente 2 lancamentos que somam zero.',
        '- A conta de origem vem SEMPRE do JWT, nunca do corpo da requisicao.',
        '',
        'Autentique em POST /api/auth/login e use o `accessToken` no botao',
        '"Authorize" do Swagger. A excecao e\' GET /health, que e\' publico.',
      ].join('\n'),
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();

  SwaggerModule.setup(
    'docs',
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
  );

  const port = config.get<number>('PORT', 3000);
  await app.listen(port);

  console.log(`API      -> http://localhost:${port}/api`);
  console.log(`Swagger  -> http://localhost:${port}/docs`);
  console.log(`Health   -> http://localhost:${port}/health`);
}

void bootstrap();
