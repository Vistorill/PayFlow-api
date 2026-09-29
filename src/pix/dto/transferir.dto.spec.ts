import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { TransferirDto } from './transferir.dto';

function validar(valor: unknown) {
  const dto = plainToInstance(TransferirDto, {
    chaveDestino: '123.456.789-09',
    valor,
    idempotencyKey: 'pix-teste-123',
  });
  const erros = validateSync(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return { dto, erros };
}

describe('TransferirDto.valor', () => {
  it.each([50, 1.5, 0.01, '50', '50.00', '50,00', ' 7.1 ', 999_999_999.99])(
    'aceita %p',
    (valor) => {
      const { dto, erros } = validar(valor);
      expect(erros).toHaveLength(0);
      expect(typeof dto.valor).toBe('string');
    },
  );

  it('normaliza virgula para ponto', () => {
    expect(validar('50,25').dto.valor).toBe('50.25');
  });

  it.each([
    0,
    '0',
    '0.00',
    -1,
    '-5',
    1.234,
    '1.234',
    1_000_000_000,
    'abc',
    '',
    null,
  ])('recusa %p', (valor) => {
    expect(validar(valor).erros.length).toBeGreaterThan(0);
  });
});
