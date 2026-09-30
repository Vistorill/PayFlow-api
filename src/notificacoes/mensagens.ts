import { EVENTOS_PIX, type DadosEventoPix } from '../pix/eventos-pix';

const brl = (valor: string) =>
  Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Texto do push/notificacao por tipo de evento. null = evento que nao vira
 * notificacao para o usuario (ex.: "enviado ao SPI", estado tecnico).
 */
export function textoNotificacao(
  tipo: string,
  d: DadosEventoPix,
): { titulo: string; corpo: string } | null {
  const valor = brl(d.valor);
  const quem = d.contraparte.nome;
  switch (tipo) {
    case EVENTOS_PIX.LIQUIDADO:
      return {
        titulo: 'Pix enviado',
        corpo: `${valor} para ${quem} foi concluido.`,
      };
    case EVENTOS_PIX.REJEITADO:
      return {
        titulo: 'Pix nao concluido',
        corpo: `O Pix de ${valor} para ${quem} foi recusado pelo banco de destino. O valor voltou para sua conta.`,
      };
    case EVENTOS_PIX.TIMEOUT:
      return {
        titulo: 'Pix em analise',
        corpo: `Seu Pix de ${valor} para ${quem} esta demorando. Estamos confirmando com o banco de destino.`,
      };
    case EVENTOS_PIX.RECEBIDO:
      return {
        titulo: 'Pix recebido',
        corpo: `Voce recebeu ${valor} de ${quem}.`,
      };
    case EVENTOS_PIX.DEVOLUCAO_LIQUIDADA:
      return {
        titulo: 'Devolucao concluida',
        corpo: `Sua devolucao de ${valor} para ${quem} foi concluida.`,
      };
    case EVENTOS_PIX.DEVOLUCAO_REJEITADA:
      return {
        titulo: 'Devolucao nao concluida',
        corpo: `A devolucao de ${valor} para ${quem} foi recusada. O valor voltou para sua conta.`,
      };
    case EVENTOS_PIX.DEVOLUCAO_RECEBIDA:
      return {
        titulo: 'Pix devolvido',
        corpo: `${quem} devolveu ${valor} do seu Pix.`,
      };
    default:
      return null;
  }
}
