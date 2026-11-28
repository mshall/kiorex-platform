import { ONBOARDING_TRANSITIONS, canMove, draftFromLead, draftStatuses, kindForProviderType, submitBlockers } from './lead-onboarding';

describe('lead onboarding draft rules', () => {
  it('maps every provider type to a product kind, OTHER and unknown types to none', () => {
    expect(['CLINIC', 'INDEPENDENT_DOCTOR', 'CHAIN', 'HOSPITAL', 'PHYSICIAN'].map(kindForProviderType)).toEqual(Array(5).fill('CLINIC'));
    expect(kindForProviderType('NURSE')).toBe('NURSE'); expect(kindForProviderType('LAB')).toBe('LAB'); expect(kindForProviderType('PHARMACY')).toBe('PHARMACY');
    expect(kindForProviderType('OTHER')).toBeNull(); expect(kindForProviderType('ADDED_BY_TEAM')).toBeNull();
  });
  it('is created on ONBOARDING and on WON by default (one draft per lead); the env can narrow it to WON; never on anything else (LOST in particular)', () => {
    expect(draftStatuses(undefined)).toEqual(['ONBOARDING', 'WON']); expect(draftStatuses('')).toEqual(['ONBOARDING', 'WON']);
    expect(draftStatuses('won')).toEqual(['WON']); expect(draftStatuses('won, onboarding')).toEqual(['WON', 'ONBOARDING']); expect(draftStatuses('LOST,NEW,garbage')).toEqual(['ONBOARDING', 'WON']);
    expect(draftStatuses(undefined)).not.toContain('LOST');
  });
  it('copies the business fields and the reference, never contact data', () => {
    const d = draftFromLead({ id: 'ld_1', ref: 'KL-ABCD2345', legalName: 'Nile Clinic', providerType: 'CLINIC', mode: 'CONNECTED', modules: ['CLINIC'], market: 'EG', ownerSub: 'u1', ownerName: 'Mona', isTest: true, ...({ phoneEnc: 'secret', emailEnc: 'secret', contactNameEnc: 'secret' } as object) } as never);
    expect(d).toEqual({ leadId: 'ld_1', kind: 'CLINIC', legalName: 'Nile Clinic', providerType: 'CLINIC', mode: 'CONNECTED', modules: ['CLINIC'], market: 'EG', contactRef: 'KL-ABCD2345', assigneeSub: 'u1', assigneeName: 'Mona', isTest: true });
    expect(JSON.stringify(d)).not.toContain('secret');
  });
  it('workflow moves: approval only after submission, final states are final, reject and cancel can be reopened', () => {
    expect(canMove('DRAFT', 'APPROVED')).toBe(false); expect(canMove('DRAFT', 'SUBMITTED')).toBe(true); expect(canMove('SUBMITTED', 'APPROVED')).toBe(true);
    expect(ONBOARDING_TRANSITIONS.APPROVED).toEqual([]); expect(canMove('REJECTED', 'DRAFT')).toBe(true); expect(canMove('CANCELLED', 'DRAFT')).toBe(true); expect(canMove('APPROVED', 'DRAFT')).toBe(false);
  });
  it('submit needs a product kind and a won or onboarding join request', () => {
    expect(submitBlockers({ kind: null }, 'WON')).toEqual(['KIND_REQUIRED']); expect(submitBlockers({ kind: 'LAB' }, 'LOST')).toEqual(['LEAD_NOT_ACTIVE']);
    expect(submitBlockers({ kind: 'LAB' }, 'WON')).toEqual([]); expect(submitBlockers({ kind: 'LAB' }, 'ONBOARDING')).toEqual([]);
  });
});
