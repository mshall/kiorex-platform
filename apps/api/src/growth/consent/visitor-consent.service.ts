import { Injectable } from '@nestjs/common';
import { randomToken } from '../growth-secrets';
import { PrismaService } from '../../prisma/prisma.service';
import { ipHashOf } from '../../common/privacy-hash';
import { GROWTH_DEFAULT_MARKET, GROWTH_FLAG } from '../growth-flags';
import { FlagsService } from '../../control-plane/control-plane-public';
import { GrowthConfigService } from '../config/growth-config.service';
import { GrowthEventsService } from '../events/growth-events.service';
import { GrowthLimiter, growthLimits } from '../growth-limiter';
import { growthError } from '../growth-errors';

export const VISITOR_CONSENT_SOURCES = ['web', 'app', 'widget'] as const;
export interface VisitorConsentInput { analytics: boolean; marketing?: boolean; textVersion?: string; source?: string; evidence?: string }

/**
 * POST /growth/v1/consent: the banner's decision for an ANONYMOUS visitor. Sets nothing server-side except an append-only audit row keyed by a random
 * consent id (no sub, no cookie value, no IP: only the rotating keyed ip hash). The browser keeps the id, the choice and the text version locally and
 * sends `X-KX-Consent: analytics` on touches only after an accept. A reject is recorded the same way: Accept and Reject carry equal weight.
 */
@Injectable()
export class VisitorConsentService {
  constructor(private readonly prisma: PrismaService, private readonly config: GrowthConfigService, private readonly limiter: GrowthLimiter, private readonly events: GrowthEventsService, private readonly flags: FlagsService) {}

  async textVersions(market = GROWTH_DEFAULT_MARKET) {
    const d = await this.config.resolve<{ textVersionIds: { analytics: string; marketing: string } }>('CONSENT_DEFAULTS', { market });
    // G-20: `available` is true only while `growth.analytics_visitor` is effective in the market (launch-locked: false until a human records the gate). The public pages show the banner island only then.
    const available = await this.flags.isEnabled(GROWTH_FLAG.ANALYTICS_VISITOR, { market }).catch(() => false);
    return { ...d.payload.textVersionIds, regime: (d.payload as unknown as { regimeId: string }).regimeId, configVersion: d.versionId, available };
  }

  async record(i: VisitorConsentInput, ctx: { ip?: string; market?: string }) {
    const market = ctx.market ?? GROWTH_DEFAULT_MARKET; const now = new Date(); const ipHash = ipHashOf(ctx.ip, now);
    await this.limiter.take('consent', ipHash, growthLimits().consentPerMin);
    if (typeof i.analytics !== 'boolean' || (i.marketing !== undefined && typeof i.marketing !== 'boolean')) throw growthError('GROWTH_INVALID_REQUEST', 'analytics (and marketing) must be booleans');
    const source = i.source ?? 'web';
    if (!(VISITOR_CONSENT_SOURCES as readonly string[]).includes(source)) throw growthError('GROWTH_INVALID_REQUEST', 'source must be web, app or widget');
    const v = await this.textVersions(market);
    const textVersion = i.textVersion && i.textVersion.length <= 64 ? i.textVersion : v.analytics;
    const id = `kxc_${randomToken(12)}`;
    await this.prisma.growthVisitorConsent.create({ data: { id, market, analytics: i.analytics, marketing: i.marketing === true, textVersion, source, evidence: i.evidence?.slice(0, 64), ipHash } });
    if (i.analytics) await this.events.recordFact({ name: 'ConsentGranted', naturalKey: id, market, props: { surface: source } }).catch(() => undefined); // anonymous funnel fact: consent rate
    return { consentId: id, analytics: i.analytics, marketing: i.marketing === true, textVersion, at: now.toISOString() };
  }
}
