import { Controller, Get, Headers, Inject, Param, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { verifyKiorlyRequest } from '@kiorex/contracts';
import { createHash } from 'node:crypto';
import { OPS_ROLES, Public } from '../../common/auth';
import { cfg } from '../../common/config';
import { ApiError, forbidden } from '../../common/errors';
import { ipHashOf } from '../../common/privacy-hash';
import { TOKEN_VERIFIER, type TokenVerifier } from '../../auth/auth-public';
import { PrismaService } from '../../prisma/prisma.service';
import { GrowthLimiter, growthLimits } from '../growth-limiter';
import { EvidenceService } from './evidence.service';

const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * GET /growth/v1/evidence/:bookingId: two ways in, and only these two.
 *  1. Ops console session (bearer, role ops_admin or super_admin): any booking.
 *  2. Signed partner (Kiorly Clinic): the Kiorly request HMAC (X-Kiorly-Client-Key, -Timestamp, -Nonce, -Signature over method, path and body hash, secret = the
 *     Clinic webhook secret), a one-time nonce, and `X-Kiorly-Org-Ref` naming the organisation: only that organisation's bookings answer, anything else is 404.
 * KNOWN LIMIT: today the Clinic signs with ONE shared secret, so the org header is a claim by an authenticated Clinic, not a proof per organisation. Per-organisation
 * partner credentials are the follow-up (NEEDS_HUMAN, Docs/GROWTH.md).
 */
@ApiTags('growth')
@Controller('growth/v1')
export class EvidenceController {
  constructor(private readonly svc: EvidenceService, @Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier, private readonly prisma: PrismaService, private readonly limiter: GrowthLimiter) {}

  @Public() @Get('evidence/:bookingId')
  @ApiOperation({ summary: 'GRW-P1-B attribution evidence for one booking (ops session or signed partner); facts, never identifiers' }) @ApiOkResponse(OBJ)
  async evidence(@Param('bookingId') bookingId: string, @Req() req: { ip?: string; originalUrl: string; method: string; rawBody?: Buffer; headers: Record<string, string | string[] | undefined> }, @Headers('authorization') auth?: string) {
    await this.limiter.take('evidence', ipHashOf(req.ip), growthLimits().evidencePerMin);
    if (auth?.toLowerCase().startsWith('bearer ')) {
      let roles: string[] = [];
      try { const p = await this.verifier.verifyAccess(auth.slice(7).trim()); roles = Array.isArray(p.kx_roles) ? (p.kx_roles as string[]) : []; } catch { throw new ApiError(401, 'INVALID_TOKEN', 'Invalid or expired token'); }
      if (!roles.some((r) => OPS_ROLES.includes(r))) throw forbidden('FORBIDDEN_ROLE', 'Insufficient role', { required: OPS_ROLES });
      return this.svc.forBooking(bookingId);
    }
    if (!req.headers['x-kiorly-signature']) throw new ApiError(401, 'UNAUTHENTICATED', 'An ops session or a signed partner request is required');
    const c = cfg();
    const v = one(req.headers['x-kiorly-client-key']) === c.kiorlyClientKey ? verifyKiorlyRequest({ headers: req.headers, method: req.method, path: req.originalUrl.split('?')[0]!, body: req.rawBody ?? Buffer.alloc(0), secret: c.kiorlyWebhookSecret }) : ({ ok: false } as const);
    if (!v.ok) throw new ApiError(401, 'PARTNER_UNAUTHORIZED', 'Request could not be authenticated');
    const nonce = createHash('sha256').update(`evidence|${one(req.headers['x-kiorly-nonce'])}`).digest('hex');
    try { await this.prisma.partnerIntakeNonce.create({ data: { id: nonce } }); } catch { throw new ApiError(401, 'PARTNER_UNAUTHORIZED', 'Request could not be authenticated'); } // replay
    const org = one(req.headers['x-kiorly-org-ref'])?.trim();
    if (!org || org.length > 64) throw new ApiError(401, 'PARTNER_UNAUTHORIZED', 'X-Kiorly-Org-Ref is required');
    return this.svc.forBooking(bookingId, { orgId: org });
  }
}
