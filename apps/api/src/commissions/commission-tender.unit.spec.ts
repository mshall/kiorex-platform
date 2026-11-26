import { isCashTransfer, parseTenderFields } from './commission-tender';
import { tenderOf } from './commission-claims.service';

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
