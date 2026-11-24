import { Controller, Get, Headers, Query, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth';
import { ipHashOf } from '../../common/privacy-hash';
import { RequiresFlag } from '../../control-plane/control-plane-public';
import { PrismaService } from '../../prisma/prisma.service';
import { GROWTH_DEFAULT_MARKET, GROWTH_FLAG } from '../growth-flags';
import { growthError } from '../growth-errors';
import { GrowthLimiter, growthLimits } from '../growth-limiter';
import { trackedLinks, type UtmConfig } from './campaign-utm';

const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;
const UTM = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const site = () => process.env.SITE_CANONICAL_HOST?.replace(/\/+$/, '') || 'https://kiorex.com';

/**
 * GET /growth/v1/campaign/resolve (contract kiorex-growth.v1.openapi.json 1.1.0). Public. Returns where to send a visitor and the `utm_campaign` value to pass back on the touch.
 * ONLY an ACTIVE campaign resolves; the answer carries no budget, no spend, no channel list and no eligibility rule. Rate limited by the rotating ip hash.
 */
@ApiTags('growth')
@Controller('growth/v1/campaign')
export class CampaignsPublicController {
  constructor(private readonly prisma: PrismaService, private readonly limiter: GrowthLimiter) {}

  @Public() @RequiresFlag(GROWTH_FLAG.CAMPAIGNS) @Get('resolve') @ApiOperation({ summary: 'GRW-P2-A resolve an ACTIVE campaign UTM to its landing target and campaign token' }) @ApiOkResponse(OBJ)
  async resolve(@Req() req: { ip?: string }, @Query('utm_campaign') utm?: string, @Query('locale') locale?: string, @Headers('x-kiorex-market') market?: string) {
    await this.limiter.take('campaign-resolve', ipHashOf(req.ip), growthLimits().touchPerMin);
    if (typeof utm !== 'string' || !UTM.test(utm)) throw growthError('GROWTH_INVALID_REQUEST', 'utm_campaign must be a lower-case campaign value such as eg-ramadan-checkup');
    const mk = market && /^[A-Z]{2}$/.test(market) ? market : GROWTH_DEFAULT_MARKET;
    const c = await this.prisma.growthCampaign.findFirst({ where: { market: mk, utmCampaign: utm, status: 'ACTIVE' } });
    if (!c) throw growthError('CAMPAIGN_NOT_FOUND', 'No active campaign matches');
    const loc = locale === 'en' || locale === 'ar' ? locale : undefined;
    const links = trackedLinks({ market: c.market, key: c.key, channels: c.channels, config: c.utmConfig as UtmConfig, host: site(), locale: loc });
    return { landing: { path: links.landingPath, locale: (c.utmConfig as UtmConfig).locale ?? loc ?? 'ar', landingPageId: c.landingPageId ?? null }, campaignToken: c.utmCampaign };
  }
}
