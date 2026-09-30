import {
  aceitaDevolucao,
  eTerminalPix,
  podeTransitarDevolucao,
  podeTransitarPix,
} from './estados';

describe('maquina de estados do Pix (SPI)', () => {
  it('caminho feliz de envio', () => {
    expect(podeTransitarPix('CRIADO', 'ENVIADO')).toBe(true);
    expect(podeTransitarPix('ENVIADO', 'LIQUIDADO')).toBe(true);
    expect(podeTransitarPix('LIQUIDADO', 'DEVOLVIDO_PARCIAL')).toBe(true);
    expect(podeTransitarPix('DEVOLVIDO_PARCIAL', 'DEVOLVIDO')).toBe(true);
  });

  it('pacs.002 antes do "enviado": CRIADO vai direto para o resultado', () => {
    expect(podeTransitarPix('CRIADO', 'LIQUIDADO')).toBe(true);
    expect(podeTransitarPix('CRIADO', 'REJEITADO')).toBe(true);
  });

  it('nunca volta: "enviado" atrasado depois do resultado e ignorado', () => {
    expect(podeTransitarPix('LIQUIDADO', 'ENVIADO')).toBe(false);
    expect(podeTransitarPix('REJEITADO', 'LIQUIDADO')).toBe(false);
    expect(podeTransitarPix('LIQUIDADO', 'REJEITADO')).toBe(false);
  });

  it('timeout vai para reconciliacao, que decide', () => {
    expect(podeTransitarPix('ENVIADO', 'RECONCILIANDO')).toBe(true);
    expect(podeTransitarPix('RECONCILIANDO', 'LIQUIDADO')).toBe(true);
    expect(podeTransitarPix('RECONCILIANDO', 'REJEITADO')).toBe(true);
  });

  it('terminais', () => {
    expect(eTerminalPix('REJEITADO')).toBe(true);
    expect(eTerminalPix('DEVOLVIDO')).toBe(true);
    expect(eTerminalPix('LIQUIDADO')).toBe(false);
  });

  it('so Pix liquidado ou recebido aceita devolucao', () => {
    expect(aceitaDevolucao('LIQUIDADO')).toBe(true);
    expect(aceitaDevolucao('RECEBIDO')).toBe(true);
    expect(aceitaDevolucao('DEVOLVIDO_PARCIAL')).toBe(true);
    expect(aceitaDevolucao('ENVIADO')).toBe(false);
    expect(aceitaDevolucao('REJEITADO')).toBe(false);
    expect(aceitaDevolucao('DEVOLVIDO')).toBe(false);
    expect(aceitaDevolucao(null)).toBe(false);
  });
});

describe('maquina de estados da devolucao', () => {
  it('avanca e para nos terminais', () => {
    expect(podeTransitarDevolucao('SOLICITADA', 'ENVIADA')).toBe(true);
    expect(podeTransitarDevolucao('ENVIADA', 'LIQUIDADA')).toBe(true);
    expect(podeTransitarDevolucao('SOLICITADA', 'LIQUIDADA')).toBe(true);
    expect(podeTransitarDevolucao('LIQUIDADA', 'REJEITADA')).toBe(false);
    expect(podeTransitarDevolucao('REJEITADA', 'ENVIADA')).toBe(false);
  });
});
