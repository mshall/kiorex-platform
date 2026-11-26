import { isCashTransfer, parseTenderFields } from './commission-tender';
import { tenderOf } from './commission-claims.service';
import { computeCommissionMinor, parseRate, rateProblems, specForTender, tenderKindOf } from './commission-rate';

/** LG-COM-20 pure rules. */
describe('commission tender kinds', () => {
  it('an older client (CASH, no kind) is plain cash; ONLINE ignores any kind; unknown values are not reported', () => {
    expect(parseTenderFields({ tender: 'cash' })).toEqual({ tender: 'CASH', tenderMethod: null, tenderDetail: null });
    expect(parseTenderFields({ tender: 'ONLINE', tenderMethod: 'CASH_TRANSFER', tenderDetail: 'INSTAPAY' })).toEqual({ tender: 'ONLINE', tenderMethod: null, tenderDetail: null });
    expect(parseTenderFields({ tender: 'BARTER', tenderMethod: 'CASH_TRANSFER' })).toEqual({ tender: null, tenderMethod: null, tenderDetail: null });
    expect(parseTenderFields({})).toEqual({ tender: null, tenderMethod: null, tenderDetail: null });
    expect(parseTenderFields({ tender: 3 as unknown as string })).toEqual({ tender: null, tenderMethod: null, tenderDetail: null });
  });
  it('a cash transfer is CASH on the wire, with its own kind and a known detail only', () => {
    for (const d of ['BANK_TRANSFER', 'INSTAPAY', 'CARD_TERMINAL']) expect(parseTenderFields({ tender: 'CASH', tenderMethod: 'cash_transfer', tenderDetail: d.toLowerCase() })).toEqual({ tender: 'CASH', tenderMethod: 'CASH_TRANSFER', tenderDetail: d });
    expect(parseTenderFields({ tender: 'CASH', tenderMethod: 'CASH_TRANSFER', tenderDetail: 'MOON' })).toEqual({ tender: 'CASH', tenderMethod: 'CASH_TRANSFER', tenderDetail: null });
    expect(parseTenderFields({ tender: 'CASH', tenderMethod: 'CASH', tenderDetail: 'INSTAPAY' }).tenderDetail).toBeNull();
    expect(isCashTransfer({ tender: 'CASH', tenderMethod: 'CASH_TRANSFER' })).toBe(true);
    expect(isCashTransfer({ tender: 'CASH', tenderMethod: null })).toBe(false);
    expect(isCashTransfer({ tender: null, tenderMethod: 'CASH_TRANSFER' })).toBe(false);
  });
  it('an event without a valid tender keeps the claim as it was; an event with a tender but no kind keeps the known kind', () => {
    const prev = { tender: 'CASH', tenderMethod: 'CASH_TRANSFER', tenderDetail: 'INSTAPAY' };
    expect(tenderOf({}, prev)).toEqual(prev);
    expect(tenderOf({ tender: 'nope' }, prev)).toEqual(prev);
    expect(tenderOf({ tender: 'CASH' }, prev)).toEqual(prev);
    expect(tenderOf({ tender: 'CASH', tenderMethod: 'CASH' }, prev)).toEqual({ tender: 'CASH', tenderMethod: 'CASH', tenderDetail: null });
    expect(tenderOf({ tender: 'ONLINE' }, prev)).toEqual({ tender: 'ONLINE', tenderMethod: null, tenderDetail: null });
    expect(tenderOf({ tender: 'CASH' }, null)).toEqual({ tender: 'CASH', tenderMethod: null, tenderDetail: null });
  });
});

describe('LG-COM-20 per-tender treatment (pure)', () => {
  const base = { feeType: 'PERCENT', percentBps: 1000, minMinor: 500, maxMinor: 9000 };
  it('tender kind of a claim: ONLINE, CASH, CASH_TRANSFER, or none (unknown takes the base)', () => {
    expect([tenderKindOf({ tender: 'ONLINE' }), tenderKindOf({ tender: 'CASH' }), tenderKindOf({ tender: 'CASH', tenderMethod: 'CASH_TRANSFER' }), tenderKindOf({ tender: null, tenderMethod: 'CASH_TRANSFER' })]).toEqual(['ONLINE', 'CASH', 'CASH_TRANSFER', null]);
  });
  it('a spec without tenders is valid and prices every kind alike (backward compatible); a spec with them parses and keeps only what was set', () => {
    expect(rateProblems(base)).toEqual([]);
    const plain = parseRate(base); expect(plain).not.toHaveProperty('tenders');
    for (const k of ['ONLINE', 'CASH', 'CASH_TRANSFER', null] as const) expect(computeCommissionMinor(100000, specForTender(plain, k))).toBe(computeCommissionMinor(100000, plain));
    const withT = { ...base, tenders: { CASH_TRANSFER: { feeType: 'FLAT', flatMinor: 1200, maxMinor: null }, CASH: {} } };
    expect(rateProblems(withT)).toEqual([]);
    expect(parseRate(withT).tenders).toEqual({ CASH_TRANSFER: { feeType: 'FLAT', flatMinor: 1200, maxMinor: null } });
  });
  it('the entry replaces only what it sets; a null floor or cap lifts the base one; the kind without an entry is the base', () => {
    const s = parseRate({ ...base, tenders: { CASH_TRANSFER: { feeType: 'FLAT', flatMinor: 1200, maxMinor: null }, ONLINE: { maxMinor: 2000 } } });
    expect(specForTender(s, 'CASH_TRANSFER')).toMatchObject({ feeType: 'FLAT', flatMinor: 1200, percentBps: null, minMinor: 500, maxMinor: null, treatment: 'TENDER' });
    expect(computeCommissionMinor(100000, specForTender(s, 'ONLINE'))).toBe(2000);
    expect(specForTender(s, 'CASH')).toMatchObject({ feeType: 'PERCENT', percentBps: 1000, treatment: 'BASE' });
    expect(specForTender(s, null).treatment).toBe('BASE');
    expect(specForTender(s, 'CASH')).not.toHaveProperty('tenders');
  });
  it('rejects malformed treatments', () => {
    for (const t of [{ BARTER: {} }, { CASH: { percentBps: 5 } }, { CASH: { feeType: 'FLAT', flatMinor: -1 } }, { CASH: { feeType: 'PERCENT', percentBps: 20000 } }, { CASH: { mode: 'NOPE' } }, { CASH: { minMinor: 9, maxMinor: 1 } }, { CASH: { bogus: 1 } }, [] , 'x']) expect(rateProblems({ ...base, tenders: t }).length).toBeGreaterThan(0);
  });
});
