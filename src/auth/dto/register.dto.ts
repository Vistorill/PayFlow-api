import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length, Matches, MaxLength } from 'class-validator';
import { IsCpf } from '../../common/validators/is-cpf.decorator';

export class RegisterDto {
  @ApiProperty({ example: 'Ana Souza' })
  @IsString()
  @Length(3, 120)
  nome: string;

  @ApiProperty({ example: 'ana@email.com' })
  @IsEmail()
  @MaxLength(180)
  email: string;

  @ApiProperty({ example: '123.456.789-09', description: 'Com ou sem mascara' })
  @IsCpf()
  @Matches(/^[\d.\-\s]{11,14}$/, {
    message: 'cpf deve conter apenas digitos, ponto e hifen',
  })
  cpf: string;

  @ApiProperty({ example: 'senha1234', minLength: 8, maxLength: 72 })
  @IsString()
  @Length(8, 72)
  senha: string;
}
