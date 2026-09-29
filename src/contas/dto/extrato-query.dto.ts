import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class ExtratoQueryDto {
  @ApiPropertyOptional({
    description: 'Quantidade de lancamentos por pagina. Maximo 100.',
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'take deve ser um numero inteiro' })
  @Min(1)
  @Max(100)
  take = 20;

  @ApiPropertyOptional({
    description: 'Quantos lancamentos pular. Paginacao por offset.',
    default: 0,
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'skip deve ser um numero inteiro' })
  @Min(0)
  skip = 0;
}
