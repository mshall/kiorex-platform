import { Injectable } from '@nestjs/common';
import { GROWTH_EVENT_NAMES } from '@kiorex/contracts';
import { quarantinedTouchIds } from '../fraud/quarantine';
import { PrismaService } from '../../prisma/prisma.service';
import { GrowthMetricsService, parseFilters } from '../analytics/metrics.service';

/**
 * Where the Executive Overview gets its numbers. Bound to `AnalyticsOverviewSource` (GRW-P1-J growth analytics v1: rolled-up facts, k-anonymity k >= 10, KX-32
 * definitions). Until the first rollup has ever run it falls back to `InternalOverviewSource`, which answers from the raw growth tables (events, decisions, touches).
 * The console never knows which one it got: it reads `source` only to label the page honestly.
 */
export const GROWTH_OVERVIEW_SOURCE = Symbol('GROWTH_OVERVIEW_SOURCE');
export interface OverviewQuery { market: string; days: number }
export interface OverviewData {
  source: 'internal' | 'analytics-v1';
  days: number; market: string; since: string;
  /** `masked`: the cell rests on fewer than 10 units (analytics-v1 only); `count` is then 0 and must be shown as "<10". */
  funnel: Array<{ name: string; count: number; masked?: boolean }>;
  origins: Array<{ origin: string; count: number; masked?: boolean }>;
  reasons: Array<{ reason: string; count: number }>;
  touchesBySource: Array<{ sourceKind: string; count: number }>;
  providerLedShare: number | null;
}
export interface GrowthOverviewSource { overview(q: OverviewQuery): Promise<OverviewData> }

@Injectable()
export class InternalOverviewSource implements GrowthOverviewSource {
  constructor(private readonly prisma: PrismaService) {}
  async overview({ market, days }: OverviewQuery): Promise<OverviewData> {
    const since = new Date(Date.now() - days * 86_400_000);
    const quarantined = await quarantinedTouchIds(this.prisma); // QUARANTINE_TOUCH: reports do not count a quarantined touch
    const [events, origins, reasons, touches] = await Promise.all([
      this.prisma.growthEvent.groupBy({ by: ['name'], where: { market, occurredAt: { gte: since } }, _count: { _all: true } }),
      // originals only: a correction supersedes a decision and must not be counted twice
      this.prisma.growthAttributionDecision.groupBy({ by: ['origin'], where: { market, createdAt: { gte: since }, supersedesId: null }, _count: { _all: true } }),
      this.prisma.growthAttributionDecision.groupBy({ by: ['reasonCode'], where: { market, createdAt: { gte: since }, supersedesId: null }, _count: { _all: true } }),
      this.prisma.growthTouchpoint.groupBy({ by: ['kind'], where: { market, occurredAt: { gte: since }, ...(quarantined.length ? { id: { notIn: quarantined } } : {}) }, _count: { _all: true } }),
    ]);
    const led = origins.find((o) => o.origin === 'PROVIDER_LED')?._count._all ?? 0;
    const mp = origins.find((o) => o.origin === 'MARKETPLACE')?._count._all ?? 0;
    const byName = new Map(events.map((e) => [e.name, e._count._all]));
    return {
      source: 'internal', days, market, since: since.toISOString(),
      funnel: GROWTH_EVENT_NAMES.map((name) => ({ name, count: byName.get(name) ?? 0 })),
      origins: origins.map((o) => ({ origin: o.origin, count: o._count._all })).sort((a, b) => b.count - a.count),
      reasons: reasons.map((r) => ({ reason: r.reasonCode, count: r._count._all })).sort((a, b) => b.count - a.count),
      touchesBySource: touches.map((t) => ({ sourceKind: t.kind, count: t._count._all })).sort((a, b) => b.count - a.count),
      providerLedShare: led + mp > 0 ? led / (led + mp) : null,
    };
  }
}

const ORIGINS = ['PROVIDER_LED', 'MARKETPLACE', 'UNATTRIBUTED'] as const;

/**
 * Executive Overview from the real analytics service (GrowthMetricsService). Funnel stages and the origin mix are the rolled-up, k-anonymised figures; the decision
 * reasons and the touch sources (not part of the analytics model) come from the raw tables, and every small cell there is masked the same way (< 10 shows as masked).
 * Falls back to the raw-table source only when no rollup has ever run, and then says so (`source: 'internal'`).
 */
@Injectable()
export class AnalyticsOverviewSource implements GrowthOverviewSource {
  constructor(private readonly metrics: GrowthMetricsService, private readonly internal: InternalOverviewSource, private readonly prisma: PrismaService) {}
  async overview(q: OverviewQuery): Promise<OverviewData> {
    const fresh = await this.metrics.freshness();
    if (!fresh.rolledUpAt) return this.internal.overview(q);
    const to = new Date(); const from = new Date(to.getTime() - q.days * 86_400_000);
    const f = { ...parseFilters({ from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }), market: q.market };
    const a = { kind: 'OPS' as const };
    const [fun, ov, raw] = await Promise.all([this.metrics.funnel(f, a), this.metrics.overview(f, a), this.internal.overview(q)]);
    const stageCount = new Map(fun.stages.map((st) => [st.stage as string, st]));
    const mix = ov.originMix;
    const mixOf: Record<(typeof ORIGINS)[number], unknown> = { PROVIDER_LED: mix.providerLed, MARKETPLACE: mix.marketplace, UNATTRIBUTED: mix.unattributed };
    const cell = (v: unknown) => (typeof v === 'number' ? { count: v, masked: false } : { count: 0, masked: true });
    const mask = (n: number) => (n > 0 && n < 10 ? { count: 0, masked: true } : { count: n, masked: false });
    return {
      source: 'analytics-v1', days: q.days, market: q.market, since: raw.since,
      funnel: GROWTH_EVENT_NAMES.map((name) => { const st = stageCount.get(name); return st ? { name, ...cell(st.count) } : { name, count: 0 }; }),
      origins: ORIGINS.map((origin) => ({ origin, ...cell(mixOf[origin]) })).filter((o) => o.count > 0 || o.masked).sort((x, y) => y.count - x.count),
      reasons: raw.reasons.map((r) => ({ reason: r.reason, ...mask(r.count) })).map((r) => ({ reason: r.reason, count: r.count, ...(r.masked ? { masked: true } : {}) })),
      touchesBySource: raw.touchesBySource.map((t) => ({ sourceKind: t.sourceKind, ...mask(t.count) })),
      providerLedShare: typeof ov.providerLedShare === 'number' ? ov.providerLedShare / 100 : null,
    };
  }
}
