import { K_MIN } from '../analytics/kanon';

/**
 * Privacy rules of the corporate programme (GRW-P4-C), in one place so the report, the console and the tests cannot disagree.
 * K floor: no group smaller than 10 is ever shown, and the floor cannot be configured below 10 (a safety control, not a flag).
 */
/** The platform floor (analytics/kanon K_MIN); equals `CORPORATE_MIN_K` of the unreleased contracts set. */
export const K_FLOOR = K_MIN;
export const effectiveK = (configured?: number): number => Math.max(K_FLOOR, Number.isInteger(configured) ? (configured as number) : K_FLOOR);

/** A count that may be shown: below k it is masked (null). Counts are never rounded into a hint: a masked cell stays masked. */
export const maskCount = (n: number, k = K_FLOOR): number | null => (n === 0 || n >= effectiveK(k) ? n : null);

/** Sums over masked cells must not reveal them by subtraction: when exactly one cell of a breakdown is masked, the smallest visible cell is masked too. */
export function maskBreakdown<T extends string>(cells: Record<T, number>, k = K_FLOOR): Record<T, number | null> {
  const kk = effectiveK(k);
  const out = {} as Record<T, number | null>;
  const keys = Object.keys(cells) as T[];
  for (const key of keys) out[key] = cells[key] === 0 || cells[key] >= kk ? cells[key] : null;
  const hidden = keys.filter((x) => out[x] === null && cells[x] > 0);
  const visible = keys.filter((x) => out[x] !== null && cells[x] > 0).sort((a, b) => (cells[a] - cells[b]));
  if (hidden.length === 1 && visible.length) out[visible[0]] = null;
  return out;
}

/** Money totals are shown only when the group that produced them reaches k. */
export const maskTotal = (total: number, group: number, k = K_FLOOR): number | null => (group === 0 || group >= effectiveK(k) ? total : null);

/** Free-text fields of a lead or an invoice note describe a COMPANY. A line that looks like an e-mail address, a phone number or an Egyptian national id is refused, not stored. */
const PERSONAL = [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, /(?:\+|00)?\d[\d\s().-]{8,}\d/, /\b[23]\d{13}\b/];
export const looksPersonal = (text: string): boolean => PERSONAL.some((re) => re.test(text.normalize('NFKC').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))));
