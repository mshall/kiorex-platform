import { defaultGuard, evaluateGuard, overlapPercent, registerGuard, resetGuards, type GuardParams } from './thin-page-guard';

const P: GuardParams = { minLiveProviders: 3, minUniqueBlocks: 3, maxSiblingSimilarityPercent: 70 };

describe('thin-page guard (ARCH 4.1 rule 9)', () => {
  afterEach(() => resetGuards());
  it('passes at the thresholds and names every failing rule', () => {
    expect(defaultGuard({ type: 'city', liveProviders: 3, uniqueBlocks: 3, siblingOverlapPercent: 70 }, P)).toEqual({ indexable: true, reasons: [] });
    expect(defaultGuard({ type: 'city', liveProviders: 2, uniqueBlocks: 3, siblingOverlapPercent: null }, P).reasons).toEqual(['LIVE_PROVIDERS_BELOW_3']);
    expect(defaultGuard({ type: 'district', liveProviders: 5, uniqueBlocks: 2, siblingOverlapPercent: null }, P).reasons).toEqual(['UNIQUE_BLOCKS_BELOW_3']);
    expect(defaultGuard({ type: 'district', liveProviders: 5, uniqueBlocks: 5, siblingOverlapPercent: 71 }, P).reasons).toEqual(['SIBLING_OVERLAP_ABOVE_70']);
    expect(defaultGuard({ type: 'care-district', liveProviders: 0, uniqueBlocks: 0, siblingOverlapPercent: 100 }, P).reasons).toHaveLength(3);
  });
  it('the hub needs one LIVE provider only; entity pages are gated by their own status, not by counts', () => {
    expect(defaultGuard({ type: 'hub', liveProviders: 1, uniqueBlocks: 1, siblingOverlapPercent: null }, P).indexable).toBe(true);
    expect(defaultGuard({ type: 'hub', liveProviders: 0, uniqueBlocks: 0, siblingOverlapPercent: null }, P).indexable).toBe(false);
    for (const type of ['doctor', 'clinic', 'nurse', 'home'] as const) expect(defaultGuard({ type, liveProviders: 0, uniqueBlocks: 0, siblingOverlapPercent: 100 }, P).indexable).toBe(true);
  });
  it('registerGuard (the GRW-P1-F hook) replaces one page type without touching callers', () => {
    registerGuard('city', () => ({ indexable: false, reasons: ['CUSTOM'] }));
    expect(evaluateGuard({ type: 'city', liveProviders: 99, uniqueBlocks: 9, siblingOverlapPercent: 0 }, P).reasons).toEqual(['CUSTOM']);
    expect(evaluateGuard({ type: 'district', liveProviders: 99, uniqueBlocks: 9, siblingOverlapPercent: 0 }, P).indexable).toBe(true);
  });
  it('overlapPercent is the share of the first list that also appears in the second', () => {
    expect(overlapPercent(['a', 'b', 'c', 'd'], ['c', 'd', 'e'])).toBe(50);
    expect(overlapPercent([], ['a'])).toBe(0);
    expect(overlapPercent(['a'], ['a'])).toBe(100);
  });
});
