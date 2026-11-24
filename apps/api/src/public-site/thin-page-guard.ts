import type { PageType } from './url-policy';

/**
 * Thin-page guard (ARCH 4.1 rule 9, Google doorway and scaled-content policy). A generated page is indexable only when it passes; otherwise it is
 * `noindex,follow`, gets no internal navigation links and is absent from the sitemaps. Render and sitemap call the SAME function.
 * Parameters come from the SEO growth config (minLiveProviders, minUniqueBlocks, maxSiblingSimilarityPercent). GRW-P1-F replaces or extends the
 * per-type functions through `registerGuard` without touching the callers.
 */
export interface GuardParams { minLiveProviders: number; minUniqueBlocks: number; maxSiblingSimilarityPercent: number }
export interface GuardInput {
  type: PageType;
  liveProviders: number;
  /** Data-derived content blocks the page can show (counts, fee range, next available, languages, rating distribution, neighbouring districts). */
  uniqueBlocks: number;
  /** Highest provider-list overlap with a sibling page, 0..100 (null = no sibling to compare). */
  siblingOverlapPercent: number | null;
}
export interface GuardResult { indexable: boolean; reasons: string[] }
export type GuardFn = (input: GuardInput, params: GuardParams) => GuardResult;

/** Page types that are always about one real entity (the entity gate is its LIVE status, not a count). */
const ENTITY_TYPES: readonly PageType[] = ['doctor', 'clinic', 'nurse', 'pharmacy', 'lab', 'home', 'static'];

export const defaultGuard: GuardFn = (input, p) => {
  if (ENTITY_TYPES.includes(input.type)) return { indexable: true, reasons: [] };
  // ARCH 4.1: the specialty hub is indexable as soon as it lists a LIVE provider (no minimum count); the deeper pages need the full guard
  if (input.type === 'hub') return input.liveProviders >= 1 ? { indexable: true, reasons: [] } : { indexable: false, reasons: ['NO_LIVE_PROVIDERS'] };
  const reasons: string[] = [];
  if (input.liveProviders < p.minLiveProviders) reasons.push(`LIVE_PROVIDERS_BELOW_${p.minLiveProviders}`);
  if (input.uniqueBlocks < p.minUniqueBlocks) reasons.push(`UNIQUE_BLOCKS_BELOW_${p.minUniqueBlocks}`);
  if (input.siblingOverlapPercent !== null && input.siblingOverlapPercent > p.maxSiblingSimilarityPercent) reasons.push(`SIBLING_OVERLAP_ABOVE_${p.maxSiblingSimilarityPercent}`);
  return { indexable: reasons.length === 0, reasons };
};

const overrides = new Map<PageType, GuardFn>();
/** Hook for GRW-P1-F: replace the guard of one page type. */
export const registerGuard = (type: PageType, fn: GuardFn): void => { overrides.set(type, fn); };
export const resetGuards = (): void => overrides.clear();

export function evaluateGuard(input: GuardInput, params: GuardParams): GuardResult {
  return (overrides.get(input.type) ?? defaultGuard)(input, params);
}

/** Share of `a` that also appears in `b`, 0..100 (provider-id lists of two sibling pages). */
export function overlapPercent(a: readonly string[], b: readonly string[]): number {
  if (!a.length) return 0;
  const set = new Set(b);
  return Math.round((a.filter((x) => set.has(x)).length / a.length) * 100);
}
