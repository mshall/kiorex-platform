import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { marketTimezone } from '../../market/market-core-public';
import { growthError } from '../growth-errors';
import { GrowthConfigService } from '../config/growth-config.service';
import { maskCount, MASK } from '../analytics/kanon';
import { addMonths, buildCohorts, dimensionOf, monthOf, monthsBetween, monthStart, type CohortBasis, type CohortCell, type CohortDimension, type PatientRecord } from './cohort-builder';
import { CohortDataService } from './cohort-data.service';
import { fitLtv } from './ltv-fit';
import { type LtvPatient } from './ltv.model';
import { withLtvDefaults, type LtvPolicy } from './ltv-policy';
import { retentionRows, visitsPerPatient } from './retention';
import { addDays, localDay } from '../campaigns/market-day';

export const LTV_MODEL = 'ltv-v1';
export const BASES: readonly CohortBasis[] = ['FIRST_COMPLETED', 'REGISTRATION'];
const DIMS: readonly CohortDimension[] = ['ALL', 'SOURCE', 'CAMPAIGN', 'PLATFORM'];
const policyTag = (p: LtvPolicy) => createHash('sha256').update(JSON.stringify(Object.keys(p).sort().map((k) => [k, (p as unknown as Record<string, unknown>)[k]]))).digest('hex').slice(0, 8);
export const cohortKey = (basis: CohortBasis, dim: CohortDimension, value: string) => `${basis}|${dim}|${value}`;

/** Builds a person's LTV record: contribution per month index net of reward cost when the policy says so. Exists only in memory. */
export function toLtvPatient(r: PatientRecord, zone: string, asOf: number, includeReward: boolean): LtvPatient | null {
  if (r.acquiredAt === null) return null;
  const cohort = monthOf(r.acquiredAt, zone); const age = monthsBetween(cohort, monthOf(asOf, zone)); if (age < 0) return null;
  const contrib = new Array<number>(age + 1).fill(0);
  for (const v of r.visits) { const i = monthsBetween(cohort, monthOf(v.at, zone)); if (i >= 0 && i <= age) contrib[i]! += v.revenueMinor; }
  if (includeReward) for (const w of r.rewards) { const i = monthsBetween(cohort, monthOf(w.at, zone)); if (i >= 0 && i <= age) contrib[i]! -= w.costMinor; }
  return { age, contrib };
}

/**
 * Cohort analytics and LTV (GRW-P3-C). Reporting only (AD-9): no decision, reward or commission reads anything written here. Storage is aggregate cells and ESTIMATE rows (the
 * database CHECKs enforce k >= 10). The rollup replaces the window it recomputes, so it is idempotent; the queries mask any figure resting on fewer than 10 people.
 */
@Injectable()
export class CohortService {
  constructor(private readonly prisma: PrismaService, private readonly data: CohortDataService, private readonly config: GrowthConfigService) {}

  async policy(market: string): Promise<{ policy: LtvPolicy; version: number | null; source: string; tag: string }> {
    const r = await this.config.resolve<Partial<LtvPolicy>>('LTV_POLICY', { market });
    const policy = withLtvDefaults(r.payload); return { policy, version: r.source === 'ACTIVE' ? r.version : null, source: r.source, tag: policyTag(policy) };
  }

  /** Recomputes the cohort cells of the last `months` months for a basis and, for FIRST_COMPLETED, the LTV estimates. Idempotent. */
  async rollup(i: { market: string; basis?: CohortBasis; months?: number; now?: Date }) {
    const now = i.now ?? new Date(); const months = Math.min(60, Math.max(1, i.months ?? 24)); const zone = marketTimezone(i.market);
    const { policy, tag } = await this.policy(i.market); const out: Record<string, unknown> = { market: i.market, months, estimates: 0 };
    for (const basis of i.basis ? [i.basis] : BASES) {
      const records = await this.data.load(i.market, basis, now, months);
      const cells = buildCohorts(records, { basis, zone, asOf: now.getTime(), k: policy.minCohortPatients });
      const first = monthStart(addMonths(monthOf(now.getTime(), zone), -(months - 1)));
      await this.prisma.$transaction(async (tx) => {
        await tx.growthCohortMonthly.deleteMany({ where: { market: i.market, cohortBasis: basis, cohortMonth: { gte: new Date(`${first}T00:00:00Z`) } } });
        for (let o = 0; o < cells.length; o += 2000) await tx.growthCohortMonthly.createMany({ data: cells.slice(o, o + 2000).map((c) => ({ market: i.market, cohortMonth: new Date(`${c.cohortMonth}T00:00:00Z`), cohortBasis: c.basis, sourceKind: c.sourceKind, campaignId: c.campaignId, platform: c.platform, monthIndex: c.monthIndex, patients: c.patients, retainedPatients: c.retainedPatients, completedBookings: c.completedBookings, revenueMinor: BigInt(c.revenueMinor), rewardCostMinor: BigInt(c.rewardCostMinor), k: c.k, suppressed: c.suppressed })) });
      }, { timeout: 120_000 });
      out[`cells_${basis}`] = cells.length;
      if (basis === 'FIRST_COMPLETED') out.estimates = await this.estimate(i.market, records, zone, now, policy, tag);
    }
    return out;
  }

