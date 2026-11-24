import { Body, Controller, Headers, HttpCode, Post, Req, Res, Get } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth';
import { TouchService } from '../touch/touch.service';
import { parseCookies } from '../touch/touch-sanitizer';
import { VisitorConsentService } from './visitor-consent.service';

type Res_ = { setHeader(n: string, v: string): void };
const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;

/** Anonymous visitor consent (banner / cookie preferences). Never gated by a growth flag: recording a choice is always allowed. */
@ApiTags('growth')
@Controller('growth/v1')
export class VisitorConsentController {
  constructor(private readonly svc: VisitorConsentService, private readonly touches: TouchService) {}

  @Public() @Get('consent/versions') @ApiOperation({ summary: 'GRW-P1-I current consent text version ids (the banner stores the version it showed)' }) @ApiOkResponse(OBJ)
  versions(@Headers('x-kiorex-market') market?: string) { return this.svc.textVersions(market && /^[A-Z]{2}$/.test(market) ? market : undefined); }

  @Public() @Post('consent') @HttpCode(201)
  @ApiOperation({ summary: 'GRW-P1-I record an anonymous visitor consent decision (audit row keyed by a random consent id; sets nothing else server-side)' })
  @ApiBody({ schema: { type: 'object', required: ['analytics'], properties: { analytics: { type: 'boolean' }, marketing: { type: 'boolean' }, textVersion: { type: 'string' }, source: { type: 'string', enum: ['web', 'app', 'widget'] }, evidence: { type: 'string' } } } }) @ApiOkResponse(OBJ)
  async record(@Req() req: { ip?: string; headers: Record<string, string | string[] | undefined> }, @Res({ passthrough: true }) res: Res_, @Body() body: { analytics: boolean; marketing?: boolean; textVersion?: string; source?: string; evidence?: string }, @Headers('x-kiorex-market') market?: string) {
    const r = await this.svc.record({ analytics: body?.analytics, marketing: body?.marketing, textVersion: body?.textVersion, source: body?.source, evidence: body?.evidence }, { ip: req.ip, market: market && /^[A-Z]{2}$/.test(market) ? market : undefined });
    // a reject (or a later withdrawal) drops the visitor key immediately: new touches never use it and nothing visitor-linked is processed
    if (!r.analytics && parseCookies(Array.isArray(req.headers.cookie) ? req.headers.cookie[0] : req.headers.cookie).kxv) res.setHeader('Set-Cookie', this.touches.clearCookie());
    return r;
  }
}
