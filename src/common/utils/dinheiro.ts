import { Prisma } from '@prisma/client';

/**
 * Dinheiro no dominio e' DECIMAL(15,2) no MySQL, mapeado pelo Prisma para um
 * objeto Decimal.js. Nunca sai para o JSON cru: isso viraria
 * {"valor":{"s":"1","e":2,"d":[5,0]}} e o front teria que fazer parse manual.
 *
 * A regra: toda fronteira (DTO de saida) converte com `paraTexto`, que fixa 2
 * casas. Internamente a aritmetica e' feita com Decimal, nunca com float --
 * 0.1 + 0.2 em double da 0.30000000000000004.
 */
export type Dinheiro = Prisma.Decimal;

export const ZERO = new Prisma.Decimal(0);

export function paraDecimal(valor: string | number | Dinheiro): Dinheiro {
  return new Prisma.Decimal(valor);
}

/**
 * saldo = SUM(valor WHERE tipo = CREDITO) - SUM(valor WHERE tipo = DEBITO)
 *
 * O saldo nao existe em tabela nenhuma. Ele e' sempre recalculado a partir
 * do ledger, e por isso pode ser reconstruido do zero a qualquer momento:
 * se um dia ficar lento, materializamos um cache e o ledger continua sendo a
 * fonte da verdade.
 */
export function saldoDoLedger(
  agrupado: { tipo: string; _sum: { valor: Dinheiro | null } }[],
): Dinheiro {
  let creditos = new Prisma.Decimal(0);
  let debitos = new Prisma.Decimal(0);

  for (const linha of agrupado) {
    const total = linha._sum.valor;
    if (!total) continue;

    if (linha.tipo === 'CREDITO') {
      creditos = creditos.add(total);
    } else if (linha.tipo === 'DEBITO') {
      debitos = debitos.add(total);
    }
  }

  return creditos.sub(debitos);
}

/**
 * Serializacao de dinheiro na fronteira HTTP.
 *
 * String, e nao number: um double nao representa 0.1 exatamente, e o front
 * exibiria "0.1" num lugar e "0.10" noutro. String de 2 casas e' o contrato
 * estavel -- o front so precisa formatar para o locale dele.
 */
export function paraTexto(valor: Dinheiro): string {
  return valor.toFixed(2);
}

/**
 * Comparacao de saldo >= valor, feita em Decimal.
 *
 * Existe como funcao para deixar o ponto de checagem explicito no Pix: e a
 * unica regra de negocio que impede saldo negativo, e ela precisa ser lida
 * em um lugar so.
 */
export function saldoCobre(saldo: Dinheiro, valor: Dinheiro): boolean {
  return saldo.greaterThanOrEqualTo(valor);
}
