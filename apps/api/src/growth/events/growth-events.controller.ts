import { Body, Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { ApiAcceptedResponse, ApiBody, type ApiBodyOptions, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiError } from '../../common/errors';
import { Public } from '../../common/auth';
import { ipHashOf } from '../../common/privacy-hash';
import { RequiresFlag } from '../../control-plane/control-plane-public';
import { GROWTH_FLAG } from '../growth-flags';
import { parseCookies, VISITOR_KEY_PATTERN } from '../touch/touch-sanitizer';
import { parseEventsBody } from './growth-phi-guard';
import { GrowthEventsService } from './growth-events.service';

type Req_ = { rawBody?: Buffer; ip?: string; headers: Record<string, string | string[] | undefined> };
const EVENTS_BODY: ApiBodyOptions = { schema: { type: 'object', required: ['events'], properties: { events: { type: 'array', maxItems: 20, items: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, occurredAt: { type: 'string' }, careType: { type: 'string' }, landingKind: { type: 'string' }, props: { type: 'object' } } } } } } };

@ApiTags('growth')
@Controller('growth/v1')
export class GrowthEventsController {
  constructor(private readonly events: GrowthEventsService) {}

  @Public() @RequiresFlag(GROWTH_FLAG.ATTRIBUTION) @Post('events') @HttpCode(202)
  @ApiOperation({ summary: 'GRW-P1-B record canonical funnel events (batch of up to 20; idempotent; client-reportable names only; no PHI)' })
  @ApiBody(EVENTS_BODY) @ApiAcceptedResponse({ schema: { type: 'object', properties: { accepted: { type: 'integer' }, duplicates: { type: 'integer' } } } })
  async record(@Req() req: Req_, @Body() body: unknown, @Headers('x-kx-consent') consent?: string) {
    if ((req.rawBody?.length ?? 0) > 16_384) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
    const events = parseEventsBody(body);
    const key = parseCookies(Array.isArray(req.headers.cookie) ? req.headers.cookie[0] : req.headers.cookie).kxv;
    return this.events.ingest(events, { ipHash: ipHashOf(req.ip), visitorKey: key && VISITOR_KEY_PATTERN.test(key) ? key : null, consentAnalytics: consent?.trim().toLowerCase() === 'analytics' });
  }
}
