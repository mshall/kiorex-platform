/**
 * GRW-P3-B reporting attribution models. PURE. Reporting only (AD-9): nothing here can change a commission decision, the money decision stays the deterministic
 * `ATTRIBUTION_POLICY` function in `../attribution/decide.ts`.
 *
 * Arithmetic: a conversion is worth exactly ONE_MILLION parts ("ppm"). Every model returns integer parts that sum to exactly ONE_MILLION for a non-empty path, and
 * revenue is split with `apportion` (largest remainder), so the sum of fractional conversions and of fractional revenue over any set of paths equals the facts
 * exactly: no model loses or invents a conversion or a minor unit of revenue.
 *
 * POSITION_BASED is the default report (documented choice): a booking marketplace funnel has few touches and both the first discovery touch and the last
 * conversion touch matter, so 40 first, 40 last, 20 shared by the middle; with one touch it takes everything, with two it is 50/50.
 */
export const ONE_MILLION = 1_000_000;

export const ATTRIBUTION_MODELS = ['LAST_TOUCH', 'LAST_NON_DIRECT', 'FIRST_TOUCH', 'LINEAR', 'TIME_DECAY', 'POSITION_BASED', 'DATA_DRIVEN'] as const;
export type AttributionModel = (typeof ATTRIBUTION_MODELS)[number];
export const DEFAULT_MODEL: AttributionModel = 'POSITION_BASED';
/** Models computed from a single path in isolation (DATA_DRIVEN needs the whole path graph: see data-driven.ts). */
export const PATH_MODELS = ATTRIBUTION_MODELS.filter((m) => m !== 'DATA_DRIVEN') as readonly Exclude<AttributionModel, 'DATA_DRIVEN'>[];

export interface PathTouch {
  /** Instant of the touch. */
  at: number;
  /** Source kind (DIRECT, ORGANIC_SEARCH, PROVIDER_LINK, CAMPAIGN, REFERRAL ...). */
  kind: string;
  /** Source reference (link code, campaign utm), '' when none. Never a person. */
  ref: string;
  campaignId: string;
}

export interface ModelOptions { halfLifeDays: number; positionFirstBp: number; positionLastBp: number }
export const DEFAULT_MODEL_OPTIONS: ModelOptions = { halfLifeDays: 7, positionFirstBp: 4000, positionLastBp: 4000 };

/**
 * Splits `total` into integer parts proportional to `weights` (non-negative numbers); the parts sum to `total` exactly.
 * Largest remainder, ties to the lower index, so it is deterministic. All-zero weights give everything to the last index.
 */
export function apportion(total: number, weights: readonly number[]): number[] {
  const n = weights.length; if (n === 0) return [];
  if (!Number.isInteger(total) || total < 0) throw new RangeError('total must be a non-negative integer');
  const sum = weights.reduce((a, b) => a + (b > 0 ? b : 0), 0);
  if (sum <= 0) { const out = new Array<number>(n).fill(0); out[n - 1] = total; return out; }
  const exact = weights.map((w) => (w > 0 ? (w / sum) * total : 0));
  const floor = exact.map((x) => Math.floor(x));
  let rest = total - floor.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (let k = 0; rest > 0 && k < order.length; k++, rest--) floor[order[k]!.i]! += 1;
  // floating point can in theory over-allocate by one unit on huge totals: take it back from the largest part
  if (rest < 0) { const j = floor.indexOf(Math.max(...floor)); floor[j]! += rest; }
  return floor;
}

const isDirect = (t: PathTouch) => t.kind === 'DIRECT';

/** Weights (ppm, sum ONE_MILLION) of one converting path for a path-local model. `path` must be ordered by time ascending and non-empty; `conversionAt` is the conversion instant. */
export function creditPath(model: Exclude<AttributionModel, 'DATA_DRIVEN'>, path: readonly PathTouch[], conversionAt: number, opts: ModelOptions = DEFAULT_MODEL_OPTIONS): number[] {
  const n = path.length; if (n === 0) return [];
  const only = (i: number) => { const w = new Array<number>(n).fill(0); w[i] = ONE_MILLION; return w; };
  switch (model) {
    case 'LAST_TOUCH': return only(n - 1);
    case 'FIRST_TOUCH': return only(0);
    case 'LAST_NON_DIRECT': { for (let i = n - 1; i >= 0; i--) if (!isDirect(path[i]!)) return only(i); return only(n - 1); } // all direct: the last direct touch
    case 'LINEAR': return apportion(ONE_MILLION, new Array<number>(n).fill(1));
    case 'TIME_DECAY': {
      const hl = Math.max(0.01, opts.halfLifeDays) * 86_400_000;
      return apportion(ONE_MILLION, path.map((t) => Math.pow(2, -Math.max(0, conversionAt - t.at) / hl)));
    }
    case 'POSITION_BASED': {
      if (n === 1) return only(0);
      if (n === 2) return [ONE_MILLION / 2, ONE_MILLION / 2];
      const first = Math.round((opts.positionFirstBp / 10_000) * ONE_MILLION); const last = Math.round((opts.positionLastBp / 10_000) * ONE_MILLION);
      const mid = ONE_MILLION - first - last; if (mid < 0) throw new RangeError('first plus last share exceeds 100 percent');
      const middle = apportion(mid, new Array<number>(n - 2).fill(1));
      return [first, ...middle, last];
    }
  }
}

/** Same as `creditPath` but a conversion with no touch in the window is credited to one synthetic UNATTRIBUTED touch, so totals reconcile. */
export const UNATTRIBUTED_TOUCH = (at: number): PathTouch => ({ at, kind: 'UNATTRIBUTED', ref: '', campaignId: '' });