  private async estimate(market: string, records: PatientRecord[], zone: string, now: Date, policy: LtvPolicy, tag: string): Promise<number> {
    const groups = new Map<string, { dim: CohortDimension; value: string; list: LtvPatient[] }>();
    const add = (dim: CohortDimension, value: string, p: LtvPatient) => { const k = cohortKey('FIRST_COMPLETED', dim, value); const g = groups.get(k) ?? { dim, value, list: [] }; g.list.push(p); groups.set(k, g); };
    for (const r of records) {
      const p = toLtvPatient(r, zone, now.getTime(), policy.includeRewardCost); if (!p) continue;
      add('ALL', '', p); add('SOURCE', r.sourceKind, p); if (r.campaignId) add('CAMPAIGN', r.campaignId, p); if (r.platform) add('PLATFORM', r.platform, p);
    }
    let n = 0; const keep = new Set<string>();
    for (const [key, g] of groups) {
      const f = fitLtv(g.list, policy, key); if (!f) continue;
      keep.add(key); n++;
      const data = { estimateMinor: BigInt(f.estimateMinor), lowMinor: BigInt(f.lowMinor), highMinor: BigInt(f.highMinor), n: f.n, computedAt: now, label: 'ESTIMATE' };
      await this.prisma.growthLtvEstimate.upsert({ where: { market_cohortKey_horizonMonths_modelVersion: { market, cohortKey: key, horizonMonths: policy.horizonMonths, modelVersion: `${LTV_MODEL}+${tag}` } }, create: { market, cohortKey: key, horizonMonths: policy.horizonMonths, modelVersion: `${LTV_MODEL}+${tag}`, ...data }, update: data });
    }
    // a group that fell below the floor since the last run must not keep showing an old estimate
    await this.prisma.growthLtvEstimate.deleteMany({ where: { market, modelVersion: `${LTV_MODEL}+${tag}`, cohortKey: { startsWith: 'FIRST_COMPLETED|' }, NOT: { cohortKey: { in: [...keep] } } } });
    return n;
  }

  private cells(rows: Awaited<ReturnType<PrismaService['growthCohortMonthly']['findMany']>>): CohortCell[] {
    return rows.map((r) => ({ cohortMonth: r.cohortMonth.toISOString().slice(0, 10), basis: r.cohortBasis as CohortBasis, sourceKind: r.sourceKind, campaignId: r.campaignId, platform: r.platform, monthIndex: r.monthIndex, patients: r.patients, retainedPatients: r.retainedPatients, completedBookings: r.completedBookings, revenueMinor: Number(r.revenueMinor), rewardCostMinor: Number(r.rewardCostMinor), k: r.k, suppressed: r.suppressed }));
  }
  private async load(market: string, basis: CohortBasis, dimension: CohortDimension, value: string): Promise<CohortCell[]> {
    const where = { market, cohortBasis: basis, sourceKind: dimension === 'SOURCE' ? value : '', campaignId: dimension === 'CAMPAIGN' ? value : '', platform: dimension === 'PLATFORM' ? value : '' };
    return this.cells(await this.prisma.growthCohortMonthly.findMany({ where, orderBy: [{ cohortMonth: 'asc' }, { monthIndex: 'asc' }] }));
  }
  /** The values a dimension has stored cells for (suppressed cells show the value but never a count). */
  async values(market: string, basis: CohortBasis, dimension: Exclude<CohortDimension, 'ALL'>): Promise<string[]> {
    const col = dimension === 'SOURCE' ? 'sourceKind' : dimension === 'CAMPAIGN' ? 'campaignId' : 'platform';
    const rows = await this.prisma.growthCohortMonthly.findMany({ where: { market, cohortBasis: basis, [col]: { not: '' }, suppressed: false }, distinct: [col], select: { sourceKind: true, campaignId: true, platform: true } });
    return rows.map((r) => r[col as 'sourceKind']).sort();
  }

