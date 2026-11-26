import { cfg } from '../common/config';

/**
 * COM-3 / 12.B: the values that used to be literals in the commission code, now read from the environment with the SAME defaults (nothing changes until a deployer sets one).
 * Every value is clamped to a sane range so a typo can neither disable a safeguard nor create a nonsense limit. Read at call time (tests may override process.env).
 */
const int = (name: string, def: number, min: number, max: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : def;
};

/** Dunning and settings bounds (upper limits of what a settings or rate form may state). Defaults: retry day 60, at most 6 retries, grace 30, invoice due 90. */
export const dunningBounds = () => ({
  retryDayMax: int('COMMISSION_RETRY_DAY_MAX', 60, 1, 365),
  retryMaxCount: int('COMMISSION_RETRY_MAX_COUNT', 6, 1, 12),
  graceDaysMax: int('COMMISSION_GRACE_DAYS_MAX', 30, 0, 365),
  invoiceDueDaysMax: int('COMMISSION_INVOICE_DUE_DAYS_MAX', 90, 1, 365),
});

/** Tick of the commission jobs (collection run, pending attempts, view sync). Default 15 minutes; 1 minute .. 24 hours. */
export const commissionJobIntervalMs = (): number => { const v = cfg().commissionJobIntervalMs; return Number.isFinite(v) && v >= 60_000 && v <= 86_400_000 ? Math.floor(v) : 15 * 60_000; };

/** Notice before a money policy takes effect, in days. Default 7 (counsel decides, 13.15); 1..90. */
export const moneyPolicyNoticeDays = (): number => { const v = cfg().moneyPolicyNoticeDays; return Number.isInteger(v) && v >= 1 && v <= 90 ? v : 7; };
export const moneyPolicyLeadMs = (): number => moneyPolicyNoticeDays() * 86_400_000;

/** Aging bucket edges in days past due (COMMISSION_AGING_BUCKET_DAYS, three ascending whole days 1..365). Default 30,60,90. */
export const DEFAULT_AGING_EDGES: readonly [number, number, number] = [30, 60, 90];
export function agingEdges(): [number, number, number] {
  const raw = process.env.COMMISSION_AGING_BUCKET_DAYS;
  if (!raw) return [...DEFAULT_AGING_EDGES];
  const p = raw.split(',').map((s) => Number(s.trim()));
  return p.length === 3 && p.every((n, i) => Number.isInteger(n) && n >= 1 && n <= 365 && (i === 0 || n > (p[i - 1] as number))) ? (p as [number, number, number]) : [...DEFAULT_AGING_EDGES];
}
/** Bucket names follow the edges: CURRENT, D1_30, D31_60, D61_90, D90_PLUS with the defaults. */
export function agingBucketNames(e: readonly number[] = agingEdges()): string[] { return ['CURRENT', `D1_${e[0]}`, `D${e[0]! + 1}_${e[1]}`, `D${e[1]! + 1}_${e[2]}`, `D${e[2]}_PLUS`]; }
