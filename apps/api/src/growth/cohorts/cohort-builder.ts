import { applyKAnonymity, type Cell as KCell } from '../analytics/kanon';
import { addDays, localDay } from '../campaigns/market-day';

/**
 * GRW-P3-C cohort builder. PURE: patient facts in, aggregate cells out. A patient fact never leaves this function: the output carries counts and sums only and a cell built
 * from fewer than k people is returned suppressed with every measure zero (the table CHECK says the same). Months are calendar months in the market's time zone.
 */
export type CohortBasis = 'FIRST_COMPLETED' | 'REGISTRATION';
export interface PatientRecord {
  /** Instant of the first completed booking (null for a registered patient who never completed one). */
  acquiredAt: number | null;
  registeredAt?: number | null;
  sourceKind: string;
  campaignId: string;
  platform: string;
  /** The patient's preferred language ('ar' or 'en'); empty = unknown (no language cut for this person). */
  language?: string;
  /** Completed bookings (attended), each with the net Kiorex revenue fact of the booking. */
  visits: { at: number; revenueMinor: number }[];
  /** Reward redemptions funded by the platform marketing budget. */
  rewards: { at: number; costMinor: number }[];
}
export interface CohortCell {
  cohortMonth: string; // YYYY-MM-01
  basis: CohortBasis;
  sourceKind: string; campaignId: string; platform: string; language: string;
  monthIndex: number;
  patients: number; retainedPatients: number; completedBookings: number; revenueMinor: number; rewardCostMinor: number;
  k: number; suppressed: boolean;
}
export type CohortDimension = 'ALL' | 'SOURCE' | 'CAMPAIGN' | 'PLATFORM' | 'LANGUAGE';

