import { Injectable } from '@nestjs/common';
import { Prisma } from '../../prisma/generated/client';
import { revenueBasisReport } from './revenue.service';
import { PrismaService } from '../../prisma/prisma.service';
import { GROWTH_DEFAULT_MARKET } from '../growth-flags';
import { growthError } from '../growth-errors';
import { blendedCac, bookingToAttended, campaignVerdict, ltvMinor, ltvToCac, mer, pct, providerLedShare, ratio, roas, searchToBooking } from './formulas';
import { applyKAnonymity, K_MIN, MASK, maskTotal, type Masked } from './kanon';
import { VISITOR_STREAM_METRICS } from './rollup.service';

export const FILTER_KEYS = ['country', 'city', 'district', 'specialty', 'provider', 'doctor', 'branch', 'campaign', 'channel', 'careType', 'platform', 'sourceKind', 'origin'] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];
export interface GrowthFilters { from: string; to: string; market?: string; city?: string; district?: string; specialty?: string; provider?: string; doctor?: string; branch?: string; campaign?: string; channel?: string; careType?: string; platform?: string; sourceKind?: string; origin?: string }
/** OPS sees everything; PROVIDER is locked to one organisation and never sees Kiorex's own money (revenue, spend, CAC, MER, ROAS, GBV of other parties). */
export type Audience = { kind: 'OPS' } | { kind: 'PROVIDER'; orgId: string };

const DIM_COLUMN: Record<Exclude<FilterKey, 'country'>, string> = { city: 'city', district: 'district', specialty: 'specialty', provider: 'providerRef', doctor: 'doctorRef', branch: 'branchRef', campaign: 'campaign', channel: 'channel', careType: 'careType', platform: 'platform', sourceKind: 'sourceKind', origin: 'origin' };
/** Filters that only booking-stage rows carry: the anonymous visitor stream has no place, specialty or provider (KX-32 section 06), so these filters hide visitor stages. */
const BOOKING_ONLY_FILTERS: FilterKey[] = ['city', 'district', 'specialty', 'provider', 'doctor', 'branch', 'origin', 'channel'];
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID_LIKE = /^[A-Za-z0-9 _.:-]{1,64}$/u;

export function parseFilters(q: Record<string, unknown>, now = new Date()): GrowthFilters {
  const to = typeof q.to === 'string' && ISO_DAY.test(q.to) ? q.to : now.toISOString().slice(0, 10);
  const from = typeof q.from === 'string' && ISO_DAY.test(q.from) ? q.from : new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
  if (from > to) throw growthError('GROWTH_INVALID_REQUEST', 'from must not be after to');
  if (Date.parse(to) - Date.parse(from) > 366 * 86_400_000) throw growthError('GROWTH_INVALID_REQUEST', 'a report covers at most 366 days');
  const f: GrowthFilters = { from, to };
  for (const k of FILTER_KEYS) {
    const v = q[k];
    if (v === undefined || v === '') continue;
    if (typeof v !== 'string' || !ID_LIKE.test(v)) throw growthError('GROWTH_INVALID_REQUEST', `${k} is not a valid filter value`);
    if (k === 'country') f.market = v.toUpperCase(); else (f as unknown as Record<string, string>)[k] = v;
  }
  return f;
}

type Sums = Map<string, number>;
const num = (v: number | null | undefined) => v ?? 0;

/**
 * Read side of growth analytics v1: funnel, channels, acquisition mix, cohorts and unit economics from `GrowthMetricDaily` and the approved spend entries.
 * EVERY figure leaves through `k-anonymity` (k >= 10): counts below 10 are "<10", money and ratios resting on them are "<10", one hidden cell hides its smallest sibling.
 * Definitions are KX-32 section 04: GBV is a volume indicator (key `grossBookingValueMinor`, `isRevenue: false`); revenue is commission charges net of reversals only;
 * promotional credits, taxes and provider settlements are not in the data at all.
 */
@Injectable()
export class GrowthMetricsService {
  constructor(private readonly prisma: PrismaService) {}

