import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { normalizarTelefone } from '../common/utils/chave-pix';
import { hashCpf, maskCpf } from '../common/utils/cpf';
import { eConflitoDeUnico } from '../common/utils/prisma';
import { PrismaService } from '../prisma/prisma.service';
import type { DadosConta, RespostaAutenticacao } from './auth.types';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

const BCRYPT_SALT_ROUNDS = 10;
const TOKEN_EXPIRA_EM_SEGUNDOS = 3600;

/** Hash descartavel: mantem o custo de bcrypt mesmo sem usuario cadastrado. */
const HASH_FALSO =
  '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Register cria DUAS entidades em uma unica transacao:
   *   - Conta   (Servico de Contas): identidade -- quem e' a pessoa
   *   - Usuario (Auth Service):      credencial -- como ela entra
   * Nao existe usuario sem conta neste dominio.
   */
  async register(dto: RegisterDto): Promise<RespostaAutenticacao> {
    const emailNormalizado = dto.email.trim().toLowerCase();
    const cpfHash = hashCpf(dto.cpf);
    const cpfMasked = maskCpf(dto.cpf);
    const nome = dto.nome.trim();

    let telefone: string | null = null;
    if (dto.telefone) {
      telefone = normalizarTelefone(dto.telefone);
      if (!telefone) {
        throw new BadRequestException(
          'telefone deve ter DDD + 8 ou 9 digitos, ex.: (11) 98888-1111',
        );
      }
    }

    // Checagem antecipada so para uma mensagem de erro amigavel. A garantia real
    // de unicidade vem do indice UNIQUE do banco (ver tratarConflitoUnico).
    const contaExistente = await this.prisma.conta.findUnique({
      where: { cpfHash },
      select: { id: true },
    });
    if (contaExistente) {
      throw new ConflictException('Ja existe uma conta com este CPF');
    }
    if (
      telefone &&
      (await this.prisma.conta.findUnique({
        where: { telefone },
        select: { id: true },
      }))
    ) {
      throw new ConflictException('Ja existe uma conta com este telefone');
    }

    const senhaHash = await bcrypt.hash(dto.senha, BCRYPT_SALT_ROUNDS);

    try {
      const usuario = await this.prisma.$transaction(async (tx) => {
        const conta = await tx.conta.create({
          data: { nome, cpfMasked, cpfHash, telefone },
        });

        return tx.usuario.create({
          data: { email: emailNormalizado, senhaHash, contaId: conta.id },
        });
      });

      this.logger.log(
        `Conta ${usuario.contaId} registrada (usuario ${usuario.id})`,
      );

      return this.montarResposta(
        { sub: usuario.id, contaId: usuario.contaId, email: usuario.email },
        { id: usuario.contaId, nome, cpfMasked },
      );
    } catch (erro) {
      if (eConflitoDeUnico(erro)) {
        throw new ConflictException(
          'Ja existe um registro com este email, CPF ou telefone',
        );
      }
      throw erro;
    }
  }

  async login(dto: LoginDto): Promise<RespostaAutenticacao> {
    const emailNormalizado = dto.email.trim().toLowerCase();

    const usuario = await this.prisma.usuario.findUnique({
      where: { email: emailNormalizado },
      include: { conta: true },
    });

    /**
     * Mesmo sem usuario cadastrado, comparamos contra um hash falso. Sem isso o
     * tempo de resposta revelaria quais e-mails existem (user enumeration).
     */
    const senhaConfere = await bcrypt.compare(
      dto.senha,
      usuario?.senhaHash ?? HASH_FALSO,
    );

    if (!usuario || !senhaConfere) {
      throw new UnauthorizedException('Email ou senha invalidos');
    }

    return this.montarResposta(
      { sub: usuario.id, contaId: usuario.contaId, email: usuario.email },
      {
        id: usuario.contaId,
        nome: usuario.conta.nome,
        cpfMasked: usuario.conta.cpfMasked,
      },
    );
  }

  async perfil(contaId: string): Promise<DadosConta> {
    const conta = await this.prisma.conta.findUnique({
      where: { id: contaId },
    });

    if (!conta) {
      throw new BadRequestException('Conta do token nao existe mais');
    }

    return { id: conta.id, nome: conta.nome, cpfMasked: conta.cpfMasked };
  }

  private async montarResposta(
    payload: { sub: string; contaId: string; email: string },
    conta: DadosConta,
  ): Promise<RespostaAutenticacao> {
    const accessToken = await this.jwtService.signAsync(payload, {
      expiresIn: TOKEN_EXPIRA_EM_SEGUNDOS,
    });

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: TOKEN_EXPIRA_EM_SEGUNDOS,
      conta,
    };
  }
}
