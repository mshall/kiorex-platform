/**
 * Advisory checks of a proposed plan price (pure, no I/O). They WARN and never block: the founder decides. A warning is recorded on the proposal and shown to the approver.
 * Rows come from the product that owns the price (Clinic, Pharmacy or Lab); nothing here knows or invents a number.
 */
export type PriceProduct = 'CLINIC' | 'PHARMACY' | 'LAB';
export type PriceInterval = 'MONTHLY' | 'ANNUAL';
export interface PriceRow { product: PriceProduct; planKey: string; planOrder: number; market: string; interval: PriceInterval; unit: string; amount: string; currency: string; validFrom: Date; validTo: Date | null; cohortKey?: string | null }
export interface PriceCandidate { product: PriceProduct; planKey: string; planOrder: number; market: string; interval: PriceInterval; unit: string; amount: string; currency: string; effectiveFrom: Date }

export const WARNING_CODES = ['ANNUAL_NOT_ABOVE_MONTHLY', 'ANNUAL_ABOVE_TWELVE_MONTHS', 'HIGHER_PLAN_CHEAPER', 'LOWER_PLAN_DEARER', 'BIG_CHANGE', 'ZERO_AMOUNT', 'CURRENCY_CHANGED', 'FREE_EDITION_PRICED'] as const;
export type WarningCode = (typeof WARNING_CODES)[number];
export interface PriceWarning { code: WarningCode; params: Record<string, string | number> }

/** Amount in minor units (two decimals) as an integer; the API validates the format before this runs. */
export const cents = (a: string): number => { const [w, f = ''] = a.trim().split('.'); return Number(w) * 100 + Number((f + '00').slice(0, 2)); };
const fmt = (c: number) => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`;

const inForce = (r: PriceRow, at: Date) => r.validFrom <= at && (!r.validTo || r.validTo > at);
/** The row in force at `at` for one plan, period and unit; when none is yet, the next one scheduled. */
function reference(rows: readonly PriceRow[], at: Date): PriceRow | null {
  const a = rows.find((r) => inForce(r, at));
  if (a) return a;
  return [...rows].filter((r) => r.validFrom > at).sort((x, y) => x.validFrom.getTime() - y.validFrom.getTime())[0] ?? null;
}

export function priceWarnings(c: PriceCandidate, all: readonly PriceRow[]): PriceWarning[] {
  const out: PriceWarning[] = [];
  const amt = cents(c.amount);
  const sameMarket = all.filter((r) => r.product === c.product && r.market === c.market && !r.cohortKey && r.unit === c.unit);
  const segment = (plan: string, interval: PriceInterval) => sameMarket.filter((r) => r.planKey === plan && r.interval === interval);

  if (amt === 0) out.push({ code: 'ZERO_AMOUNT', params: {} });
  if (c.product !== 'CLINIC' && c.planKey === 'LITE') out.push({ code: 'FREE_EDITION_PRICED', params: {} });

  // annual against monthly of the same plan (the annual price is per year: it must be above one month and is normally below twelve)
  const other = reference(segment(c.planKey, c.interval === 'ANNUAL' ? 'MONTHLY' : 'ANNUAL').filter((r) => r.currency === c.currency), c.effectiveFrom);
  if (other) {
    const annual = c.interval === 'ANNUAL' ? amt : cents(other.amount), monthly = c.interval === 'MONTHLY' ? amt : cents(other.amount);
    if (annual <= monthly) out.push({ code: 'ANNUAL_NOT_ABOVE_MONTHLY', params: { annual: fmt(annual), monthly: fmt(monthly), currency: c.currency } });
    else if (annual > monthly * 12) out.push({ code: 'ANNUAL_ABOVE_TWELVE_MONTHS', params: { annual: fmt(annual), monthly: fmt(monthly), currency: c.currency } });
  }

  // plan ladder: a higher plan should not cost less than a lower plan (same period, unit and currency)
  const plans = [...new Set(sameMarket.filter((r) => r.interval === c.interval && r.planKey !== c.planKey && r.currency === c.currency).map((r) => r.planKey))];
  for (const k of plans) {
    const ref = reference(segment(k, c.interval).filter((r) => r.currency === c.currency), c.effectiveFrom);
    if (!ref) continue;
    const theirs = cents(ref.amount);
    if (ref.planOrder < c.planOrder && theirs > amt) out.push({ code: 'HIGHER_PLAN_CHEAPER', params: { plan: c.planKey, other: k, amount: fmt(amt), otherAmount: fmt(theirs), currency: c.currency } });
    if (ref.planOrder > c.planOrder && theirs < amt) out.push({ code: 'LOWER_PLAN_DEARER', params: { plan: c.planKey, other: k, amount: fmt(amt), otherAmount: fmt(theirs), currency: c.currency } });
  }

  // against the version it replaces
  const prev = sameMarket.filter((r) => r.planKey === c.planKey && r.interval === c.interval && inForce(r, c.effectiveFrom))[0];
  if (prev) {
    if (prev.currency !== c.currency) out.push({ code: 'CURRENCY_CHANGED', params: { from: prev.currency, to: c.currency } });
    else {
      const p = cents(prev.amount);
      if (p > 0 && (amt > p * 1.5 || amt < p * 0.5)) out.push({ code: 'BIG_CHANGE', params: { from: fmt(p), to: fmt(amt), percent: Math.round(((amt - p) / p) * 100), currency: c.currency } });
    }
  }
  return out;
}

/** The same checks over what is already published (annual and monthly of every plan), so an inconsistent catalogue is flagged before anyone proposes a change to it. */
export function catalogueWarnings(rows: readonly PriceRow[], at: Date = new Date()): Array<PriceWarning & { product: PriceProduct; planKey: string; market: string; interval: PriceInterval; unit: string }> {
  const out: Array<PriceWarning & { product: PriceProduct; planKey: string; market: string; interval: PriceInterval; unit: string }> = [];
  for (const r of rows.filter((x) => x.interval === 'ANNUAL' && !x.cohortKey && inForce(x, at))) {
    const m = rows.find((x) => x.product === r.product && x.planKey === r.planKey && x.market === r.market && x.unit === r.unit && x.interval === 'MONTHLY' && x.currency === r.currency && !x.cohortKey && inForce(x, at));
    if (!m) continue;
    const a = cents(r.amount), mo = cents(m.amount);
    if (a <= mo) out.push({ code: 'ANNUAL_NOT_ABOVE_MONTHLY', params: { annual: fmt(a), monthly: fmt(mo), currency: r.currency }, product: r.product, planKey: r.planKey, market: r.market, interval: 'ANNUAL', unit: r.unit });
  }
  return out;
}