  private where(f: GrowthFilters, a: Audience, metrics?: readonly string[]): Prisma.GrowthMetricDailyWhereInput {
    const w: Prisma.GrowthMetricDailyWhereInput = { market: f.market ?? GROWTH_DEFAULT_MARKET, day: { gte: new Date(`${f.from}T00:00:00Z`), lte: new Date(`${f.to}T00:00:00Z`) } };
    if (metrics) w.metric = { in: [...metrics] };
    for (const [k, col] of Object.entries(DIM_COLUMN)) { const v = (f as unknown as Record<string, string | undefined>)[k]; if (v) (w as Record<string, unknown>)[col] = v; }
    if (a.kind === 'PROVIDER') w.providerRef = a.orgId; // tenant isolation is a WHERE, not a post-filter; visitor-stream rows have providerRef '' so they never match
    return w;
  }
  private bookingOnly(f: GrowthFilters, a: Audience) { return a.kind === 'PROVIDER' || BOOKING_ONLY_FILTERS.some((k) => (f as unknown as Record<string, string | undefined>)[k]); }

  private async sums(f: GrowthFilters, a: Audience, metrics: readonly string[], by: string[] = []): Promise<Array<{ key: Record<string, string>; sums: Sums }>> {
    const rows = await (this.prisma.growthMetricDaily.groupBy as (args: unknown) => Promise<unknown>)({ by: ['metric', ...by], where: this.where(f, a, metrics), _sum: { value: true } }) as Array<Record<string, unknown> & { _sum: { value: number | null } }>;
    const m = new Map<string, { key: Record<string, string>; sums: Sums }>();
    for (const r of rows) {
      const key = Object.fromEntries(by.map((b) => [b, String(r[b] ?? '')]));
      const id = JSON.stringify(key);
      const e = m.get(id) ?? { key, sums: new Map<string, number>() };
      e.sums.set(String(r.metric), num(r._sum.value)); m.set(id, e);
    }
    return [...m.values()];
  }
  private total = async (f: GrowthFilters, a: Audience, metrics: readonly string[]): Promise<Sums> => (await this.sums(f, a, metrics))[0]?.sums ?? new Map();

  async spend(f: GrowthFilters, a: Audience, by: Array<'campaign' | 'channel' | 'sourceKind'> = []) {
    if (a.kind === 'PROVIDER') return [];
    const rows = await this.prisma.growthSpendEntry.findMany({ where: { market: f.market ?? GROWTH_DEFAULT_MARKET, status: 'APPROVED', day: { gte: new Date(`${f.from}T00:00:00Z`), lte: new Date(`${f.to}T00:00:00Z`) }, ...(f.campaign ? { campaign: f.campaign } : {}), ...(f.channel ? { channel: f.channel } : {}), ...(f.sourceKind ? { sourceKind: f.sourceKind } : {}) } });
    const m = new Map<string, { key: Record<string, string>; amountMinor: number }>();
    for (const r of rows) { const key = Object.fromEntries(by.map((b) => [b, r[b]])); const id = JSON.stringify(key); const e = m.get(id) ?? { key, amountMinor: 0 }; e.amountMinor += r.amountMinor; m.set(id, e); }
    return [...m.values()];
  }
  private async spendTotal(f: GrowthFilters, a: Audience) { return (await this.spend(f, a)).reduce((s, r) => s + r.amountMinor, 0); }

  async freshness() {
    const m = await this.prisma.growthMetricDaily.aggregate({ _max: { updatedAt: true } });
    const e = await this.prisma.growthEvent.aggregate({ _max: { occurredAt: true } });
    return { rolledUpAt: m._max.updatedAt?.toISOString() ?? null, lastEventAt: e._max.occurredAt?.toISOString() ?? null };
  }

  /** G-19: which part of the revenue is confirmed by a Clinic fact and which part still rests on the completion inference (a caveat, never hidden). */
  private async revenueBasis(f: GrowthFilters) {
    const from = new Date(`${f.from}T00:00:00Z`); const to = new Date(new Date(`${f.to}T00:00:00Z`).getTime() + 86_400_000);
    return revenueBasisReport(this.prisma, f.market ?? GROWTH_DEFAULT_MARKET, from, to);
  }