export const monthOf = (at: number, zone: string): string => localDay(at, zone).slice(0, 7);
export const monthsBetween = (from: string, to: string): number => (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + (Number(to.slice(5, 7)) - Number(from.slice(5, 7)));
export const addMonths = (ym: string, n: number): string => { const t = Number(ym.slice(0, 4)) * 12 + (Number(ym.slice(5, 7)) - 1) + n; return `${String(Math.floor(t / 12)).padStart(4, '0')}-${String((t % 12) + 1).padStart(2, '0')}`; };
export const monthStart = (ym: string) => `${ym}-01`;

interface Acc { patients: number; byIndex: Map<number, { retained: number; bookings: number; revenue: number; reward: number }> }
const slot = (a: Acc, i: number) => { let s = a.byIndex.get(i); if (!s) { s = { retained: 0, bookings: 0, revenue: 0, reward: 0 }; a.byIndex.set(i, s); } return s; };

export function buildCohorts(patients: readonly PatientRecord[], o: { basis: CohortBasis; zone: string; asOf: number; k?: number }): CohortCell[] {
  const k = Math.max(10, o.k ?? 10); const nowMonth = monthOf(o.asOf, o.zone);
  // (cohortMonth | dimension | value) -> accumulator
  const groups = new Map<string, { cohortMonth: string; dim: CohortDimension; value: string; acc: Acc }>();
  const get = (cohortMonth: string, dim: CohortDimension, value: string) => { const key = `${cohortMonth}|${dim}|${value}`; let g = groups.get(key); if (!g) { g = { cohortMonth, dim, value, acc: { patients: 0, byIndex: new Map() } }; groups.set(key, g); } return g.acc; };
  for (const p of patients) {
    const anchor = o.basis === 'FIRST_COMPLETED' ? p.acquiredAt : (p.registeredAt ?? p.acquiredAt);
    if (anchor === null || anchor === undefined) continue;
    const cohortMonth = monthOf(anchor, o.zone); const age = monthsBetween(cohortMonth, nowMonth); if (age < 0) continue;
    const dims: [CohortDimension, string][] = [['ALL', ''], ['SOURCE', p.sourceKind]];
    if (p.campaignId) dims.push(['CAMPAIGN', p.campaignId]); if (p.platform) dims.push(['PLATFORM', p.platform]); if (p.language) dims.push(['LANGUAGE', p.language]);
    // per-patient month buckets, computed once
    const months = new Map<number, { bookings: number; revenue: number; reward: number }>();
    const at = (i: number) => { let m = months.get(i); if (!m) { m = { bookings: 0, revenue: 0, reward: 0 }; months.set(i, m); } return m; };
    for (const v of p.visits) { const i = monthsBetween(cohortMonth, monthOf(v.at, o.zone)); if (i >= 0 && i <= age) { const m = at(i); m.bookings += 1; m.revenue += v.revenueMinor; } }
    for (const r of p.rewards) { const i = monthsBetween(cohortMonth, monthOf(r.at, o.zone)); if (i >= 0 && i <= age) at(i).reward += r.costMinor; }
    for (const [dim, value] of dims) {
      const acc = get(cohortMonth, dim, value); acc.patients += 1;
      for (let i = 0; i <= age; i++) slot(acc, i); // every observed month exists, also with zero activity
      for (const [i, m] of months) { const s = slot(acc, i); if (m.bookings > 0 || (o.basis === 'FIRST_COMPLETED' && i === 0)) s.retained += 1; s.bookings += m.bookings; s.revenue += m.revenue; s.reward += m.reward; }
    }
  }
  // k-anonymity with secondary suppression inside the partitioning dimension (SOURCE partitions ALL), per cohort month
  const suppressedKey = new Set<string>();
  const byMonth = new Map<string, KCell[]>();
  for (const g of groups.values()) if (g.dim === 'SOURCE') { const l = byMonth.get(g.cohortMonth) ?? []; l.push({ key: g.value, count: g.acc.patients }); byMonth.set(g.cohortMonth, l); }
  for (const [m, cells] of byMonth) for (const c of applyKAnonymity(cells)) if (c.masked) suppressedKey.add(`${m}|SOURCE|${c.key}`);
  // the language cut partitions ALL too (ar plus en): one hidden language also hides the other when the other would reveal it by subtraction
  const byLang = new Map<string, KCell[]>();
  for (const g of groups.values()) if (g.dim === 'LANGUAGE') { const l = byLang.get(g.cohortMonth) ?? []; l.push({ key: g.value, count: g.acc.patients }); byLang.set(g.cohortMonth, l); }
  for (const [m, cells] of byLang) for (const c of applyKAnonymity(cells)) if (c.masked) suppressedKey.add(`${m}|LANGUAGE|${c.key}`);
  const out: CohortCell[] = [];
  for (const g of groups.values()) {
    const key = `${g.cohortMonth}|${g.dim}|${g.value}`;
    const base = { cohortMonth: monthStart(g.cohortMonth), basis: o.basis, sourceKind: g.dim === 'SOURCE' ? g.value : '', campaignId: g.dim === 'CAMPAIGN' ? g.value : '', platform: g.dim === 'PLATFORM' ? g.value : '', language: g.dim === 'LANGUAGE' ? g.value : '', k };
    if (g.acc.patients < k || suppressedKey.has(key)) { out.push({ ...base, monthIndex: 0, patients: 0, retainedPatients: 0, completedBookings: 0, revenueMinor: 0, rewardCostMinor: 0, suppressed: true }); continue; }
    for (const [i, s] of [...g.acc.byIndex].sort((a, b) => a[0] - b[0])) out.push({ ...base, monthIndex: i, patients: g.acc.patients, retainedPatients: s.retained, completedBookings: s.bookings, revenueMinor: s.revenue, rewardCostMinor: s.reward, suppressed: false });
  }
  return out.sort((a, b) => a.cohortMonth.localeCompare(b.cohortMonth) || a.sourceKind.localeCompare(b.sourceKind) || a.campaignId.localeCompare(b.campaignId) || a.platform.localeCompare(b.platform) || a.language.localeCompare(b.language) || a.monthIndex - b.monthIndex);
}
export const dimensionOf = (c: Pick<CohortCell, 'sourceKind' | 'campaignId' | 'platform'> & { language?: string }): CohortDimension => (c.sourceKind ? 'SOURCE' : c.campaignId ? 'CAMPAIGN' : c.platform ? 'PLATFORM' : c.language ? 'LANGUAGE' : 'ALL');
export const lastDayOfMonth = (ym: string) => addDays(`${addMonths(ym, 1)}-01`, -1);
