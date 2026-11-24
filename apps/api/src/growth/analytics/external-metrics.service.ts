import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GROWTH_INTEGRATION_KINDS, type GrowthIntegrationKind } from '../integrations/port';

export interface ExternalTotals { [metric: string]: number }
export interface ExternalByKey { [dimensionKey: string]: ExternalTotals }
export interface ExternalKindView { kind: GrowthIntegrationKind; connected: boolean; synthetic: boolean; lastRunAt: string | null; byKey: ExternalByKey; totals: ExternalTotals }

/**
 * Reads the stored external aggregates (GrowthExternalMetricDaily) and tells which integrations have data. "Connected" means a run that did not fail and at least one stored row in the window;
 * a missing integration is "not connected", never zero. `synthetic` is true when the latest run was a mock run.
 */
@Injectable()
export class ExternalMetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async load(market: string, from: string, to: string): Promise<Record<GrowthIntegrationKind, ExternalKindView>> {
    const range = { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) };
    const [sums, lastRuns] = await Promise.all([
      this.prisma.growthExternalMetricDaily.groupBy({ by: ['kind', 'dimensionKey', 'metric'], where: { market, day: range }, _sum: { value: true } }),
      this.prisma.growthIntegrationRun.findMany({ where: { market, status: { in: ['OK', 'PARTIAL'] } }, orderBy: { startedAt: 'desc' }, distinct: ['kind'], select: { kind: true, mode: true, startedAt: true } }),
    ]);
    const out = {} as Record<GrowthIntegrationKind, ExternalKindView>;
    for (const kind of GROWTH_INTEGRATION_KINDS) {
      const rows = sums.filter((s) => s.kind === kind); const last = lastRuns.find((r) => r.kind === kind);
      const byKey: ExternalByKey = {}; const totals: ExternalTotals = {};
      for (const r of rows) { const v = Number(r._sum.value ?? 0); (byKey[r.dimensionKey] ??= {})[r.metric] = v; totals[r.metric] = (totals[r.metric] ?? 0) + v; }
      out[kind] = { kind, connected: rows.length > 0, synthetic: last?.mode === 'mock', lastRunAt: last?.startedAt.toISOString() ?? null, byKey, totals };
    }
    return out;
  }
}
