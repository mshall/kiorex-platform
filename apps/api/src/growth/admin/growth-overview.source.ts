import { Injectable } from '@nestjs/common';
import { GROWTH_EVENT_NAMES } from '@kiorex/contracts';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Where the Executive Overview gets its numbers. GRW-P1-J (growth analytics v1) will provide an implementation behind this token with k-anonymity, definitions and
 * dimensions; until it lands, `InternalOverviewSource` answers from the raw growth tables (events, decisions, touches). The console never knows which one it got:
 * it reads `source` only to label the page honestly.
 */
export const GROWTH_OVERVIEW_SOURCE = Symbol('GROWTH_OVERVIEW_SOURCE');
export interface OverviewQuery { market: string; days: number }
export interface OverviewData {
  source: 'internal' | 'analytics-v1';
  days: number; market: string; since: string;
  funnel: Array<{ name: string; count: number }>;
  origins: Array<{ origin: string; count: number }>;
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
    const [events, origins, reasons, touches] = await Promise.all([
      this.prisma.growthEvent.groupBy({ by: ['name'], where: { market, occurredAt: { gte: since } }, _count: { _all: true } }),
      // originals only: a correction supersedes a decision and must not be counted twice
      this.prisma.growthAttributionDecision.groupBy({ by: ['origin'], where: { market, createdAt: { gte: since }, supersedesId: null }, _count: { _all: true } }),
      this.prisma.growthAttributionDecision.groupBy({ by: ['reasonCode'], where: { market, createdAt: { gte: since }, supersedesId: null }, _count: { _all: true } }),
      this.prisma.growthTouchpoint.groupBy({ by: ['kind'], where: { market, occurredAt: { gte: since } }, _count: { _all: true } }),
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