  /** Executive overview: the tiles of KX-32 section 04 for the period and filters. */
  async overview(f: GrowthFilters, a: Audience) {
    const s = await this.total(f, a, ['BookingConfirmed', 'BookingAttended', 'AttendedNewPatient', 'SearchStarted', 'GbvMinor', 'RevenueMinor', 'RevenueReversedMinor', 'CommissionPendingMinor']);
    const byOrigin = await this.sums(f, a, ['BookingConfirmed', 'AttendedNewPatient'], ['origin']);
    const get = (name: string) => num(s.get(name));
    const confirmed = get('BookingConfirmed'); const anp = get('AttendedNewPatient');
    const origin = (name: string, o: string) => num(byOrigin.find((r) => r.key.origin === o)?.sums.get(name));
    const led = { providerLed: origin('BookingConfirmed', 'PROVIDER_LED'), marketplace: origin('BookingConfirmed', 'MARKETPLACE'), unattributed: origin('BookingConfirmed', 'UNATTRIBUTED') };
    const feeBearingAnp = origin('AttendedNewPatient', 'MARKETPLACE') + origin('AttendedNewPatient', 'UNATTRIBUTED');
    const own = a.kind === 'OPS';
    const spend = own ? await this.spendTotal(f, a) : 0;
    const revenue = get('RevenueMinor') - get('RevenueReversedMinor');
    const hideVisitor = this.bookingOnly(f, a);
    const searches = hideVisitor ? null : get('SearchStarted');
    const k = (n: number) => n === 0 || n >= K_MIN;
    const m = (count: number, v: number | null): Masked | null => (v === null ? null : count > 0 && count < K_MIN ? MASK : v);
    return {
      period: { from: f.from, to: f.to }, filters: this.shown(f), audience: a.kind, k: K_MIN, freshness: await this.freshness(),
      bookings: maskTotal(confirmed).count,
      attendedNewPatients: maskTotal(anp).count,
      feeBearingNewPatients: maskTotal(feeBearingAnp).count,
      providerLedShare: m(confirmed, pct(led.providerLed, led.providerLed + led.marketplace + led.unattributed)),
      originMix: { providerLed: maskTotal(led.providerLed).count, marketplace: maskTotal(led.marketplace).count, unattributed: maskTotal(led.unattributed).count },
      bookingToAttended: m(confirmed, pct(get('BookingAttended'), confirmed)),
      searchToBooking: searches === null ? null : m(searches, pct(confirmed, searches)),
      ...(own ? {
        // GBV is the sum of visit fees of confirmed bookings: a volume indicator. It is never revenue and carries isRevenue:false so no consumer can mistake it.
        grossBookingValueMinor: m(confirmed, get('GbvMinor')), grossBookingValue: { isRevenue: false, note: 'Visit fees of confirmed bookings: a volume indicator, never Kiorex revenue' },
        kiorexRevenueMinor: m(anp, revenue), commissionPendingMinor: m(anp, get('CommissionPendingMinor')), revenueNote: 'Commission charges (CONFIRMED or BILLED) net of reversals. Excludes deposits, promotional credits, taxes and provider settlements.',
        revenueBasis: await this.revenueBasis(f),
        spendMinor: spend, blendedCacMinor: m(anp, blendedCac(spend, anp)), merRatio: m(anp, mer(revenue, spend)), ltvMinor: ltvMinor(4000, 0.04),
      } : {}),
      coverage: { visitorStageAvailable: !hideVisitor, note: hideVisitor ? 'Place, specialty, provider and origin filters apply to booking stages only: the anonymous visitor stream has none of them.' : undefined },
      masked: ![confirmed, anp].every(k),
    };
  }

  /** The canonical funnel: 8 stages with step and cumulative conversion; cells under k are masked, conversion likewise. */
  async funnel(f: GrowthFilters, a: Audience) {
    const hideVisitor = this.bookingOnly(f, a);
    const stages = [...(hideVisitor ? [] : ['PageViewed', 'SearchStarted', 'ResultsViewed', 'ProviderViewed']), 'SlotSelected', 'BookingInitiated', 'BookingConfirmed', 'BookingAttended'] as const;
    const s = await this.total(f, a, stages);
    const counts = stages.map((st) => num(s.get(st)));
    const cells = applyKAnonymity(stages.map((st, i) => ({ key: st, count: counts[i]! })), { totalShown: false });
    return {
      period: { from: f.from, to: f.to }, filters: this.shown(f), audience: a.kind, k: K_MIN, freshness: await this.freshness(),
      stages: stages.map((st, i) => {
        const c = cells[i]!; const prev = i > 0 ? counts[i - 1]! : null; const prevMasked = i > 0 ? cells[i - 1]!.masked : false;
        const visitor = (VISITOR_STREAM_METRICS as readonly string[]).includes(st);
        return { stage: st, count: c.count, masked: c.masked, kind: visitor ? 'VISITOR_STREAM' : 'BOOKING_FACT', stepConversionPct: c.masked || prevMasked || prev === null ? (prev === null ? null : MASK) : pct(counts[i]!, prev), cumulativeConversionPct: i === 0 || c.masked || cells[0]!.masked ? (i === 0 ? null : MASK) : pct(counts[i]!, counts[0]!) };
      }),
      coverage: { visitorStageAvailable: !hideVisitor },
    };
  }

