import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SpiAdapterService } from './spi-adapter.service';
import { SpiSimulador } from './spi-simulador';
import { SpiSimuladorController } from './spi-simulador.controller';
import { SpiGateway } from './spi.gateway';

/**
 * SPI Adapter + gateway. SPI_DRIVER=simulador (unico disponivel hoje); a
 * conexao real (RSFN ou PSP parceiro) entra como outra implementacao de
 * SpiGateway.
 */
@Module({
  controllers: [SpiSimuladorController],
  providers: [
    {
      provide: SpiGateway,
      inject: [ConfigService],
      useFactory: (config: ConfigService): SpiGateway =>
        new SpiSimulador({
          ispb: config.get<string>('PIX_ISPB', '12345678'),
          ispbContraparte: config.get<string>(
            'SPI_ISPB_CONTRAPARTE',
            '87654321',
          ),
          atrasoMs: Number(config.get('SPI_SIMULADOR_ATRASO_MS', 1500)),
        }),
    },
    SpiAdapterService,
  ],
  exports: [SpiGateway],
})
export class SpiModule {}
