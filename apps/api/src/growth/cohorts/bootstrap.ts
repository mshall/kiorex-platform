/** Seeded bootstrap helpers for the LTV intervals (GRW-P3-C). PURE and deterministic: the same seed and inputs always give the same numbers. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** Nearest-rank percentile of an ascending array (q in [0,1]). */
export function percentile(sorted: readonly number[], q: number): number {
  if (!sorted.length) return 0; const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1)); return sorted[i]!;
}
/** Deterministic subsample of `n` items without replacement (partial Fisher-Yates with the seeded generator). */
export function subsample<T>(items: readonly T[], n: number, rnd: () => number): T[] {
  if (items.length <= n) return [...items];
  const a = [...items]; for (let i = 0; i < n; i++) { const j = i + Math.floor(rnd() * (a.length - i)); [a[i], a[j]] = [a[j]!, a[i]!]; }
  return a.slice(0, n);
}
export const hashSeed = (seed: number, text: string): number => { let h = seed >>> 0; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0; return h; };
