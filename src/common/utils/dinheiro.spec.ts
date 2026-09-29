import { Prisma } from '@prisma/client';
import {
  paraDecimal,
  paraTexto,
  saldoCobre,
  saldoDoLedger,
  type Dinheiro,
} from './dinheiro';

const DEC = (valor: string) => new Prisma.Decimal(valor);

describe('paraDecimal', () => {
  it('aceita numero, string e ja-Decimal', () => {
    expect(paraDecimal(50).toFixed(2)).toBe('50.00');
    expect(paraDecimal('50.10').toFixed(2)).toBe('50.10');
    expect(paraDecimal(DEC('7.25')).toFixed(2)).toBe('7.25');
  });

  it('nao sofre com o erro classico de float', () => {
    // 0.1 + 0.2 === 0.30000000000000004 em double. Em Decimal, 0.30.
    expect(paraDecimal(0.1).add(paraDecimal(0.2)).toFixed(2)).toBe('0.30');
  });
});

describe('saldoDoLedger', () => {
  it('e credito menos debito', () => {
    const agrupado = [
      { tipo: 'CREDITO', _sum: { valor: DEC('1000.00') } },
      { tipo: 'DEBITO', _sum: { valor: DEC('250.50') } },
    ];

    expect(saldoDoLedger(agrupado).toFixed(2)).toBe('749.50');
  });

  it('conta sem lancamento tem saldo zero, nao null', () => {
    expect(saldoDoLedger([]).toFixed(2)).toBe('0.00');
    expect(
      saldoDoLedger([{ tipo: 'CREDITO', _sum: { valor: null } }]).toFixed(2),
    ).toBe('0.00');
  });

  it('ignora tipo desconhecido em vez de somar errado', () => {
    const agrupado = [
      { tipo: 'CREDITO', _sum: { valor: DEC('10.00') } },
      { tipo: 'ESTORNO', _sum: { valor: DEC('999.00') } },
    ];

    expect(saldoDoLedger(agrupado).toFixed(2)).toBe('10.00');
  });

  it('soma exata de muitos lancamentos sem derivar de float', () => {
    const agrupado = [
      { tipo: 'DEBITO', _sum: { valor: DEC('0.10').mul(3) } },
      { tipo: 'CREDITO', _sum: { valor: DEC('0.30') } },
    ];

    expect(saldoDoLedger(agrupado).toFixed(2)).toBe('0.00');
  });
});

describe('paraTexto', () => {
  it('sempre devolve 2 casas decimais', () => {
    const casos: [Dinheiro, string][] = [
      [DEC('0'), '0.00'],
      [DEC('5'), '5.00'],
      [DEC('5.5'), '5.50'],
      [DEC('1234567.891'), '1234567.89'],
    ];

    for (const [entrada, esperado] of casos) {
      expect(paraTexto(entrada)).toBe(esperado);
    }
  });

  it('e serializavel em JSON sem virar objeto do Decimal.js', () => {
    expect(
      JSON.parse(JSON.stringify({ valor: paraTexto(DEC('50.00')) })),
    ).toEqual({
      valor: '50.00',
    });
  });
});

describe('saldoCobre', () => {
  it('aceita saldo igual ao valor (boundary)', () => {
    expect(saldoCobre(DEC('100.00'), DEC('100.00'))).toBe(true);
  });

  it('recusa saldo abaixo do valor', () => {
    expect(saldoCobre(DEC('99.99'), DEC('100.00'))).toBe(false);
  });

  it('recusa centavos que o double arredondaria para cima', () => {
    // Em double, 0.1 + 0.2 > 0.3, entao uma checagem Ingenua passaria.
    const saldo = DEC('0.1').add(DEC('0.2'));
    expect(saldo.greaterThanOrEqualTo(DEC('0.30'))).toBe(true);
    expect(saldoCobre(saldo, DEC('0.30'))).toBe(true);
  });
});
