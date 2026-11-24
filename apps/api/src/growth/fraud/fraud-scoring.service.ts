import { Injectable, Logger } from '@nestjs/common';
import { subRefOf } from '../../common/privacy-hash';
import { FlagsService } from '../../control-plane/control-plane-public';
import { GrowthLimiter } from '../growth-limiter';
import { GROWTH_DEFAULT_MARKET } from '../growth-flags';
import { FraudCaseService } from './case.service';
import { evaluateFraud } from './engine';
import { FraudConfigService } from './fraud-config.service';
import { FraudHoldService } from './fraud-hold.service';
import type { Assessment, AssessContext, FraudScorer } from './fraud-public';
import type { FraudFeatures, FraudSurface } from './signals';

const NONE: Assessment = { action: 'NONE', shadowAction: 'NONE', band: 'ALLOW', score: 0, caseId: null };
const HOUR = 3_600_000;
export const FRAUD_SCORING_FLAG = 'growth.fraud_scoring';

/**
 * The entry point other modules use (through the `FRAUD_SCORER` port): evaluate the rules for a surface, record a case when the SHADOW band is REVIEW or HOLD, and take the action
 * only for the rules switched to enforce (the maker-checker config). Best effort: a failure here never fails the request that called it (it returns NONE).
 */
@Injectable()
export class FraudScoringService implements FraudScorer {
  private readonly log = new Logger('fraud-scoring');
  constructor(private readonly cfg: FraudConfigService, private readonly cases: FraudCaseService, private readonly hold: FraudHoldService, private readonly flags: FlagsService, private readonly limiter: GrowthLimiter) {}

  async assess(surface: FraudSurface, features: FraudFeatures, ctx: AssessContext): Promise<Assessment> {
    const market = ctx.market ?? GROWTH_DEFAULT_MARKET;
    try {
      if (!(await this.flags.isEnabled(FRAUD_SCORING_FLAG, { market }))) return NONE;
      const cfg = await this.cfg.get(market);
      const ev = evaluateFraud(cfg, surface, features);
      if (!ev.signals.length) return NONE;
      const rec = await this.cases.record(ev, { market, subject: ctx.subject, evidenceRef: ctx.evidenceRef, cfg });
      if (ev.action !== 'NONE') await this.hold.apply(ev.action, { relationshipIds: ctx.relationshipIds ?? [], touchRef: ctx.touchRef, originRef: ctx.originRef });
      return { action: ev.action, shadowAction: ev.shadowAction, band: ev.shadow.band, score: ev.shadow.score, caseId: rec?.id ?? null };
    } catch (e) { this.log.warn(`assess ${surface} failed: ${(e as Error).message}`); return NONE; }
  }

  // ── counters over the shared limiter: `atLeast` answers "did this key reach n hits in the window" without a counter table ──
  private async count(key: string, windowMs: number): Promise<void> { await this.limiter.limiter.hit(key, 1_000_000, windowMs); }
  private async atLeast(key: string, n: number, windowMs: number): Promise<boolean> { return !(await this.limiter.limiter.blocked(key, n, windowMs)).ok; }

  async onTouch(t: { ipHash: string; burst: boolean; burstLimit: number; clickWithoutRender: boolean; day?: string }): Promise<Assessment | null> {
    if (!t.burst && !t.clickWithoutRender) return null;
    const cfg = await this.cfg.get().catch(() => null); if (!cfg) return null;
    const day = t.day ?? new Date().toISOString().slice(0, 10);
    return this.assess('TOUCH', { ...(t.burst ? { touchBurstPerMinute: t.burstLimit + 1, touchBurstLimit: t.burstLimit } : {}), clickWithoutRender: t.clickWithoutRender }, { subject: `ip:${t.ipHash}`, evidenceRef: `touch:burst:${day}` });
  }

  async onLinkToken(t: { ipHash: string; ok: boolean; tokenId?: string; expired?: boolean }): Promise<Assessment | null> {
    try {
      const { thresholds } = await this.cfg.get();
      if (!t.ok && !t.expired) return this.assess('TOUCH', { ltSignatureInvalid: true }, { subject: `ip:${t.ipHash}`, evidenceRef: `lt:invalid:${new Date().toISOString().slice(0, 10)}` });
      if (!t.tokenId) return null;
      const use = `fraud:lt:use:${t.tokenId}`; await this.count(use, HOUR);
      const pair = `fraud:lt:pair:${t.tokenId}:${t.ipHash}`;
      if ((await this.limiter.limiter.hit(pair, 1, HOUR)).ok) await this.count(`fraud:lt:subjects:${t.tokenId}`, HOUR);
      const useCount = (await this.atLeast(use, thresholds.ltUseCountLimit + 1, HOUR)) ? thresholds.ltUseCountLimit + 1 : 0;
      const subjects = (await this.atLeast(`fraud:lt:subjects:${t.tokenId}`, thresholds.ltDistinctSubjectsLimit, HOUR)) ? thresholds.ltDistinctSubjectsLimit : 0;
      if (!useCount && !subjects && !t.expired) return null;
      return this.assess('TOUCH', { ltUseCount: useCount, ltDistinctSubjects: subjects, ltUsedAfterExpiry: !!t.expired }, { subject: `lt:${t.tokenId}`, evidenceRef: `lt:${t.tokenId}` });
    } catch { return null; }
  }

  private originRef(origin: string | null | undefined): string { return subRefOf(`origin:${(origin ?? '').toLowerCase()}`).slice(0, 16); }

  async onWidgetDenied(t: { org: string | null; origin: string | null | undefined; reason: string }): Promise<void> {
    try {
      const { thresholds } = await this.cfg.get(); const ref = this.originRef(t.origin);
      const f: FraudFeatures = {};
      if (t.reason === 'ORIGIN_MISMATCH' || t.reason === 'ORIGIN_NOT_ALLOWED' || t.reason === 'REFERER_NOT_ALLOWED') {
        const k = `fraud:wd:mismatch:${ref}`; await this.count(k, HOUR);
        if (await this.atLeast(k, thresholds.widgetOriginMismatches, HOUR)) f.widgetOriginMismatches = thresholds.widgetOriginMismatches;
        if (t.org) {
          if ((await this.limiter.limiter.hit(`fraud:wd:pair:${t.org}:${ref}`, 1, HOUR)).ok) await this.count(`fraud:wd:origins:${t.org}`, HOUR);
          if (await this.atLeast(`fraud:wd:origins:${t.org}`, thresholds.widgetDistinctOriginsPerKey1h, HOUR)) f.widgetDistinctOriginsPerKey1h = thresholds.widgetDistinctOriginsPerKey1h;
        }
      }
      if (t.reason === 'TOKEN_INVALID') { const k = `fraud:wd:replay:${ref}`; await this.count(k, HOUR); if (await this.atLeast(k, thresholds.widgetTokenReplays, HOUR)) f.widgetTokenReplays = thresholds.widgetTokenReplays; }
      if (Object.keys(f).length) await this.assess('WIDGET', f, { subject: `widget:${ref}`, evidenceRef: `widget:${ref}`, originRef: ref });
    } catch { /* best effort */ }
  }

  async originThrottled(origin: string | null | undefined): Promise<boolean> {
    if (!origin) return false;
    try { return await this.hold.originThrottled(this.originRef(origin)); } catch { return false; }
  }
}
