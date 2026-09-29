import { Module } from '@nestjs/common';
import { ContasController } from './contas.controller';
import { ContasService } from './contas.service';

/**
 * Leitura de conta. Exporta o service porque o modulo Pix depende de
 * `buscarPorChavePix` para resolver o destino de uma transferencia -- mas
 * expoe o SERVICE, nao o controller: quem resolve chave Pix e' o Pix, e a
 * leitura de saldo/extrato continua sendo responsabilidad do Contas.
 */
@Module({
  controllers: [ContasController],
  providers: [ContasService],
  exports: [ContasService],
})
export class ContasModule {}