  /** Cohort table: one row per cohort month with its size and the masked retained counts, revenue and reward cost. */
  async table(q: { market: string; basis?: CohortBasis; dimension?: CohortDimension; value?: string }) {
    const basis = q.basis ?? 'FIRST_COMPLETED'; const dimension = q.dimension ?? 'ALL';
    if (!BASES.includes(basis) || !DIMS.includes(dimension)) throw growthError('GROWTH_INVALID_REQUEST', 'Unknown basis or dimension');
    if (dimension !== 'ALL' && !q.value) throw growthError('GROWTH_INVALID_REQUEST', 'A dimension needs a value');
    const cells = await this.load(q.market, basis, dimension, dimension === 'ALL' ? '' : (q.value ?? ''));
    const byMonth = new Map<string, CohortCell[]>(); for (const c of cells) byMonth.set(c.cohortMonth, [...(byMonth.get(c.cohortMonth) ?? []), c]);
    const rows = [...byMonth.entries()].map(([cohortMonth, list]) => {
      if (list.every((c) => c.suppressed)) return { cohortMonth, suppressed: true as const, patients: MASK, months: [] };
      const live = list.filter((c) => !c.suppressed); const patients = live[0]!.patients;
      return { cohortMonth, suppressed: false as const, patients, months: live.map((c) => { const small = maskCount(c.retainedPatients) === MASK; return { monthIndex: c.monthIndex, retained: maskCount(c.retainedPatients), completedBookings: small ? MASK : c.completedBookings, revenueMinor: small ? MASK : c.revenueMinor, rewardCostMinor: small ? MASK : c.rewardCostMinor }; }) };
    });
    return { market: q.market, basis, dimension, value: dimension === 'ALL' ? null : q.value, k: 10, rows, visitsPerPatientM3: visitsPerPatient(cells, 3), note: 'Cells with fewer than 10 people show "fewer than 10"; no per-person data exists.' };
  }

  async retention(q: { market: string; basis?: CohortBasis; dimension?: CohortDimension; value?: string }) {
    const basis = q.basis ?? 'FIRST_COMPLETED'; const dimension = q.dimension ?? 'ALL';
    const cells = await this.load(q.market, basis, dimension, dimension === 'ALL' ? '' : (q.value ?? ''));
    return { market: q.market, basis, dimension, value: dimension === 'ALL' ? null : q.value, rows: retentionRows(cells), k: 10 };
  }

  /** LTV estimates with intervals; each row says n, horizon, model version and that it is an ESTIMATE. */
  async ltv(q: { market: string; basis?: CohortBasis }) {
    const { policy, tag, version, source } = await this.policy(q.market);
    const rows = await this.prisma.growthLtvEstimate.findMany({ where: { market: q.market, modelVersion: `${LTV_MODEL}+${tag}`, cohortKey: { startsWith: `${q.basis ?? 'FIRST_COMPLETED'}|` } }, orderBy: { cohortKey: 'asc' } });
    return {
      market: q.market, label: 'ESTIMATE' as const, modelVersion: `${LTV_MODEL}+${tag}`, policy: { version, source, horizonMonths: policy.horizonMonths, discountRateBp: policy.discountRateBp, includeRewardCost: policy.includeRewardCost, intervalPercent: policy.intervalPercent, resamples: policy.bootstrapResamples },
      rows: rows.map((r) => { const [, dimension, value] = r.cohortKey.split('|') as [string, CohortDimension, string]; return { dimension, value: value || null, horizonMonths: r.horizonMonths, estimateMinor: Number(r.estimateMinor), lowMinor: Number(r.lowMinor), highMinor: Number(r.highMinor), n: r.n, label: r.label, computedAt: r.computedAt.toISOString() }; }),
      method: 'Observed cumulative contribution per acquired patient, projected with a geometric tail for months not yet observed, bootstrap interval over patients (seeded). Model risk is not in the interval. No per-person value exists.',
    };
  }

