import type { CohortCell } from './cohort-builder';
import { maskCount, MASK, type Masked } from '../analytics/kanon';

/** Retention curves and the heatmap from stored aggregate cells (GRW-P3-C). PURE. A cell with fewer than 10 retained patients shows "<10" and no figure derived from it. */
export interface RetentionRow { cohortMonth: string; patients: number | typeof MASK; suppressed: boolean; cells: { monthIndex: number; retained: Masked; rate: number | typeof MASK | null }[] }
export function retentionRows(cells: readonly CohortCell[]): RetentionRow[] {
  const by = new Map<string, CohortCell[]>();
  for (const c of cells) { const l = by.get(c.cohortMonth) ?? []; l.push(c); by.set(c.cohortMonth, l); }
  return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([cohortMonth, list]) => {
    if (list.every((c) => c.suppressed)) return { cohortMonth, patients: MASK, suppressed: true, cells: [] };
    const sorted = list.filter((c) => !c.suppressed).sort((a, b) => a.monthIndex - b.monthIndex); const patients = sorted[0]?.patients ?? 0;
    return { cohortMonth, patients, suppressed: false, cells: sorted.map((c) => { const r = maskCount(c.retainedPatients); return { monthIndex: c.monthIndex, retained: r, rate: r === MASK ? MASK : patients > 0 ? Math.round((c.retainedPatients / patients) * 1000) / 10 : null }; }) };
  });
}
/** Cumulative completed bookings per acquired patient to the given month (a repeat-visit proxy; the share of patients with a second visit needs person-level data and is not stored). */
export function visitsPerPatient(cells: readonly CohortCell[], upToMonth: number): number | null {
  const by = new Map<string, CohortCell[]>();
  for (const c of cells) if (!c.suppressed) { const l = by.get(c.cohortMonth) ?? []; l.push(c); by.set(c.cohortMonth, l); }
  let patients = 0; let bookings = 0;
  for (const list of by.values()) { if (!list.some((c) => c.monthIndex === upToMonth)) continue; patients += list[0]!.patients; bookings += list.filter((c) => c.monthIndex <= upToMonth).reduce((s, c) => s + c.completedBookings, 0); } // only cohorts old enough
  return patients < 10 ? null : Math.round((bookings / patients) * 100) / 100;
}
