import { Body, Controller, Get, Headers, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, Public } from '../../common/auth';
import { ApiError } from '../../common/errors';
import { ipHashOf } from '../../common/privacy-hash';
import { GROWTH_DEFAULT_MARKET } from '../growth-flags';
import { GrowthLimiter, growthLimits } from '../growth-limiter';
import { parseCookies, VISITOR_KEY_PATTERN } from '../touch/touch-sanitizer';
import type { EligibilityContext } from './eligibility';
import { ExposureService, subUnit, visitorUnit, type Unit } from './exposure.service';
import { EXPERIMENT_POLICY } from './experiment.types';
import { clearCookie, setCookieFor } from './ssr-variant';

type Req_ = { ip?: string; headers: Record<string, string | string[] | undefined> };
type Res_ = { setHeader(n: string, v: string | string[]): void };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;
const KEY = /^[a-z0-9][a-z0-9_-]{1,62}$/;

function ctxOf(req: Req_, q: { locale?: string; platform?: string; stage?: string }, market?: string): EligibilityContext {
  return {
    market: market && /^[A-Z]{2}$/.test(market) ? market : GROWTH_DEFAULT_MARKET,
    locale: q.locale === 'ar' || q.locale === 'en' ? q.locale : (one(req.headers['accept-language'])?.slice(0, 2) === 'en' ? 'en' as const : one(req.headers['accept-language'])?.slice(0, 2) === 'ar' ? 'ar' as const : undefined),
    platform: q.platform === 'web' || q.platform === 'ios' || q.platform === 'android' ? q.platform : undefined,
    stage: q.stage === 'new' || q.stage === 'returning' ? q.stage : undefined,
  };
}

/**
 * Assignment fetch and exposure (GRW-P3-A). Two entry points, one rule: the unit is the consented visitor key (public, needs `X-KX-Consent: analytics` AND the kxv cookie) or the signed-in
 * `sub` (in-product surfaces). No consent and no session = no assignment: control, nothing recorded, no cookie. The variant is always recomputed on the server; a client cannot claim one.
 * Flag `growth.experiments` OFF answers 200 with an empty list (everyone sees control), never an error that could break a page. Answers are per-unit and cacheable for 10 minutes by the browser only.
 */
@ApiTags('growth-experiments')
@Controller('growth/v1/experiments')
export class ExperimentsPublicController {
  constructor(private readonly exposure: ExposureService, private readonly limiter: GrowthLimiter) {}

  private visitor(req: Req_, consent?: string): Unit {
    if (consent?.trim().toLowerCase() !== 'analytics') return null;
    const k = parseCookies(one(req.headers.cookie)).kxv;
    return k && VISITOR_KEY_PATTERN.test(k) ? visitorUnit(k) : null;
  }
  private headers(res: Res_) { res.setHeader('Cache-Control', `private, max-age=${EXPERIMENT_POLICY.assignmentTtlSeconds}`); res.setHeader('Vary', 'Cookie, X-KX-Consent, Authorization'); }

  @Public() @Get('assignments') @ApiOperation({ summary: 'GRW-P3-A assignments of the consented visitor (empty list without consent)' }) @ApiOkResponse(OBJ)
  async visitorAssignments(@Req() req: Req_, @Res({ passthrough: true }) res: Res_, @Query() q: Record<string, string>, @Headers('x-kx-consent') consent?: string, @Headers('x-kiorex-market') market?: string) {
    await this.limiter.take('experiments-assign', ipHashOf(req.ip), growthLimits().touchPerMin);
    const surface = q.surface && KEY.test(q.surface.replace(/\./g, '-')) ? q.surface : undefined;
    const unit = this.visitor(req, consent); const ctx = ctxOf(req, q, market);
    const assignments = await this.exposure.assignments(unit, ctx, surface);
    this.headers(res);
    if (unit) { const c = setCookieFor(assignments.map((a) => ({ key: a.experiment, variant: a.variant })), true); if (c) res.setHeader('Set-Cookie', c); }
    else if (/(?:^|;\s*)kxe=/.test(one(req.headers.cookie) ?? '')) res.setHeader('Set-Cookie', clearCookie()); // consent withdrawn: the variant cookie goes with the visitor key
    return { assignments, ttlSeconds: EXPERIMENT_POLICY.assignmentTtlSeconds, unit: unit ? 'VISITOR' : 'NONE' };
  }

  @Public() @Post('exposures') @HttpCode(200) @ApiOperation({ summary: 'GRW-P3-A record that the consented visitor saw its variant (idempotent)' }) @ApiOkResponse(OBJ)
  async visitorExposure(@Req() req: Req_, @Body() b: { experiment?: string }, @Headers('x-kx-consent') consent?: string, @Headers('x-kiorex-market') market?: string) {
    await this.limiter.take('experiments-expose', ipHashOf(req.ip), growthLimits().touchPerMin);
    if (typeof b?.experiment !== 'string' || !KEY.test(b.experiment)) throw new ApiError(400, 'GROWTH_INVALID_REQUEST', 'experiment is required');
    return this.exposure.expose(this.visitor(req, consent), ctxOf(req, {}, market), b.experiment);
  }

  @Get('me/assignments') @ApiOperation({ summary: 'GRW-P3-A assignments of the signed-in person for in-product surfaces' }) @ApiOkResponse(OBJ)
  async myAssignments(@CurrentUser() u: AuthUser, @Req() req: Req_, @Res({ passthrough: true }) res: Res_, @Query() q: Record<string, string>, @Headers('x-kiorex-market') market?: string) {
    const assignments = await this.exposure.assignments(subUnit(u.sub), ctxOf(req, q, market), q.surface);
    this.headers(res);
    return { assignments, ttlSeconds: EXPERIMENT_POLICY.assignmentTtlSeconds, unit: 'SUB' };
  }
  @Post('me/exposures') @HttpCode(200) @ApiOperation({ summary: 'GRW-P3-A record that the signed-in person saw its variant (idempotent)' }) @ApiOkResponse(OBJ)
  myExposure(@CurrentUser() u: AuthUser, @Req() req: Req_, @Body() b: { experiment?: string }, @Headers('x-kiorex-market') market?: string) {
    if (typeof b?.experiment !== 'string' || !KEY.test(b.experiment)) throw new ApiError(400, 'GROWTH_INVALID_REQUEST', 'experiment is required');
    return this.exposure.expose(subUnit(u.sub), ctxOf(req, {}, market), b.experiment);
  }
}
