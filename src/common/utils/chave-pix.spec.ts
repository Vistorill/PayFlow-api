import {
  exibirChavePix,
  normalizarChavePix,
  normalizarTelefone,
  ocultarCpf,
} from './chave-pix';

describe('normalizarTelefone', () => {
  it.each([
    ['(11) 98888-1111', '11988881111'],
    ['+55 11 98888-1111', '11988881111'],
    ['5511988881111', '11988881111'],
    ['(21) 3333-4444', '2133334444'],
  ])('%p -> %p', (entrada, esperado) => {
    expect(normalizarTelefone(entrada)).toBe(esperado);
  });

  it.each(['123', '988881111', '(01) 98888-1111', '119888811112222'])(
    'recusa %p',
    (entrada) => {
      expect(normalizarTelefone(entrada)).toBeNull();
    },
  );
});

describe('normalizarChavePix', () => {
  it('CPF vira so digitos', () => {
    expect(normalizarChavePix('CPF', '123.456.789-09')).toBe('12345678909');
  });

  it('CPF invalido e recusado', () => {
    expect(normalizarChavePix('CPF', '123.456.789-00')).toBeNull();
  });

  it('e-mail vira minusculo', () => {
    expect(normalizarChavePix('EMAIL', ' Bruno@Email.com ')).toBe(
      'bruno@email.com',
    );
  });

  it('e-mail invalido e recusado', () => {
    expect(normalizarChavePix('EMAIL', 'bruno@')).toBeNull();
  });
});

describe('exibirChavePix', () => {
  it.each([
    ['CPF', '12345678909', '123.456.789-09'],
    ['TELEFONE', '11977772222', '(11) 97777-2222'],
    ['TELEFONE', '2133334444', '(21) 3333-4444'],
    ['EMAIL', 'bruno@email.com', 'bruno@email.com'],
  ] as const)('%s %p -> %p', (tipo, entrada, esperado) => {
    expect(exibirChavePix(tipo, entrada)).toBe(esperado);
  });
});

describe('ocultarCpf', () => {
  it('mostra so os 6 digitos do meio', () => {
    expect(ocultarCpf('123.456.789-09')).toBe('***.456.789-**');
  });
});