  /** Blended CAC per cohort month (approved spend of the month over patients acquired) and payback and LTV:CAC against the pooled estimate. Absent spend is said plainly. */
  async payback(q: { market: string; now?: Date; months?: number }) {
    const now = q.now ?? new Date(); const zone = marketTimezone(q.market); const months = Math.min(36, Math.max(1, q.months ?? 12));
    const { policy, tag } = await this.policy(q.market);
    const cells = await this.load(q.market, 'FIRST_COMPLETED', 'ALL', '');
    const est = await this.prisma.growthLtvEstimate.findUnique({ where: { market_cohortKey_horizonMonths_modelVersion: { market: q.market, cohortKey: cohortKey('FIRST_COMPLETED', 'ALL', ''), horizonMonths: policy.horizonMonths, modelVersion: `${LTV_MODEL}+${tag}` } } });
    const byMonth = new Map<string, CohortCell[]>(); for (const c of cells) byMonth.set(c.cohortMonth, [...(byMonth.get(c.cohortMonth) ?? []), c]);
    const rows = [];
    for (const [cohortMonth, list] of [...byMonth.entries()].sort().slice(-months)) {
      const live = list.filter((c) => !c.suppressed); if (!live.length) { rows.push({ cohortMonth, suppressed: true as const }); continue; }
      const patients = live[0]!.patients; const ym = cohortMonth.slice(0, 7);
      const from = new Date(`${ym}-01T00:00:00Z`); const to = new Date(`${addMonths(ym, 1)}-01T00:00:00Z`);
      const spend = await this.prisma.growthSpendEntry.aggregate({ where: { market: q.market, status: 'APPROVED', day: { gte: from, lt: to } }, _sum: { amountMinor: true } });
      const spendMinor = spend._sum.amountMinor ?? 0; const cac = spendMinor > 0 ? Math.round(spendMinor / patients) : null;
      let cum = 0; let payback: number | null = null; const curve: number[] = [];
      for (const c of live) { cum += (c.revenueMinor - (policy.includeRewardCost ? c.rewardCostMinor : 0)) / patients; curve.push(Math.round(cum)); if (payback === null && cac !== null && cum >= cac) payback = c.monthIndex; }
      rows.push({ cohortMonth, suppressed: false as const, patients, spendMinor: spendMinor || null, cacMinor: cac, paybackMonth: payback, observedMonths: live.length, cumulativePerPatientMinor: curve });
    }
    const spendTotal = rows.reduce((s, r) => s + (('spendMinor' in r && r.spendMinor) || 0), 0); const patientTotal = rows.reduce((s, r) => s + (('patients' in r && typeof r.patients === 'number') ? r.patients : 0), 0);
    const blended = spendTotal > 0 && patientTotal >= 10 ? Math.round(spendTotal / patientTotal) : null;
    const ratio = est && blended ? { estimate: round2(Number(est.estimateMinor) / blended), low: round2(Number(est.lowMinor) / blended), high: round2(Number(est.highMinor) / blended), n: est.n, label: 'ESTIMATE' as const } : null;
    return { market: q.market, rows, blendedCacMinor: blended, ltvToCac: ratio, note: blended === null ? 'No approved spend (or fewer than 10 acquired patients): CAC and LTV:CAC are not shown. Spend is entered in Growth finance.' : 'CAC is blended: approved spend of the cohort month over patients acquired in it. LTV carries its interval; the CAC is a single figure.', horizonMonths: policy.horizonMonths, zoneDay: localDay(now, zone), since: addDays(localDay(now, zone), -30) };
  }

  /** Independent recount from the same sources: acquired patients and revenue per cohort month must equal the stored (unsuppressed) cells. */
  async reconcile(market: string, now = new Date(), months = 24) {
    const zone = marketTimezone(market); const stored = await this.load(market, 'FIRST_COMPLETED', 'ALL', '');
    const records = await this.data.load(market, 'FIRST_COMPLETED', now, months);
    const live = stored.filter((c) => !c.suppressed && c.monthIndex === 0); const patients = live.reduce((s, c) => s + c.patients, 0);
    const recount = new Map<string, number>(); for (const r of records) if (r.acquiredAt !== null) { const m = `${monthOf(r.acquiredAt, zone)}-01`; recount.set(m, (recount.get(m) ?? 0) + 1); }
    const expected = [...recount.entries()].filter(([, n]) => n >= 10).reduce((s, [, n]) => s + n, 0);
    const revenueStored = stored.filter((c) => !c.suppressed).reduce((s, c) => s + c.revenueMinor, 0);
    const shown = new Set(live.map((c) => c.cohortMonth.slice(0, 7))); let revenueRecount = 0;
    for (const r of records) { if (r.acquiredAt === null || !shown.has(monthOf(r.acquiredAt, zone))) continue; for (const v of r.visits) revenueRecount += v.revenueMinor; }
    return { ok: patients === expected && revenueStored === revenueRecount, patientsStored: patients, patientsRecount: expected, revenueStoredMinor: revenueStored, revenueRecountMinor: revenueRecount };
  }
}
const round2 = (n: number) => Math.round(n * 100) / 100;
