import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthUser, IS_PUBLIC, ROLES_KEY } from '../common/auth';
import { ApiError, forbidden } from '../common/errors';
import { AuthSessionService } from './auth-session.service';
import { TOKEN_VERIFIER, TokenVerifier } from './token-verifier';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier,
    private readonly sessions: AuthSessionService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const req = ctx.switchToHttp().getRequest();
    const h = String(req.headers.authorization ?? '');
    if (!h.toLowerCase().startsWith('bearer ')) throw new ApiError(401, 'UNAUTHENTICATED', 'Bearer token required');
    let payload;
    try {
      payload = await this.verifier.verifyAccess(h.slice(7).trim());
    } catch {
      throw new ApiError(401, 'INVALID_TOKEN', 'Invalid or expired token');
    }
    const roles = Array.isArray(payload.kx_roles) ? (payload.kx_roles as string[]) : [];
    const user: AuthUser = {
      sub: String(payload.sub),
      roles,
      phone: payload.phone_number as string | undefined,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      emailVerified: payload.email_verified === true, // GRW-P4-C: only an explicit true claim; Passport does not issue it yet (corporate domain eligibility stays unavailable until it does)
      name: payload.name as string | undefined,
      locale: payload.locale as string | undefined,
      sid: (payload.sid as string | undefined) ?? undefined,
      clientId: (payload.azp as string | undefined) ?? (payload.client_id as string | undefined),
    };
    if (user.sid) {
      if (await this.sessions.isRevoked(user.sid)) throw new ApiError(401, 'SESSION_REVOKED', 'Session has been signed out');
      await this.sessions.touch(user.sub, user.sid, { clientId: user.clientId, device: String(req.headers['user-agent'] ?? '').slice(0, 200), ip: req.ip });
    }
    req.user = user;
    const need = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, targets);
    if (need?.length && !need.some((r) => roles.includes(r))) throw forbidden('FORBIDDEN_ROLE', 'Insufficient role', { required: need });
    return true;
  }
}
