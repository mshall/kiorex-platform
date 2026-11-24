import { Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GROWTH_DEFAULT_MARKET } from '../growth-flags';
import { GrowthLimiter, growthLimits } from '../growth-limiter';
import { sha256Hex } from '../growth-secrets';
import { FRAUD_SCORER, type FraudScorer } from './fraud-public';

/**
 * Fraud signal hooks for the attribution inputs (ARCH section 19): provider gaming must not be able to turn marketplace patients into provider-led ones.
 * Rules are PURE (below); `FraudSignalService` only writes `GrowthFraudSignal` rows: a rule id, a keyed subject hash (never an identifier), a score and an
 * evidence reference. Signals NEVER change a decision by themselves: they feed review (Phase 2 queue) and the dispute auto-approval evidence.
 */
export const FRAUD_RULES = { CLICK_WITHOUT_RENDER: 'CLICK_WITHOUT_RENDER', BURST_PER_IP_HASH: 'BURST_PER_IP_HASH', PROVIDER_LED_SHARE_JUMP: 'PROVIDER_LED_SHARE_JUMP' } as const;
export interface RuleHit { ruleId: string; score: number }

/** A provider-owned landing that was never rendered long enough: a bare redirect, prefetch or scripted click. */
export function clickWithoutRender(t: { providerOwned: boolean; dwellMs?: number | null }, minDwellMs: number): RuleHit | null {
  if (!t.providerOwned) return null;
  return t.dwellMs === undefined || t.dwellMs === null || t.dwellMs < minDwellMs ? { ruleId: FRAUD_RULES.CLICK_WITHOUT_RENDER, score: 20 } : null;
}
/** More touches from one rotating ipHash inside a minute than a person produces. */
export function burstPerIpHash(countInMinute: number, limitPerMinute: number): RuleHit | null {
  return countInMinute > limitPerMinute ? { ruleId: FRAUD_RULES.BURST_PER_IP_HASH, score: 40 } : null;
}
/** The provider-led share of an organisation's decisions in the last day is far above its own 30-day baseline (needs a minimum sample on both sides). */
export function providerLedShareJump(s: { recentLed: number; recentTotal: number; baselineLed: number; baselineTotal: number }, o = { minRecent: 10, minBaseline: 30, jump: 0.35 }): RuleHit | null {
  if (s.recentTotal < o.minRecent || s.baselineTotal < o.minBaseline) return null;
  const recent = s.recentLed / s.recentTotal; const base = s.baselineLed / s.baselineTotal;
  return recent - base >= o.jump ? { ruleId: FRAUD_RULES.PROVIDER_LED_SHARE_JUMP, score: Math.min(100, Math.round(50 + (recent - base) * 50)) } : null;
}

@Injectable()
export class FraudSignalService {
  constructor(private readonly prisma: PrismaService, private readonly limiter: GrowthLimiter, @Optional() @Inject(FRAUD_SCORER) private readonly scorer?: FraudScorer) {}

  async record(hit: RuleHit, subject: string, evidenceRef?: string, market = GROWTH_DEFAULT_MARKET) {
    await this.prisma.growthFraudSignal.create({ data: { market, ruleId: hit.ruleId, subjectHash: sha256Hex(`${hit.ruleId}|${subject}`).slice(0, 32), score: hit.score, evidenceRef } });
  }

  /** Called for every touch (consented or not: it stores only the keyed hash of the rotating ip hash). Never throws into the request. */
  async onTouch(t: { ipHash: string; providerOwned: boolean; dwellMs?: number | null; minDwellMs: number; touchId?: string }) {
    try {
      const cwr = clickWithoutRender(t, t.minDwellMs);
      if (cwr) await this.record(cwr, t.ipHash, t.touchId);
      let burstRefused = false;
      // count touches per ipHash per minute in the shared limiter; the first refusal in a 10 minute window writes ONE signal
      const burst = await this.limiter.limiter.hit(`growth:burst:${t.ipHash}`, growthLimits().burstPerMin, 60_000);
      if (!burst.ok) {
        const first = await this.limiter.limiter.hit(`growth:burst-signal:${t.ipHash}`, 1, 600_000);
        if (first.ok) { const hit = burstPerIpHash(growthLimits().burstPerMin + 1, growthLimits().burstPerMin); if (hit) await this.record(hit, t.ipHash); }
        burstRefused = true;
      }
      // GRW-P3-D: the same signals as one scored rule (shadow: a case, never an attribution change)
      if (this.scorer && (cwr || burstRefused)) await this.scorer.onTouch({ ipHash: t.ipHash, burst: burstRefused, burstLimit: growthLimits().burstPerMin, clickWithoutRender: !!cwr });
    } catch { /* fraud hooks are best effort: a failure must never lose a touch */ }
  }

  /** After a decision for an organisation: compare its last-24h provider-led share with its 30-day baseline. */
  async onDecision(orgId: string, now = new Date()) {
    try {
      const rows = await this.prisma.$queryRaw<{ recent_led: bigint; recent_total: bigint; base_led: bigint; base_total: bigint }[]>`
        SELECT count(*) FILTER (WHERE d."origin" = 'PROVIDER_LED' AND d."createdAt" >= ${new Date(now.getTime() - 86_400_000)}) AS recent_led,
               count(*) FILTER (WHERE d."createdAt" >= ${new Date(now.getTime() - 86_400_000)}) AS recent_total,
               count(*) FILTER (WHERE d."origin" = 'PROVIDER_LED' AND d."createdAt" < ${new Date(now.getTime() - 86_400_000)}) AS base_led,
               count(*) FILTER (WHERE d."createdAt" < ${new Date(now.getTime() - 86_400_000)}) AS base_total
        FROM "GrowthAttributionDecision" d JOIN "BookingIntent" b ON b."id" = d."bookingId"
        WHERE b."tenantId" = ${orgId} AND d."supersedesId" IS NULL AND d."createdAt" >= ${new Date(now.getTime() - 30 * 86_400_000)}`;
      const r = rows[0]; if (!r) return;
      const hit = providerLedShareJump({ recentLed: Number(r.recent_led), recentTotal: Number(r.recent_total), baselineLed: Number(r.base_led), baselineTotal: Number(r.base_total) });
      if (hit) await this.record(hit, orgId, `org:${orgId}`);
    } catch { /* best effort */ }
  }
}
