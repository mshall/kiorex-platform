import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { AuthUser, CurrentUser, Public } from '../common/auth';
import { ApiError, badRequest } from '../common/errors';
import { OutboxService } from '../outbox/outbox-public';
import { AuthSessionService } from './auth-session.service';
import { PrismaService } from '../prisma/prisma.service';
import { TOKEN_VERIFIER, TokenVerifier } from './token-verifier';
import { LogoutResultDto, MeDto } from './auth.dto';

class LogoutBody {
  @IsOptional() @IsString() logout_token?: string;
}

const BCL_EVENT = 'http://schemas.openid.net/event/backchannel-logout';
/** Kiorex event discriminators Passport adds to the `events` claim next to the standard one (the standard event alone means a session revoke). */
const KX_SUBJECT_DELETED = 'https://schemas.kiorex.com/event/subject.deleted';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier,
    private readonly sessions: AuthSessionService,
    private readonly outbox: OutboxService,
    private readonly prisma: PrismaService,
  ) {}

  @ApiOkResponse({ type: MeDto })

  @Get('me')
  @ApiOkResponse({ description: 'Claims of the authenticated Kiorex Passport subject' })
  me(@CurrentUser() u: AuthUser) {
    return { sub: u.sub, roles: u.roles, phone: u.phone, name: u.name, locale: u.locale };
  }

  /** OIDC back-channel logout (KA05/KA07). Accepts form-encoded or JSON `logout_token`. */
  @ApiOkResponse({ type: LogoutResultDto })
  @Public() @Post('backchannel-logout') @HttpCode(200)
  async backchannelLogout(@Body() body: LogoutBody) {
    if (!body?.logout_token) throw badRequest('LOGOUT_TOKEN_REQUIRED', 'logout_token is required');
    let p;
    try {
      p = await this.verifier.verifyLogout(body.logout_token);
    } catch {
      throw new ApiError(400, 'INVALID_LOGOUT_TOKEN', 'logout_token failed verification');
    }
    const events = (p.events ?? {}) as Record<string, unknown>;
    // subject.deleted must win over the standard back-channel event that every Passport token also carries (it used to be read as a plain session revoke, so erasure never ran)
    const kind = (p.event as string | undefined) ?? (events[KX_SUBJECT_DELETED] || events['subject.deleted'] ? 'subject.deleted' : undefined) ?? (events[BCL_EVENT] ? 'session.revoked' : undefined) ?? (events['session.revoked'] ? 'session.revoked' : undefined);
    if (!kind) throw badRequest('NOT_A_LOGOUT_TOKEN', 'No logout event in token');
    const sub = p.sub as string | undefined;
    const sid = p.sid as string | undefined;
    if (kind === 'subject.deleted') {
      if (!sub) throw badRequest('SUB_REQUIRED', 'sub required');
      await this.sessions.revokeAllForSub(sub);
      await this.outbox.enqueue(this.prisma, { type: 'subject.deleted', aggregateType: 'Subject', aggregateId: sub, payload: { sub }, dedupeKey: `subject.deleted:${sub}` });
    } else if (sid) await this.sessions.revokeBySid(sid);
    else if (sub) await this.sessions.revokeAllForSub(sub);
    else throw badRequest('SID_OR_SUB_REQUIRED', 'sid or sub required');
    return { ok: true };
  }
}
