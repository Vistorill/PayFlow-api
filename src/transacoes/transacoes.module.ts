import { Module } from '@nestjs/common';
import { TransacoesController } from './transacoes.controller';
import { TransacoesService } from './transacoes.service';

/** Leitura de transacoes (comprovante). Nao escreve em nada. */
@Module({
  controllers: [TransacoesController],
  providers: [TransacoesService],
})
export class TransacoesModule {}
