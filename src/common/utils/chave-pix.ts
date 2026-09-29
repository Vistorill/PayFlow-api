import { isCpfValido, maskCpf, somenteDigitos } from './cpf';

/**
 * Tipos de chave Pix aceitos neste dominio. Cada um aponta para um dado que ja
 * identifica a conta:
 *   CPF      -> contas.cpf_hash
 *   EMAIL    -> usuarios.email (o mesmo e-mail do login)
 *   TELEFONE -> contas.telefone
 */
export const TIPOS_CHAVE_PIX = ['CPF', 'EMAIL', 'TELEFONE'] as const;
export type TipoChavePix = (typeof TIPOS_CHAVE_PIX)[number];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * "(11) 98888-1111", "+55 11 988881111" -> "11988881111".
 * Retorna null se nao for DDD + 8 ou 9 digitos.
 */
export function normalizarTelefone(valor: string): string | null {
  let d = somenteDigitos(valor);
  if ((d.length === 12 || d.length === 13) && d.startsWith('55'))
    d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;
  if (d.startsWith('0')) return null;
  return d;
}

/**
 * Normaliza a chave para o formato em que ela esta guardada.
 * Retorna null se a chave nao for valida para o tipo informado.
 */
export function normalizarChavePix(
  tipo: TipoChavePix,
  chave: string,
): string | null {
  const texto = chave.trim();
  switch (tipo) {
    case 'CPF':
      return isCpfValido(texto) ? somenteDigitos(texto) : null;
    case 'EMAIL':
      return EMAIL.test(texto) ? texto.toLowerCase() : null;
    case 'TELEFONE':
      return normalizarTelefone(texto);
  }
}

/**
 * Forma de EXIBICAO de uma chave ja normalizada -- e' o que fica gravado na
 * transacao e aparece no comprovante.
 *   CPF      "12345678909"  -> "123.456.789-09"
 *   TELEFONE "11977772222"  -> "(11) 97777-2222"
 *   EMAIL    fica como esta (ja minusculo)
 */
export function exibirChavePix(
  tipo: TipoChavePix,
  normalizada: string,
): string {
  switch (tipo) {
    case 'CPF':
      return maskCpf(normalizada);
    case 'TELEFONE': {
      const d = normalizada;
      const meio = d.length === 11 ? 7 : 6;
      return `(${d.slice(0, 2)}) ${d.slice(2, meio)}-${d.slice(meio)}`;
    }
    case 'EMAIL':
      return normalizada;
  }
}

/**
 * CPF de TERCEIRO em comprovante: so os 6 digitos do meio, como no padrao dos
 * comprovantes Pix ("***.456.789-**"). O proprio CPF o usuario ve inteiro.
 */
export function ocultarCpf(cpfMasked: string): string {
  const d = somenteDigitos(cpfMasked);
  return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
}
