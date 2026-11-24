import { decideProductFact, policyForProduct, FACT_KIND_PRODUCT } from './product-decision';
import type { DecisionPolicy, DecisionTouch } from '../attribution/decide';

const policy: DecisionPolicy = { versionId: 'v1', providerTouchWindowDays: 30, patientReferralWindowDays: 30, campaignClickWindowDays: 7, minDwellMsForProviderTouch: 1000, precedence: 'PROVIDER_FIRST', allowOfflineEvidence: false };
const at = '2027-01-10T10:00:00.000Z';
const touch = (o: Partial<DecisionTouch> = {}): DecisionTouch => ({ id: 't1', kind: 'PROVIDER_LINK', providerOrgRef: 'org1', occurredAt: '2027-01-05T10:00:00.000Z', dwellMs: 2000, ...o });
const fact = { product: 'PHARMACY' as const, factKind: 'ORDER' as const, factId: 'kx_ph_1', orgRef: 'org1', createdAt: at };

describe('product decision (pure)', () => {
  it('is the clinic decision: provider touch of the same organisation wins, no touch is UNATTRIBUTED, another organisation is ignored', () => {
    expect(decideProductFact(fact, [touch()], policy)).toMatchObject({ origin: 'PROVIDER_LED', reasonCode: 'PRIOR_PROVIDER_TOUCH', winningTouchId: 't1' });
    expect(decideProductFact(fact, [], policy)).toMatchObject({ origin: 'UNATTRIBUTED' });
    expect(decideProductFact(fact, [touch({ providerOrgRef: 'org2' })], policy).origin).toBe('UNATTRIBUTED');
  });
  it('never uses the clinic link-token path (no lt) and never CLINIC_LINK: an order is not provider-led without evidence', () => {
    expect(decideProductFact({ ...fact, factId: 'x' }, [], policy).reasonCode).toBe('NO_PROVIDER_EVIDENCE');
  });
  it('is deterministic and kind-scoped: same inputs same hash, an order and a lab booking with one id differ', () => {
    const a = decideProductFact(fact, [touch()], policy); const b = decideProductFact(fact, [touch()], policy);
    expect(a.inputsHash).toBe(b.inputsHash);
    const lab = decideProductFact({ ...fact, product: 'LAB', factKind: 'LAB_BOOKING' }, [touch()], policy);
    expect(lab.inputsHash).not.toBe(a.inputsHash);
  });
  it('refuses a fact kind that is not the product\'s', () => {
    expect(FACT_KIND_PRODUCT.ORDER).toBe('PHARMACY');
    expect(() => decideProductFact({ ...fact, product: 'LAB' }, [], policy)).toThrow(/does not belong/);
  });
  it('per-product windows override only that product and ignore out-of-range values', () => {
    const o = { products: { PHARMACY: { windows: { providerTouchWindowDays: 3 } } } };
    expect(decideProductFact(fact, [touch()], policyForProduct(policy, o, 'PHARMACY')).origin).toBe('UNATTRIBUTED'); // 5 days old, window 3
    expect(decideProductFact({ ...fact, product: 'LAB', factKind: 'LAB_BOOKING' }, [touch()], policyForProduct(policy, o, 'LAB')).origin).toBe('PROVIDER_LED');
    for (const bad of [0, -1, 366, Number.NaN, '9' as never]) expect(policyForProduct(policy, { products: { PHARMACY: { windows: { providerTouchWindowDays: bad } } } }, 'PHARMACY').providerTouchWindowDays).toBe(30);
  });
});