  /** Channel table: by source kind (and optionally campaign), with spend, CAC, ROAS, LTV to CAC and the KX-32 section 09 verdict. */
  async channels(f: GrowthFilters, a: Audience, by: Array<'sourceKind' | 'campaign'> = ['sourceKind']) {
    const rows = await this.sums(f, a, ['BookingConfirmed', 'AttendedNewPatient', 'RevenueMinor', 'RevenueReversedMinor'], by);
    const own = a.kind === 'OPS';
    const spend = own ? await this.spend(f, a, by.filter((b): b is 'campaign' | 'sourceKind' => b === 'campaign' || b === 'sourceKind')) : [];
    const keyOf = (k: Record<string, string>) => by.map((b) => k[b] ?? '').join('|') || 'ALL';
    const spendOf = (k: Record<string, string>) => spend.find((r) => by.every((b) => (r.key[b] ?? '') === (k[b] ?? '')))?.amountMinor ?? 0;
    const known = new Set(rows.map((r) => keyOf(r.key)));
    const orphan = spend.filter((sp) => !known.has(keyOf(sp.key as Record<string, string>))).map((sp) => ({ key: sp.key as Record<string, string>, sums: new Map<string, number>() }));
    const all = [...rows, ...orphan].sort((x, y) => num(y.sums.get('BookingConfirmed')) - num(x.sums.get('BookingConfirmed')) || (keyOf(x.key) < keyOf(y.key) ? -1 : 1));
    const cells = applyKAnonymity(all.map((r) => ({ key: keyOf(r.key), count: num(r.sums.get('BookingConfirmed')) })));
    const anpCells = applyKAnonymity(all.map((r) => ({ key: keyOf(r.key), count: num(r.sums.get('AttendedNewPatient')) })), { totalShown: false });
    return {
      period: { from: f.from, to: f.to }, filters: this.shown(f), audience: a.kind, k: K_MIN, freshness: await this.freshness(),
      rows: all.map((r, i) => {
        const bookings = cells[i]!; const anpC = anpCells[i]!; const anp = num(r.sums.get('AttendedNewPatient')); const sp = spendOf(r.key);
        const revenue = num(r.sums.get('RevenueMinor')) - num(r.sums.get('RevenueReversedMinor'));
        const hide = bookings.masked || anpC.masked;
        const cac = blendedCac(sp, anp); const lc = ltvToCac(ltvMinor(4000, 0.04), cac);
        return {
          ...r.key, bookings: bookings.count, attendedNewPatients: anpC.count,
          ...(own ? { spendMinor: sp, revenueMinor: anpC.masked ? MASK : revenue, cacMinor: anpC.masked ? MASK : cac, roas: anpC.masked ? MASK : roas(revenue, sp), ltvToCac: anpC.masked ? MASK : lc, verdict: anpC.masked ? MASK : campaignVerdict(lc) } : {}),
          masked: hide,
        };
      }),
    };
  }

  /** Breakdown by any dimension (city, district, specialty, provider, doctor, branch, campaign, channel, platform, careType): bookings, attended new patients, provider-led share. */
  async breakdown(f: GrowthFilters, a: Audience, dim: Exclude<FilterKey, 'country'>) {
    const col = DIM_COLUMN[dim];
    const sums = await this.sums(f, a, ['BookingConfirmed', 'AttendedNewPatient'], [col, 'origin']);
    const dims = new Map<string, { bookings: number; anp: number; led: number }>();
    for (const r of sums) { const k = r.key[col] ?? ''; const e = dims.get(k) ?? { bookings: 0, anp: 0, led: 0 }; const b = num(r.sums.get('BookingConfirmed')); e.bookings += b; e.anp += num(r.sums.get('AttendedNewPatient')); if (r.key.origin === 'PROVIDER_LED') e.led += b; dims.set(k, e); }
    const list = [...dims.entries()].filter(([k]) => k !== '').sort((x, y) => y[1].bookings - x[1].bookings || (x[0] < y[0] ? -1 : 1));
    const cells = applyKAnonymity(list.map(([k, v]) => ({ key: k, count: v.bookings })));
    return { dimension: dim, period: { from: f.from, to: f.to }, k: K_MIN, rows: list.map(([k, v], i) => ({ [dim]: k, bookings: cells[i]!.count, attendedNewPatients: cells[i]!.masked ? MASK : maskTotal(v.anp).count, providerLedSharePct: cells[i]!.masked ? MASK : pct(v.led, v.bookings), masked: cells[i]!.masked })) };
  }

