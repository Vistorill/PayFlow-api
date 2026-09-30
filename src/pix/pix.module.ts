import { Module } from '@nestjs/common';
import { ContasModule } from '../contas/contas.module';
import { SpiModule } from '../spi/spi.module';
import { DevolucoesService } from './devolucoes.service';
import { PixController } from './pix.controller';
import { PixService } from './pix.service';
import { PixSpiService } from './spi/pix-spi.service';
import { ReconciliacaoService } from './spi/reconciliacao.service';

@Module({
  // ContasModule: o Pix precisa resolver a chave Pix de destino em uma Conta.
  // Isso e' dependencia de leitura, e o unico ponto de contato entre os dois.
  // SpiModule: a reconciliacao consulta o SPI pelo gateway.
  imports: [ContasModule, SpiModule],
  controllers: [PixController],
  providers: [
    PixService,
    DevolucoesService,
    PixSpiService,
    ReconciliacaoService,
  ],
})
export class PixModule {}
