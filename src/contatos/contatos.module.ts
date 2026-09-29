import { Module } from '@nestjs/common';
import { ContasModule } from '../contas/contas.module';
import { ContatosController } from './contatos.controller';
import { ContatosService } from './contatos.service';

/** Agenda de contatos Pix. Usa o Contas so para confirmar o dono da chave. */
@Module({
  imports: [ContasModule],
  controllers: [ContatosController],
  providers: [ContatosService],
})
export class ContatosModule {}
