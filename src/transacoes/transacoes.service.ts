import { Injectable, NotFoundException } from '@nestjs/common';
import { ocultarCpf } from '../common/utils/chave-pix';
import { paraTexto } from '../common/utils/dinheiro';
import { PrismaService } from '../prisma/prisma.service';
import type {
  ParteDaTransacaoDto,
  TransacaoDetalheDto,
} from './dto/transacao-detalhe.dto';

/**
 * Leitura de uma transacao para o comprovante/detalhe do extrato.
 * So le: quem escreve transacao e ledger continua sendo exclusivamente o Pix.
 */
@Injectable()
export class TransacoesService {
  constructor(private readonly prisma: PrismaService) {}

  async detalhe(
    contaIdDoToken: string,
    transacaoId: string,
  ): Promise<TransacaoDetalheDto> {
    const parte = { select: { id: true, nome: true, cpfMasked: true } };

    // O filtro de participacao vai NO WHERE: transacao alheia e transacao
    // inexistente dao o mesmo 404, sem revelar que o id existe.
    const t = await this.prisma.transacao.findFirst({
      where: {
        id: transacaoId,
        OR: [{ origemId: contaIdDoToken }, { destinoId: contaIdDoToken }],
      },
      include: {
        origem: parte,
        destino: parte,
        lancamentos: {
          // As 2 pernas tem o mesmo instante; o desempate pelo enum (DEBITO
          // vem antes de CREDITO no schema) mostra a saida antes da entrada.
          orderBy: [{ createdAt: 'asc' }, { tipo: 'asc' }],
          include: { conta: { select: { nome: true } } },
        },
      },
    });

    if (!t) {
      throw new NotFoundException('Transacao nao encontrada');
    }

    const enviou = t.origemId === contaIdDoToken;
    const exibirParte = (c: {
      id: string;
      nome: string;
      cpfMasked: string;
    }): ParteDaTransacaoDto => {
      const eVoce = c.id === contaIdDoToken;
      return {
        nome: c.nome,
        cpf: eVoce ? c.cpfMasked : ocultarCpf(c.cpfMasked),
        eVoce,
        externo: false,
        banco: null,
      };
    };

    return {
      id: t.id,
      tipo: t.tipo,
      status: t.status,
      direcao: enviou ? 'ENVIADA' : 'RECEBIDA',
      valor: paraTexto(t.valor),
      endToEndId: t.endToEndId,
      statusSpi: t.statusSpi,
      motivoRejeicao: t.motivoRejeicao,
      // Pix recebido de outro banco (pacs.008): a origem no ledger e' a conta
      // de liquidacao; no comprovante aparece quem pagou.
      origem: t.pagadorNome
        ? {
            nome: t.pagadorNome,
            cpf: null,
            eVoce: false,
            externo: true,
            banco: t.pagadorBanco,
          }
        : exibirParte(t.origem),
      // Pix para outro banco: o destino no ledger e' a conta de liquidacao;
      // no comprovante aparece o favorecido real.
      destino: t.favorecidoNome
        ? {
            nome: t.favorecidoNome,
            cpf: null,
            eVoce: false,
            externo: true,
            banco: t.favorecidoBanco,
          }
        : exibirParte(t.destino),
      tipoChave: t.tipoChave,
      chaveDestino: t.chaveDestino,
      idempotencyKey: enviou ? t.idempotencyKey : null,
      lancamentos: t.lancamentos.map((l) => ({
        id: l.id,
        tipo: l.tipo,
        valor: paraTexto(l.valor),
        descricao: l.descricao,
        conta: l.conta.nome,
        createdAt: l.createdAt.toISOString(),
      })),
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  }
}
