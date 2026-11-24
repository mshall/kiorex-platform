import { createHash } from 'node:crypto';
import { PULLS } from '../port';
import type { AdapterHealth, GrowthAdapter, GrowthIntegrationKind, MetricRow, PullRange } from '../port';

/** Deterministic integer in [lo, hi] from a string (same inputs, same synthetic number, in any process). */
export const synth = (seed: string, lo: number, hi: number): number => lo + (createHash('sha256').update(seed).digest().readUInt32BE(0) % (hi - lo + 1));
export const daysOf = (r: PullRange): string[] => {
  const out: string[] = []; const end = Date.parse(`${r.to}T00:00:00Z`);
  for (let t = Date.parse(`${r.from}T00:00:00Z`); t <= end && out.length < 400; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};
const TEMPLATES = ['template:doctor', 'template:clinic', 'template:listing', 'template:other'];
const CHANNELS = ['channel:organic_search', 'channel:direct', 'channel:paid_search', 'channel:referral'];
const CATEGORIES = ['category:marketing', 'category:utility', 'category:authentication', 'category:service'];

/** Fault injection for the adapter contract suite: `failNext` throws that error once per call until cleared. */
export interface MockOptions { failWith?: Error }

type Gen = (kind: GrowthIntegrationKind, r: PullRange, what: 'spend' | 'performance' | 'coreVitals') => MetricRow[];
const campaignRows = (what: 'spend' | 'performance'): Gen => (kind, r) => daysOf(r).flatMap((day) => (r.dimensionKeys ?? []).flatMap((key) => {
  const s = `${kind}|${day}|${key}`; const imp = synth(`${s}|imp`, 800, 9000); const clicks = Math.max(1, Math.floor(imp * synth(`${s}|ctr`, 15, 60) / 1000));
  const cpc = synth(`${s}|cpc`, 300, 1500); // piastres
  return what === 'spend'
    ? [{ day, dimensionKey: key, metric: 'spend_minor', value: clicks * cpc, currency: r.currency ?? 'EGP' }]
    : [{ day, dimensionKey: key, metric: 'impressions', value: imp }, { day, dimensionKey: key, metric: 'clicks', value: clicks }, { day, dimensionKey: key, metric: 'conversions', value: Math.floor(clicks * synth(`${s}|cvr`, 20, 90) / 1000) }];
}));
const dimRows = (dims: string[], metrics: Array<[string, number, number]>): Gen => (kind, r) => daysOf(r).flatMap((day) => dims.flatMap((d) => metrics.map(([m, lo, hi]) => ({ day, dimensionKey: d, metric: m, value: synth(`${kind}|${day}|${d}|${m}`, lo, hi) }))));
const GEN: Record<GrowthIntegrationKind, Partial<Record<'spend' | 'performance' | 'coreVitals', Gen>>> = {
  googleads: { spend: campaignRows('spend'), performance: campaignRows('performance') },
  metaads: { spend: campaignRows('spend'), performance: campaignRows('performance') },
  tiktok: { spend: campaignRows('spend'), performance: campaignRows('performance') },
  searchconsole: { performance: dimRows(TEMPLATES, [['impressions', 400, 6000], ['clicks', 20, 400]]) },
  ga4: { performance: dimRows(CHANNELS, [['sessions', 50, 900], ['conversions', 2, 60]]) },
  playconsole: { performance: dimRows(['country:EG'], [['store_listing_views', 200, 1500], ['installs', 15, 140], ['uninstalls', 2, 30], ['crash_rate_bp', 5, 90]]) },
  appstoreconnect: { performance: dimRows(['country:EG'], [['impressions', 500, 4000], ['product_page_views', 80, 700], ['downloads', 8, 90]]) },
  whatsappcloud: { performance: dimRows(CATEGORIES, [['conversations', 5, 220], ['cost_micros', 0, 40_000_000]]) },
  fcmapns: { performance: dimRows(['platform:android', 'platform:ios'], [['push_accepted', 100, 2500], ['push_unregistered', 0, 40], ['push_failed', 0, 25]]) },
  crux: { coreVitals: dimRows(['template:doctor', 'template:clinic', 'template:all'], [['lcp_p75', 1800, 3200], ['inp_p75', 90, 280], ['cls_p75', 2, 14]]) }, // cls in hundredths
};

export class MockGrowthAdapter implements GrowthAdapter {
  readonly mode = 'mock' as const;
  constructor(readonly kind: GrowthIntegrationKind, private readonly opts: MockOptions = {}) {}
  async health(): Promise<AdapterHealth> { if (this.opts.failWith) throw this.opts.failWith; return { ok: true, mode: 'mock', detail: 'synthetic series, no network' }; }
  private async run(what: 'spend' | 'performance' | 'coreVitals', r: PullRange): Promise<MetricRow[]> {
    if (this.opts.failWith) throw this.opts.failWith;
    return GEN[this.kind][what]?.(this.kind, r, what) ?? [];
  }
  pullSpend(r: PullRange) { return this.run('spend', r); }
  pullPerformance(r: PullRange) { return this.run('performance', r); }
  pullCoreVitals(r: PullRange) { return this.run('coreVitals', r); }
  /** The mock never sends anything, so there is nothing to push. */
  async pushConversion() { return { accepted: false }; }
}
export const mockFor = (kind: GrowthIntegrationKind, opts?: MockOptions) => new MockGrowthAdapter(kind, opts);
export { PULLS };
