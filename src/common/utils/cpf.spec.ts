import { hashCpf, isCpfValido, maskCpf, somenteDigitos } from './cpf';

describe('isCpfValido', () => {
  it('aceita CPFs validos com e sem mascara', () => {
    expect(isCpfValido('111.444.777-35')).toBe(true);
    expect(isCpfValido('11144477735')).toBe(true);
    expect(isCpfValido('123.456.789-09')).toBe(true);
  });

  it('rejeita digito verificador incorreto', () => {
    expect(isCpfValido('123.456.789-00')).toBe(false);
    expect(isCpfValido('111.444.777-30')).toBe(false);
  });

  it('rejeita sequencia repetida que passaria na conta matematica', () => {
    expect(isCpfValido('000.000.000-00')).toBe(false);
    expect(isCpfValido('11111111111')).toBe(false);
  });

  it('rejeita tamanho errado e entrada vazia', () => {
    expect(isCpfValido('1234567890')).toBe(false);
    expect(isCpfValido('')).toBe(false);
  });
});

describe('maskCpf', () => {
  it('formata em 000.000.000-00', () => {
    expect(maskCpf('11144477735')).toBe('111.444.777-35');
  });
});

describe('somenteDigitos', () => {
  it('descarta qualquer caractere nao numerico', () => {
    expect(somenteDigitos('111.444.777-35')).toBe('11144477735');
  });
});

describe('hashCpf', () => {
  it('e deterministico: mesmo CPF gera o mesmo hash, com ou sem mascara', () => {
    expect(hashCpf('111.444.777-35')).toBe(hashCpf('11144477735'));
    expect(hashCpf('111.444.777-35')).toHaveLength(64);
  });

  it('CPFs diferentes geram hashes diferentes', () => {
    expect(hashCpf('111.444.777-35')).not.toBe(hashCpf('123.456.789-09'));
  });
});
