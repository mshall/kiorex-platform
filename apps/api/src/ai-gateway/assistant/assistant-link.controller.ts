import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { Public } from '../../common/auth';
import { ApiError } from '../../common/errors';
import { ipHashOf } from '../../common/privacy-hash';
import { RequiresFlag } from '../../control-plane/control-plane-public';
import { ASSISTANT_FLAG } from './assistant.growth-bridge';
import { AssistantLinkService } from './assistant.link.service';
import { AssistantRateLimit } from './assistant.rate-limit';

export class AssistantLinkDto { @IsString() @MinLength(16) @MaxLength(200) token!: string }

/**
 * POST /growth/v1/assistant/link (contract kiorex-growth.v1 1.1.0 `growthAssistantLinkVerify`). Public, single use, 15 minute links created by `create_booking_link`. Returns WHERE to continue, never the
 * conversation, a name or a phone number. Rate limited by the rotating ip hash. 403 FEATURE_DISABLED while the locked flag is not effective.
 */
@ApiExcludeController()
@Controller('growth/v1/assistant')
export class AssistantLinkController {
  constructor(private readonly links: AssistantLinkService, private readonly rate: AssistantRateLimit) {}

  @Public() @RequiresFlag(ASSISTANT_FLAG.ASSISTANT) @HttpCode(200) @Post('link')
  async verify(@Req() req: { ip?: string }, @Body() b: AssistantLinkDto) {
    const r = await this.rate.limiter.hit(`assistant:link:${ipHashOf(req.ip)}`, 30, 60_000);
    if (!r.ok) throw new ApiError(429, 'GROWTH_RATE_LIMITED', 'Too many requests, try again later', { retryAfterSec: r.retryAfterSec });
    const v = await this.links.verify(b.token);
    if (!v.ok) {
      if (v.code === 'EXPIRED') throw new ApiError(410, 'ASSISTANT_LINK_EXPIRED', 'This link has expired');
      if (v.code === 'USED') throw new ApiError(410, 'ASSISTANT_LINK_USED', 'This link was already used');
      throw new ApiError(400, 'ASSISTANT_LINK_INVALID', 'This link is not valid');
    }
    const p = v.payload;
    const q = new URLSearchParams({ src: 'whatsapp' });
    if (p.providerId) q.set('provider', p.providerId);
    if (p.startsAt) q.set('slot', p.startsAt);
    const path = v.intent === 'PAY' && p.bookingId ? `/bookings/${encodeURIComponent(p.bookingId)}/pay` : v.intent === 'VERIFY' ? `/signin?next=${encodeURIComponent(`/book?${q.toString()}`)}` : `/book?${q.toString()}`;
    return { continuePath: path };
  }
}
