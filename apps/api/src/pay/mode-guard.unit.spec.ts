import { assertRealModeApproved, modeGuardProblems, realModeDecision, RealModeNotApprovedError, setApprovedModesSource } from '../common/providers/mode-guard';
import { pspAdapter, RealModeBlockedPspAdapter } from './psp';
import { policyNow, setPolicyOverride, clearPolicyOverrides } from '../growth/policy/policy-registry';
import { vendorPspProblems } from './psp.vendors';
import { CARDGW_ENV, FAWRY_ENV, PAYMOB_ENV } from '../../test/pay-fixtures';

const REAL = { PAYMENT_MODE: 'real', PAYMENT_PROVIDER: 'vendor', PAYMENT_ENABLED_PSPS: 'paymob,fawry,card', PUBLIC_BASE_URL: 'https://api.example.test', PAYMENT_ENVIRONMENT: 'sandbox', ...PAYMOB_ENV, ...FAWRY_ENV, ...CARDGW_ENV, NODE_ENV: 'test' };
const withEnv = async <T>(vars: Record<string, string | undefined>, fn: () => T | Promise<T>) => { const old = { ...process.env }; Object.assign(process.env, vars); for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k]; try { return await fn(); } finally { for (const k of Object.keys(vars)) delete process.env[k]; Object.assign(process.env, old); } };

describe('real-mode approval guard (INTEGRATION_MODES)', () => {
  afterEach(() => { clearPolicyOverrides(); });
  it('closed by default: nothing approved means real is refused with NEEDS_HUMAN, for every PSP, in every call', async () => {
    await withEnv(REAL, async () => {
      for (const n of ['paymob', 'fawry', 'card'] as const) {
        const a = pspAdapter(n); expect(a).toBeInstanceOf(RealModeBlockedPspAdapter);
        await expect(a.createCheckout({ paymentId: 'p', amountMinor: 1, currency: 'EGP' })).rejects.toThrow(/NEEDS_HUMAN.*INTEGRATION_MODES/);
        await expect(a.refund({ pspRef: 'x', refundId: 'r', amountMinor: 1 })).rejects.toBeInstanceOf(RealModeNotApprovedError);
        expect(a.verifyWebhook('{}', {})).toBeNull(); // no webhook is accepted for an integration that is not approved live
      }
    });
  });
  it('an approved record opens exactly the approved PSP; the others stay closed', async () => {
    setPolicyOverride('INTEGRATION_MODES', { modes: { PAYMOB: 'real' } }, 1);
    await withEnv(REAL, () => { expect(pspAdapter('paymob')).not.toBeInstanceOf(RealModeBlockedPspAdapter); expect(pspAdapter('fawry')).toBeInstanceOf(RealModeBlockedPspAdapter); expect(pspAdapter('card')).toBeInstanceOf(RealModeBlockedPspAdapter); });
    setPolicyOverride('INTEGRATION_MODES', { modes: { PAYMOB: 'real', CARD_GATEWAY: 'real' } }, 2);
    await withEnv(REAL, () => { expect(pspAdapter('card')).not.toBeInstanceOf(RealModeBlockedPspAdapter); });
    expect(policyNow<any>('INTEGRATION_MODES').modes.CARD_GATEWAY).toBe('real');
  });
  it('mock is always allowed, with or without a record', async () => {
    await withEnv({ PAYMENT_MODE: 'mock', PAYMENT_PROVIDER: undefined }, () => { expect(pspAdapter('paymob').constructor.name).toBe('FakePspAdapter'); });
  });
  it('a withdrawn approval closes the adapter again (mode back to mock in the record)', async () => {
    setPolicyOverride('INTEGRATION_MODES', { modes: { PAYMOB: 'real' } }, 1); await withEnv(REAL, () => expect(pspAdapter('paymob')).not.toBeInstanceOf(RealModeBlockedPspAdapter));
    setPolicyOverride('INTEGRATION_MODES', { modes: { PAYMOB: 'mock' } }, 2); await withEnv(REAL, () => expect(pspAdapter('paymob')).toBeInstanceOf(RealModeBlockedPspAdapter));
  });
  it('no approved-record source at all fails closed; a throwing source fails closed', () => {
    setApprovedModesSource(null); expect(realModeDecision('PAYMOB', {}).allowed).toBe(false);
    setApprovedModesSource(() => { throw new Error('boom'); }); expect(realModeDecision('PAYMOB', {}).allowed).toBe(false);
    setApprovedModesSource(() => policyNow<any>('INTEGRATION_MODES').modes);
  });
  it('the development exemption works outside production only; in production it is ignored AND startup refuses it', () => {
    expect(realModeDecision('PAYMOB', { INTEGRATION_MODES_EXEMPT: 'true', NODE_ENV: 'development' })).toMatchObject({ allowed: true });
    expect(realModeDecision('PAYMOB', { INTEGRATION_MODES_EXEMPT: 'true', NODE_ENV: 'production' })).toMatchObject({ allowed: false });
    expect(() => assertRealModeApproved('PAYMOB', { INTEGRATION_MODES_EXEMPT: 'true', NODE_ENV: 'production' })).toThrow(RealModeNotApprovedError);
    expect(modeGuardProblems({ INTEGRATION_MODES_EXEMPT: 'true', NODE_ENV: 'production' })[0]).toMatch(/must not be set in production/);
    expect(vendorPspProblems({ ...REAL, NODE_ENV: 'production', INTEGRATION_MODES_EXEMPT: 'true' } as never).join(' ')).toMatch(/INTEGRATION_MODES_EXEMPT/);
    expect(modeGuardProblems({ INTEGRATION_MODES_EXEMPT: 'true', NODE_ENV: 'staging' })).toEqual([]);
  });
  it('the exemption makes the real adapter available on a dev stack', async () => {
    await withEnv({ ...REAL, INTEGRATION_MODES_EXEMPT: 'true' }, () => expect(pspAdapter('paymob')).not.toBeInstanceOf(RealModeBlockedPspAdapter));
  });
});
