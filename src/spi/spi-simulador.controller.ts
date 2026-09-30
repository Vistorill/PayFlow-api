import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { paraDecimal } from '../common/utils/dinheiro';
import {
  SimularDevolucaoRecebidaDto,
  SimularPixRecebidoDto,
} from './dto/simulador.dto';
import { SpiGateway } from './spi.gateway';
import { SpiSimulador } from './spi-simulador';

const centavos = (valor: string) => paraDecimal(valor).mul(100).toNumber();

/**
 * Trafego de ENTRADA do SPI em desenvolvimento: faz "outro banco" mandar um
 * pacs.008 ou pacs.004 para nos. So existe com o simulador ligado.
 */
@ApiTags('spi-simulador')
@ApiBearerAuth()
@Controller('spi/simulador')
export class SpiSimuladorController {
  constructor(
    private readonly gateway: SpiGateway,
    private readonly config: ConfigService,
  ) {}

  private simulador(): SpiSimulador {
    if (
      !(this.gateway instanceof SpiSimulador) ||
      this.config.get('NODE_ENV') === 'production'
    ) {
      throw new NotFoundException();
    }
    return this.gateway;
  }

  @Post('pix-recebido')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Outro banco paga um cliente Cactvs (chega um pacs.008)',
    description:
      'O pacs.008 chega ao SPI Adapter apos o atraso configurado, vira ' +
      'evento no Kafka, o core credita a conta e responde pacs.002. O cliente ' +
      'recebe push + webhook `pix.payment.received`.',
  })
  pixRecebido(@Body() dto: SimularPixRecebidoDto) {
    return this.simulador().simularPixRecebido({
      cents: centavos(dto.valor),
      dictKey: dto.chave,
      pagadorNome: dto.pagadorNome ?? 'Pagador Externo',
      pagadorDocumento: '98765432100',
      mensagem: dto.mensagem,
    });
  }

  @Post('devolucao-recebida')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Outro banco devolve um Pix que enviamos (chega um pacs.004)',
  })
  devolucaoRecebida(@Body() dto: SimularDevolucaoRecebidaDto) {
    return this.simulador().simularDevolucaoRecebida({
      endToEndIdOriginal: dto.endToEndId,
      cents: centavos(dto.valor),
      motivo: dto.motivo ?? 'MD06',
    });
  }
}
