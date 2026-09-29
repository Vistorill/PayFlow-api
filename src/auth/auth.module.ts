import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SecurityModule } from '../security/security.module';

@Module({
  // JwtService vem do SecurityModule (@Global).
  imports: [SecurityModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
