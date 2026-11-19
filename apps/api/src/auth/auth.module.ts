import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthSessionService } from './auth-session.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JoseTokenVerifier, TOKEN_VERIFIER } from './token-verifier';

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthSessionService, { provide: TOKEN_VERIFIER, useFactory: () => new JoseTokenVerifier() }, { provide: APP_GUARD, useClass: JwtAuthGuard }],
  exports: [AuthSessionService, TOKEN_VERIFIER],
})
export class AuthModule {}
