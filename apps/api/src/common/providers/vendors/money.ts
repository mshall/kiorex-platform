/**
 * Minor-unit helpers shared by the PSP clients. Amounts inside Kiorex are ALWAYS integer minor units of the market currency; vendors that speak major units
 * (Fawry: "150.00") get an exact decimal string built from the integer (never a float division that can drift), and parsing refuses anything that is not an exact amount.
 */
export const CURRENCY_DECIMALS: Readonly<Record<string, number>> = { EGP: 2, SAR: 2, AED: 2, USD: 2, EUR: 2, KWD: 3, BHD: 3, OMR: 3, JOD: 3 };
export const decimalsOf = (currency: string, override?: number): number => (override !== undefined && Number.isInteger(override) && override >= 0 && override <= 4 ? override : CURRENCY_DECIMALS[currency.toUpperCase()] ?? 2);

/** 15000 -> "150.00" (2 decimals), 1500 -> "1.500" (3 decimals). Exact: pure integer arithmetic. */
export function toMajorString(minor: number, decimals = 2): string {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new RangeError('amountMinor must be a non-negative integer');
  const f = 10 ** decimals; const whole = Math.floor(minor / f); const frac = minor - whole * f;
  return decimals === 0 ? String(whole) : `${whole}.${String(frac).padStart(decimals, '0')}`;
}
/** "150.00" / 150 / "150.5" -> 15000 / 15000 / 15050. Returns null for anything with more fractional digits than `decimals`, a sign, or a non-number (never rounds silently). */
export function fromMajor(v: unknown, decimals = 2): number | null {
  const s = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : typeof v === 'string' ? v.trim() : '';
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const frac = m[2] ?? '';
  if (frac.length > decimals) { if (/[^0]/.test(frac.slice(decimals))) return null; }
  const n = Number(m[1]) * 10 ** decimals + Number((frac + '0'.repeat(decimals)).slice(0, decimals) || 0);
  return Number.isSafeInteger(n) ? n : null;
}
