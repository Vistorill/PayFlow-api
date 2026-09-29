import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';

const prisma = new PrismaClient();

const SENHA_PADRAO = 'senha1234';
const SALDO_INICIAL_EM_CENTAVOS = 100000;

/**
 * Contra-conta de tesouraria. Todo dinheiro que entra no sistema precisa sair
 * de algum lugar: sem essa conta, o seed so criaria creditos sem a contrapartida
 * e a soma do ledger nao fecharia em zero.
 */
const CONTA_SISTEMA = {
  nome: 'Conta do Sistema (Tesouraria)',
  cpf: '000.000.000-00',
};

const CONTAS = [
  { nome: 'Ana Souza', email: 'ana@email.com', cpf: '111.444.777-35' },
  { nome: 'Bruno Costa', email: 'bruno@email.com', cpf: '123.456.789-09' },
];

function hashCpf(cpf: string): string {
  return createHash('sha256').update(cpf.replace(/\D/g, '')).digest('hex');
}

function maskCpf(cpf: string): string {
  const d = cpf.replace(/\D/g, '');
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9, 11)}`;
}

async function main() {
  const senhaHash = await bcrypt.hash(SENHA_PADRAO, 10);

  const sistema = await prisma.conta.upsert({
    where: { cpfHash: hashCpf(CONTA_SISTEMA.cpf) },
    update: {},
    create: {
      nome: CONTA_SISTEMA.nome,
      cpfMasked: maskCpf(CONTA_SISTEMA.cpf),
      cpfHash: hashCpf(CONTA_SISTEMA.cpf),
    },
  });

  for (const entrada of CONTAS) {
    const conta = await prisma.conta.upsert({
      where: { cpfHash: hashCpf(entrada.cpf) },
      update: {},
      create: {
        nome: entrada.nome,
        cpfMasked: maskCpf(entrada.cpf),
        cpfHash: hashCpf(entrada.cpf),
      },
    });

    await prisma.usuario.upsert({
      where: { email: entrada.email },
      update: {},
      create: { email: entrada.email, senhaHash, contaId: conta.id },
    });

    /**
     * Saldo de partida entra pelo LEDGER. Nao existe coluna `saldo` para
     * inicializar -- uma conta sem lancamento tem saldo 0 por construcao.
     */
    const jaTemLancamento = await prisma.lancamento.count({ where: { contaId: conta.id } });

    if (jaTemLancamento === 0) {
      const valor = SALDO_INICIAL_EM_CENTAVOS / 100;
      const transacao = await prisma.transacao.create({
        data: {
          idempotencyKey: `seed-abertura-${conta.id}`,
          tipo: 'CREDITO',
          status: 'CONCLUIDA',
          valor,
          origemId: sistema.id,
          destinoId: conta.id,
        },
      });

      // Partida dobrada: o dinheiro sai da tesouraria e credita a conta nova.
      await prisma.lancamento.createMany({
        data: [
          {
            transacaoId: transacao.id,
            contaId: sistema.id,
            tipo: 'DEBITO',
            valor,
            descricao: `Funding inicial para ${entrada.nome}`,
          },
          {
            transacaoId: transacao.id,
            contaId: conta.id,
            tipo: 'CREDITO',
            valor,
            descricao: 'Saldo inicial',
          },
        ],
      });
    }

    console.log(
      `  ${entrada.nome.padEnd(14)} ${entrada.email.padEnd(18)} cpf ${conta.cpfMasked}  senha: ${SENHA_PADRAO}`,
    );
  }

  const totalCreditos = await prisma.lancamento.aggregate({
    where: { tipo: 'CREDITO' },
    _sum: { valor: true },
  });
  const totalDebitos = await prisma.lancamento.aggregate({
    where: { tipo: 'DEBITO' },
    _sum: { valor: true },
  });

  console.log('\n--- Conference do ledger (deve fechar em 0.00) ---');
  console.log(`  Total creditos: ${totalCreditos._sum.valor}`);
  console.log(`  Total debitos : ${totalDebitos._sum.valor}`);

  console.log('\nSeed concluido. Login:');
  console.log('  POST /api/auth/login');
  console.log(`  { "email": "ana@email.com", "senha": "${SENHA_PADRAO}" }`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (erro: unknown) => {
    const codigo = (erro as { code?: string }).code;
    console.error('\nFalha no seed.\n');
    console.error(`  codigo : ${codigo ?? '(desconhecido)'}`);
    console.error(`  mensagem: ${(erro as Error)?.message ?? '(vazia)'}`);

    if (codigo === 'P1000') {
      console.error('\n  -> Usuario ou senha do banco incorretos.');
      console.error('  -> Confira o DATABASE_URL no arquivo .env');
      console.error('  -> O usuario precisa existir. Rode database\\setup.sql como root.');
    }
    if (codigo === 'P1001') {
      console.error('\n  -> Banco cactvs_payments nao existe. Rode database\\setup.sql.');
    }

    if (codigo === 'P1000' || codigo === 'P1001') {
      console.error('\n  Como criar o acesso (abra o MySQL como root):');
      console.error('    mysql -u root -p < database\\setup.sql');
      console.error('  Ou use o MySQL Workbench e execute o arquivo por la.');
    }

    await prisma.$disconnect();
    process.exit(1);
  });
