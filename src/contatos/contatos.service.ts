import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { ContatoPix } from '@prisma/client';
import {
  exibirChavePix,
  normalizarChavePix,
  ocultarCpf,
} from '../common/utils/chave-pix';
import { eConflitoDeUnico } from '../common/utils/prisma';
import { ContasService } from '../contas/contas.service';
import { PrismaService } from '../prisma/prisma.service';
import type { ContatoResponseDto } from './dto/contato-response.dto';
import type { CriarContatoDto } from './dto/criar-contato.dto';

type ContatoComDestino = ContatoPix & {
  destino: { nome: string; cpfMasked: string } | null;
};

/**
 * Agenda de contatos Pix. So atalho de UX: o Pix NUNCA confia no contato
 * salvo para chave de cliente PayFlow -- ele resolve o dono de novo.
 *
 * Dois tipos de contato:
 *   - interno: a chave e' de um cliente PayFlow; o nome vem da conta.
 *   - externo: a chave e' de OUTRO banco. Sem DICT real, o usuario informa o
 *     nome do favorecido e o banco; e' este cadastro que autoriza o Pix para
 *     a chave (via conta de liquidacao SPI).
 */
@Injectable()
export class ContatosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contasService: ContasService,
  ) {}

  async listar(contaId: string): Promise<ContatoResponseDto[]> {
    const contatos = await this.prisma.contatoPix.findMany({
      where: { contaId },
      include: { destino: { select: { nome: true, cpfMasked: true } } },
    });
    return contatos
      .map((c) => this.responder(c))
      .sort((a, b) => a.destino.nome.localeCompare(b.destino.nome, 'pt-BR'));
  }

  async criar(
    contaId: string,
    dto: CriarContatoDto,
  ): Promise<ContatoResponseDto> {
    const normalizada = normalizarChavePix(dto.tipoChave, dto.chave);
    if (!normalizada) {
      throw new BadRequestException({
        codigo: 'CHAVE_INVALIDA',
        mensagem: `chave invalida para o tipo ${dto.tipoChave}`,
      });
    }

    const interno = await this.contasService.buscarPorChavePix(
      dto.tipoChave,
      normalizada,
    );

    if (interno && interno.id === contaId) {
      throw new UnprocessableEntityException({
        codigo: 'CONTATO_PROPRIA_CONTA',
        mensagem: 'Esta chave e da sua propria conta',
      });
    }

    const nomeFavorecido = dto.nomeFavorecido?.trim();
    if (!interno && !nomeFavorecido) {
      // Chave desconhecida no PayFlow: pode ser de outro banco. O front usa
      // `podeSalvarExterno` para pedir nome do favorecido e banco.
      throw new NotFoundException({
        codigo: 'CHAVE_NAO_ENCONTRADA',
        mensagem:
          'Nenhuma conta PayFlow usa esta chave. Se ela for de outro banco, ' +
          'informe o nome do favorecido para salvar o contato.',
        podeSalvarExterno: true,
      });
    }

    try {
      const contato = await this.prisma.contatoPix.create({
        data: {
          contaId,
          destinoId: interno?.id ?? null,
          nomeFavorecido: interno ? null : nomeFavorecido,
          banco: interno ? null : dto.banco?.trim() || null,
          tipoChave: dto.tipoChave,
          chave: exibirChavePix(dto.tipoChave, normalizada),
          apelido: dto.apelido?.trim() || null,
        },
        include: { destino: { select: { nome: true, cpfMasked: true } } },
      });
      return this.responder(contato);
    } catch (erro) {
      if (eConflitoDeUnico(erro)) {
        throw new ConflictException({
          codigo: 'CONTATO_JA_EXISTE',
          mensagem: 'Esta chave ja esta nos seus contatos',
        });
      }
      throw erro;
    }
  }

  async remover(contaId: string, id: string): Promise<void> {
    // contaId no WHERE: contato alheio e inexistente dao o mesmo 404.
    const { count } = await this.prisma.contatoPix.deleteMany({
      where: { id, contaId },
    });
    if (count === 0) {
      throw new NotFoundException('Contato nao encontrado');
    }
  }

  private responder(c: ContatoComDestino): ContatoResponseDto {
    const destino = c.destino
      ? {
          nome: c.destino.nome,
          cpf: ocultarCpf(c.destino.cpfMasked),
          externo: false,
          banco: null,
        }
      : {
          nome: c.nomeFavorecido ?? '(sem nome)',
          cpf: null,
          externo: true,
          banco: c.banco,
        };

    return {
      id: c.id,
      apelido: c.apelido,
      tipoChave: c.tipoChave,
      chave: c.chave,
      destino,
      createdAt: c.createdAt.toISOString(),
    };
  }
}
