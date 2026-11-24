import { Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { cfg } from '../../common/config';
import { FlagsService } from '../../control-plane/control-plane-public';
import { PrismaService } from '../../prisma/prisma.service';
import { AttributionPolicyResolver } from '../attribution/policy';
import { verifyAnyLinkToken } from '../consent/link-token';
import { LinkRegistryService } from '../links/link-registry.service';
import { FraudSignalService } from '../fraud/touch-rules';
import { growthError } from '../growth-errors';
import { GROWTH_DEFAULT_MARKET, GROWTH_FLAG } from '../growth-flags';
import { GrowthLimiter, growthLimits } from '../growth-limiter';
import { growthKey, linkTokenKey, providerLinkTouchSecret, randomToken, sha256Hex } from '../growth-secrets';
import { PROVIDER_OWNED_KINDS } from '../attribution/decide';
import { sourceKindOf, uaClassOf, referrerHostOf, VISITOR_KEY_PATTERN, type ParsedTouch } from './touch-sanitizer';

export interface TouchContext {
  /** `X-KX-Consent: analytics` was present. */
  consentAnalytics: boolean;
  /** Visitor key read from the `kxv` cookie, if any. */
  cookieVisitorKey?: string;
  ipHash: string;
  userAgent?: string;
  referer?: string;
  origin?: string;
  locale?: string;
  market?: string;
  now?: Date;
}
export interface TouchResult { accepted: true; visitorKeySet: boolean; visitorKey?: string; persisted: boolean; touchId?: string }

const dwellFloorFallback = 1000;

/**
 * POST /growth/v1/touch (GRW-P1-B). Rules, in order: rate limit by rotating ipHash; shape and PHI checks (sanitiser); the in-session link token is verified
 * (a bad token is an error, a good one is honoured for the booking in the same session without storing anything); then the CONSENT GATE: without
 * `X-KX-Consent: analytics` AND an effective growth.analytics_visitor flag, NO visitor key and NO touchpoint is created. Fraud hooks run either way and
 * store only keyed hashes. The touch stores no IP, no full user agent, no full referrer, no search text, no unknown parameter.
 */
@Injectable()
export class TouchService {
  constructor(
    private readonly prisma: PrismaService, private readonly flags: FlagsService, private readonly limiter: GrowthLimiter,
    private readonly fraud: FraudSignalService, private readonly policies: AttributionPolicyResolver, private readonly links: LinkRegistryService,
  ) {}

  /** Visitor keys are opaque and unguessable; a cookie that does not match the format is ignored and replaced. */
  private newVisitorKey() { return `kxv_${randomToken(18)}`; }
  private clickHash(kind: string, value: string) { return createHmac('sha256', growthKey('clickid')).update(`${kind}|${value}`).digest('base64url'); }

  async record(t: ParsedTouch, ctx: TouchContext): Promise<TouchResult> {
    const now = ctx.now ?? new Date(); const market = ctx.market ?? GROWTH_DEFAULT_MARKET;
    await this.limiter.take('touch', ctx.ipHash, growthLimits().touchPerMin);

    let claims: { org: string; code: string; n: string } | undefined;
    if (t.lt !== undefined) {
      const v = verifyAnyLinkToken({ kxl1: linkTokenKey(), provider: providerLinkTouchSecret() }, t.lt, now.getTime());
      if (!v.ok) throw growthError(v.reason === 'EXPIRED' ? 'GROWTH_LINK_TOKEN_EXPIRED' : 'GROWTH_LINK_TOKEN_INVALID', v.reason === 'EXPIRED' ? 'The link token expired' : 'The link token is not valid');
      claims = { ...v.claims, n: sha256Hex(t.lt).slice(0, 16) }; // an opaque token id; the token itself is never stored
      await this.links.learn(v.claims.code, v.claims.org, market); // a code belongs to ONE organisation: on a conflict the registry keeps the first and the mismatch check below ignores the touch
    }

    const policy = await this.policies.get(market, now);
    const referrerHost = referrerHostOf(ctx.referer, ctx.origin);
    const kind = sourceKindOf(t, referrerHost);
    const providerOwned = (PROVIDER_OWNED_KINDS as readonly string[]).includes(kind);
    await this.fraud.onTouch({ ipHash: ctx.ipHash, providerOwned, dwellMs: t.dwellMs, minDwellMs: policy.minDwellMsForProviderTouch ?? dwellFloorFallback });

    // ── the consent gate ──
    const visitorKeysEnabled = ctx.consentAnalytics && (await this.flags.isEnabled(GROWTH_FLAG.ANALYTICS_VISITOR, { market }).catch(() => false));
    if (!visitorKeysEnabled) return { accepted: true, visitorKeySet: false, persisted: false };

    // ── resolve the source; a code nobody registered is ignored (nothing stored) ──
    let sourceRef = ''; let orgRef: string | null = null; let linkCode: string | null = null;
    if (kind === 'PROVIDER_LINK' || kind === 'WIDGET' || kind === 'REFERRAL') {
      const code = t.ref ?? claims?.code;
      if (code) {
        const src = await this.prisma.growthAcquisitionSource.findFirst({ where: { market, sourceKind: kind, sourceRef: code, active: true } })
          ?? (kind === 'PROVIDER_LINK' ? await this.prisma.growthAcquisitionSource.findFirst({ where: { market, sourceKind: 'PROVIDER_QR', sourceRef: code, active: true } }) : null);
        if (src) { sourceRef = src.sourceRef; orgRef = src.ownerOrgRef; linkCode = code; }
      }
      if (!orgRef && claims && kind !== 'REFERRAL') { orgRef = claims.org; linkCode = linkCode ?? claims.code; sourceRef = sourceRef || claims.code; } // a verified token proves the organisation even before the link projection arrives
      if (kind !== 'REFERRAL' && !orgRef) return { accepted: true, visitorKeySet: false, persisted: false };
      if (kind === 'REFERRAL' && !linkCode) return { accepted: true, visitorKeySet: false, persisted: false };
      if (claims && orgRef && claims.org !== orgRef) return { accepted: true, visitorKeySet: false, persisted: false }; // token and code disagree: ignore, never guess
    }
    // GRW-P2-A: a touch carrying the utm_campaign of a campaign is a CAMPAIGN touch; the source ref is the campaign id ONLY while that campaign is ACTIVE (an expired, paused or unknown one stays a CAMPAIGN touch with no id)
    const campaign = await this.campaignOf(t.utm.campaign, market, kind);
    const touchKind = campaign ? 'CAMPAIGN' : kind;
    const source = await this.source(market, touchKind, campaign ? campaign.ref : sourceRef);
    const visitorKey = ctx.cookieVisitorKey && VISITOR_KEY_PATTERN.test(ctx.cookieVisitorKey) ? ctx.cookieVisitorKey : this.newVisitorKey();
    const touch = await this.prisma.growthTouchpoint.create({
      data: {
        market, visitorKey, sourceId: source.id, kind: touchKind, providerOrgRef: orgRef, linkCode, landingKind: t.landingKind, localeAt: ctx.locale === 'en' ? 'en' : 'ar',
        utmSource: t.utm.source, utmMedium: t.utm.medium, utmCampaign: t.utm.campaign, utmContent: t.utm.content, utmTerm: t.utm.term,
        clickIdKind: t.clickId?.kind, clickIdHash: t.clickId ? this.clickHash(t.clickId.kind, t.clickId.value) : undefined,
        referrerHost, dwellMs: t.dwellMs, ltTokenId: claims?.n, occurredAt: now, ipHash: ctx.ipHash, uaClass: uaClassOf(ctx.userAgent),
      },
    });
    return { accepted: true, visitorKeySet: true, visitorKey, persisted: true, touchId: touch.id };
  }

  /** Provider-owned, widget and referral touches are never re-labelled; with the flag growth.campaigns OFF nothing is tagged (past tags stay). */
  private async campaignOf(utm: string | undefined, market: string, kind: string): Promise<{ ref: string } | null> {
    if (!utm || (PROVIDER_OWNED_KINDS as readonly string[]).includes(kind) || kind === 'WIDGET' || kind === 'REFERRAL') return null;
    if (!(await this.flags.isEnabled(GROWTH_FLAG.CAMPAIGNS, { market }).catch(() => false))) return null;
    const c = await this.prisma.growthCampaign.findFirst({ where: { market, utmCampaign: utm }, select: { id: true, status: true } });
    return c ? { ref: c.status === 'ACTIVE' ? c.id : '' } : null;
  }

  private async source(market: string, kind: string, ref: string) {
    const where = { market_sourceKind_sourceRef: { market, sourceKind: kind, sourceRef: ref } };
    const found = await this.prisma.growthAcquisitionSource.findUnique({ where });
    if (found) return found;
    try { return await this.prisma.growthAcquisitionSource.create({ data: { market, sourceKind: kind, sourceRef: ref } }); }
    catch (e) { if ((e as { code?: string }).code === 'P2002') return this.prisma.growthAcquisitionSource.findUniqueOrThrow({ where }); throw e; }
  }

  /** Cookie attributes for `kxv` (host-only: no Domain; Secure outside dev; SameSite=Lax; at most 180 days or the policy's visitorKeyMaxDays). */
  async cookieFor(visitorKey: string, market = GROWTH_DEFAULT_MARKET) {
    const policy = await this.policies.get(market, new Date());
    const days = Math.min(180, policy.visitorKeyMaxDays ?? 180);
    return `kxv=${visitorKey}; Path=/; Max-Age=${days * 86_400}; HttpOnly; SameSite=Lax${cfg().isProd || process.env.GROWTH_COOKIE_SECURE === 'true' ? '; Secure' : ''}`;
  }
  clearCookie() { return `kxv=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${cfg().isProd || process.env.GROWTH_COOKIE_SECURE === 'true' ? '; Secure' : ''}`; }
}
