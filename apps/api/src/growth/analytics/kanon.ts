/**
 * k-anonymity for every growth report, export and chart (KX-32 section 10, ADR-007 privacy). PURE.
 * A cell built from fewer than K_MIN people or bookings is shown as "<10" and carries no figure derived from it (no money, no ratio).
 * Differencing: if exactly one cell of a breakdown is masked and the total is shown, the masked count could be recovered by subtraction, so the
 * smallest visible cell is masked as well (secondary suppression). An empty cell (0) is not a person and stays 0.
 */
export const K_MIN = 10;
export const MASK = '<10' as const;
export type Masked = number | typeof MASK;

export const maskCount = (n: number): Masked => (n > 0 && n < K_MIN ? MASK : n);

export interface Cell { key: string; count: number; values?: Record<string, number> }
export interface MaskedCell { key: string; count: Masked; masked: boolean; values: Record<string, Masked> }

/** `denominators` are extra counts a ratio rests on: a ratio cell is hidden when any denominator or the count is below K. */
export function applyKAnonymity(cells: Cell[], opts: { totalShown?: boolean } = {}): MaskedCell[] {
  const hide = new Set<string>(cells.filter((c) => c.count > 0 && c.count < K_MIN).map((c) => c.key));
  if (opts.totalShown !== false && hide.size === 1) {
    const visible = cells.filter((c) => !hide.has(c.key) && c.count > 0).sort((a, b) => a.count - b.count || (a.key < b.key ? -1 : 1));
    if (visible[0]) hide.add(visible[0].key);
  }
  return cells.map((c) => {
    const masked = hide.has(c.key);
    return { key: c.key, count: masked ? MASK : c.count, masked, values: Object.fromEntries(Object.entries(c.values ?? {}).map(([k, v]) => [k, masked ? MASK : v])) };
  });
}

/** A single aggregate (no breakdown): masked when it rests on 1 to 9 units. */
export function maskTotal(count: number, values: Record<string, number | null> = {}): { count: Masked; masked: boolean; values: Record<string, Masked | null> } {
  const masked = count > 0 && count < K_MIN;
  return { count: masked ? MASK : count, masked, values: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v === null ? null : masked ? MASK : v])) };
}
