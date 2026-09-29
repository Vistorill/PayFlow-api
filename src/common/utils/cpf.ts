import { createHash } from 'node:crypto';

const SOMENTE_DIGITOS = /\D/g;

export function somenteDigitos(valor: string): string {
  return valor.replace(SOMENTE_DIGITOS, '');
}

/**
 * Calcula um digito verificador de CPF.
 * Os dois primeiros digitos usam pesos 10..2 e 11..2; resto < 2 resulta em 0.
 */
function calcularDigito(digitos: string, pesos: number[]): number {
  const soma = digitos
    .split('')
    .reduce(
      (total, digito, indice) => total + Number(digito) * pesos[indice],
      0,
    );
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/**
 * Valida a estrutura e os dois digitos verificadores do CPF.
 * Rejeita sequencias repetidas (000.000.000-00) que passam na conta matematica
 * mas sao invalidas na regra do Registro Geral.
 */
export function isCpfValido(cpf: string): boolean {
  const digitos = somenteDigitos(cpf);

  if (digitos.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digitos)) return false;

  const digito1 = calcularDigito(
    digitos.slice(0, 9),
    [10, 9, 8, 7, 6, 5, 4, 3, 2],
  );
  if (digito1 !== Number(digitos[9])) return false;

  const digito2 = calcularDigito(
    digitos.slice(0, 10),
    [11, 10, 9, 8, 7, 6, 5, 4, 3, 2],
  );
  if (digito2 !== Number(digitos[10])) return false;

  return true;
}

/** 12345678909 -> "123.456.789-09". Guardamos o CPF mascarado para exibicao. */
export function maskCpf(cpf: string): string {
  const d = somenteDigitos(cpf);
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9, 11)}`;
}

/**
 * SHA-256 do CPF normalizado.
 *
 * Diferente da senha, o hash aqui precisa ser DETERMINISTICO: usamos o hash
 * para localizar "ja existe uma conta com esse CPF?". bcrypt serve para
 * verificar senha, nao para buscar registro.
 */
export function hashCpf(cpf: string): string {
  return createHash('sha256').update(somenteDigitos(cpf)).digest('hex');
}
