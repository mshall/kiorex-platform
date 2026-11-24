import { Injectable } from '@nestjs/common';
import { GrowthMetricsService, type Audience, type GrowthFilters } from './metrics.service';

/** CSV cells that start with a formula character are neutralised (spreadsheet injection); every other value comes from a closed set or a number. */
const cell = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s) && typeof v === 'string' && s !== '<10') s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (header: string[], rows: Array<Record<string, unknown>>) => [header.join(','), ...rows.map((r) => header.map((h) => cell(r[h])).join(','))].join('\n') + '\n';

/** CSV export. It is built from the SAME service outputs as the screens, so the k >= 10 masking is identical (a test compares them). No raw rollup rows are ever exported. */
@Injectable()
export class GrowthExportService {
  constructor(private readonly metrics: GrowthMetricsService) {}

  async csv(report: 'funnel' | 'channels' | 'breakdown' | 'cohorts' | 'overview', f: GrowthFilters, a: Audience, opts: { dimension?: string } = {}): Promise<string> {
    if (report === 'funnel') { const r = await this.metrics.funnel(f, a); return toCsv(['stage', 'kind', 'count', 'stepConversionPct', 'cumulativeConversionPct'], r.stages as unknown as Array<Record<string, unknown>>); }
    if (report === 'channels') { const r = await this.metrics.channels(f, a, ['sourceKind', 'campaign']); const own = a.kind === 'OPS'; return toCsv(['sourceKind', 'campaign', 'bookings', 'attendedNewPatients', ...(own ? ['spendMinor', 'revenueMinor', 'cacMinor', 'roas', 'ltvToCac', 'verdict'] : [])], r.rows as unknown as Array<Record<string, unknown>>); }
    if (report === 'breakdown') { const dim = (opts.dimension ?? 'city') as never; const r = await this.metrics.breakdown(f, a, dim); return toCsv([String(dim), 'bookings', 'attendedNewPatients', 'providerLedSharePct'], r.rows as unknown as Array<Record<string, unknown>>); }
    if (report === 'cohorts') { const r = await this.metrics.cohorts({ market: f.market, origin: f.origin }, a); return toCsv(['cohort', 'size', 'retention30Pct', 'retention90Pct', 'retention180Pct'], r.rows as unknown as Array<Record<string, unknown>>); }
    const o = await this.metrics.overview(f, a) as unknown as Record<string, unknown>;
    const keys = Object.keys(o).filter((k) => ['number', 'string'].includes(typeof o[k]) && !['audience'].includes(k));
    return toCsv(['metric', 'value'], keys.map((k) => ({ metric: k, value: o[k] })));
  }
}