  /** Retention by first-booking month (acquisition cohort, KX-32 section 07): share who book again within 30, 90 and 180 days. A window is shown only when it is CLOSED for the whole cohort; cohorts under k are "<10". */
  async cohorts(f: Pick<GrowthFilters, 'market' | 'origin'> & { months?: number }, a: Audience, now = new Date()) {
    const months = Math.min(Math.max(f.months ?? 12, 1), 24);
    const counted = ['PENDING_CLINIC', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW'];
    const org = a.kind === 'PROVIDER' ? a.orgId : null;
    const rows = await this.prisma.$queryRaw<Array<{ cohort: string; size: number; r30: number; r90: number; r180: number }>>(Prisma.sql`
      WITH first AS (
        SELECT DISTINCT ON (b."sub") b."sub" AS sub, b."createdAt" AS first_at, COALESCE(b."acquisitionOrigin", 'UNATTRIBUTED') AS origin, b."tenantId" AS tenant
        FROM "BookingIntent" b WHERE b."dependantId" IS NULL AND b."status" = ANY(${counted})
        ORDER BY b."sub", b."createdAt", b."id")
      SELECT to_char(date_trunc('month', f.first_at), 'YYYY-MM') AS cohort, count(*)::int AS size,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "BookingIntent" r WHERE r."sub" = f.sub AND r."dependantId" IS NULL AND r."status" = ANY(${counted}) AND r."createdAt" > f.first_at AND r."createdAt" <= f.first_at + interval '30 days'))::int AS r30,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "BookingIntent" r WHERE r."sub" = f.sub AND r."dependantId" IS NULL AND r."status" = ANY(${counted}) AND r."createdAt" > f.first_at AND r."createdAt" <= f.first_at + interval '90 days'))::int AS r90,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "BookingIntent" r WHERE r."sub" = f.sub AND r."dependantId" IS NULL AND r."status" = ANY(${counted}) AND r."createdAt" > f.first_at AND r."createdAt" <= f.first_at + interval '180 days'))::int AS r180
      FROM first f WHERE f.first_at >= date_trunc('month', ${now}::timestamptz) - (${months}::int * interval '1 month')
        ${f.origin ? Prisma.sql`AND f.origin = ${f.origin}` : Prisma.empty} ${org ? Prisma.sql`AND f.tenant = ${org}` : Prisma.empty}
      GROUP BY 1 ORDER BY 1`);
    const cells = applyKAnonymity(rows.map((r) => ({ key: r.cohort, count: r.size })), { totalShown: false });
    return {
      method: 'ACQUISITION_COHORT_FIRST_BOOKING_MONTH', k: K_MIN, observation: 'A window is shown only once it is closed for the whole cohort; retention is a product measure and earns no fee by itself.',
      rows: rows.map((r, i) => {
        const monthEnd = new Date(Date.UTC(Number(r.cohort.slice(0, 4)), Number(r.cohort.slice(5)), 1)); // first instant after the cohort month
        const closed = (d: number) => now.getTime() >= monthEnd.getTime() + d * 86_400_000;
        const c = cells[i]!;
        const show = (n: number, d: number): Masked | null => (c.masked ? MASK : !closed(d) ? null : pct(n, r.size));
        return { cohort: r.cohort, size: c.count, masked: c.masked, retention30Pct: show(r.r30, 30), retention90Pct: show(r.r90, 90), retention180Pct: show(r.r180, 180) };
      }),
    };
  }

  /** LTV and repeat for the period: LTV is the KX-32 fee-based figure (a repeat visit at the same network earns no fee). */
  unitEconomics() { return { feeMinor: 4000, disputeRate: 0.04, ltvMinor: ltvMinor(4000, 0.04), payMarginMinor: 0, note: 'PROPOSED_DEFAULT inputs (ADR-007 EGP 40, 4 percent dispute rate); LTV = f x (1 - r) + Pay margin (not modelled)' }; }

  private shown(f: GrowthFilters) { const o: Record<string, string> = {}; for (const k of [...FILTER_KEYS]) { const v = k === 'country' ? f.market : (f as unknown as Record<string, string | undefined>)[k]; if (v) o[k] = v; } return o; }
}
void ratio; void providerLedShare; void bookingToAttended; void searchToBooking;
