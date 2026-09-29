import { Module } from '@nestjs/common';
import { ContasModule } from '../contas/contas.module';
import { PixController } from './pix.controller';
import { PixService } from './pix.service';

@Module({
  // ContasModule: o Pix precisa resolver a chave Pix de destino em uma Conta.
  // Isso e' dependencia de leitura, e o unico ponto de contato entre os dois.
  imports: [ContasModule],
  controllers: [PixController],
  providers: [PixService],
})
export class PixModule {}
