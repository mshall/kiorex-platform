import { Body, Controller, Headers, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiAcceptedResponse, ApiBody, type ApiBodyOptions, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiError } from '../../common/errors';
import { Public } from '../../common/auth';
import { ipHashOf } from '../../common/privacy-hash';
import { RequiresFlag } from '../../control-plane/control-plane-public';
import { GROWTH_FLAG } from '../growth-flags';
import { parseCookies, parseTouchBody, TOUCH_MAX_BODY_BYTES } from './touch-sanitizer';
import { TouchService } from './touch.service';

type Req_ = { rawBody?: Buffer; ip?: string; headers: Record<string, string | string[] | undefined> };
type Res_ = { setHeader(n: string, v: string): void };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const TOUCH_BODY: ApiBodyOptions = { schema: { type: 'object', required: ['landingKind'], properties: { landingKind: { type: 'string' }, utm: { type: 'object', additionalProperties: { type: 'string' } }, clickId: { type: 'object' }, ref: { type: 'string' }, lt: { type: 'string' }, dwellMs: { type: 'integer' } } } };

/** Public, first-party landing touches. `Always 202 quickly`: nothing about visitors is revealed (no echo of identifiers). Contract: kiorex-growth.v1.openapi.json. */
@ApiTags('growth')
@Controller('growth/v1')
export class TouchController {
  constructor(private readonly touches: TouchService) {}

  @Public() @RequiresFlag(GROWTH_FLAG.ATTRIBUTION) @Post('touch') @HttpCode(202)
  @ApiOperation({ summary: 'GRW-P1-B record a landing touch (consent-gated visitor identity; no IP, no full UA, no full referrer, no search text)' })
  @ApiHeader({ name: 'X-KX-Consent', required: false, description: 'analytics, only after the person accepted analytics/attribution consent' })
  @ApiBody(TOUCH_BODY) @ApiAcceptedResponse({ schema: { type: 'object', properties: { accepted: { type: 'boolean' }, visitorKeySet: { type: 'boolean' } } } })
  async touch(@Req() req: Req_, @Res({ passthrough: true }) res: Res_, @Body() body: unknown, @Headers('x-kx-consent') consent?: string, @Headers('x-kiorex-market') market?: string) {
    if ((req.rawBody?.length ?? 0) > TOUCH_MAX_BODY_BYTES) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
    const parsed = parseTouchBody(body);
    const cookies = parseCookies(one(req.headers.cookie));
    const r = await this.touches.record(parsed, {
      consentAnalytics: consent?.trim().toLowerCase() === 'analytics', cookieVisitorKey: cookies.kxv, ipHash: ipHashOf(req.ip), userAgent: one(req.headers['user-agent']),
      referer: one(req.headers.referer), origin: one(req.headers.origin), locale: one(req.headers['accept-language'])?.slice(0, 2), market: market && /^[A-Z]{2}$/.test(market) ? market : undefined,
    });
    if (r.visitorKey) res.setHeader('Set-Cookie', await this.touches.cookieFor(r.visitorKey, market && /^[A-Z]{2}$/.test(market) ? market : undefined));
    else if (!(consent?.trim().toLowerCase() === 'analytics') && cookies.kxv) res.setHeader('Set-Cookie', this.touches.clearCookie()); // consent withdrawn: the browser drops the key at once
    return { accepted: true, visitorKeySet: r.visitorKeySet };
  }
}
