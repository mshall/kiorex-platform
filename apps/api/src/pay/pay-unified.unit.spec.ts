import { hmacHex } from '@kiorex/pay-contract';
import { BankIpnPspAdapter, bankIpnConfig } from './psp-bank-ipn';
import { PaymobPspAdapter } from './psp.vendors';
import { validatePolicy, defaultsOf, POLICY_KINDS } from '../growth/policy/policy-registry';
import { validateGrowthConfig, LOCAL_CONFIG_KINDS } from '../growth/config/growth-config.service';
import { vendorPspProblems } from '../common/providers/problems';

const secret = 'ipn-secret-0123456789abcdef';
describe('bank IPN PSP adapter on the shared contract', () => {
  const a = new BankIpnPspAdapter({ BANK_IPN_WEBHOOK_SECRET: secret }, () => new Date('2026-11-25T10:00:00Z'));
  const body = JSON.stringify({ bankRef: 'B1', amount: '50.00', currency: 'EGP', reference: 'pay_abc12345', paidAt: '2026-11-25T09:59:00Z', status: 'success' });
  const ts = String(Math.floor(Date.parse('2026-11-25T10:00:00Z') / 1000));
  it('verifies a signed IPN into a neutral PspEvent, refuses forged / unsigned / stale', () => {
    const sig = `sha256=${hmacHex(secret, `${ts}.${body}`)}`;
    expect(a.verifyWebhook(body, { 'x-webhook-signature': sig, 'x-webhook-timestamp': ts })).toMatchObject({ type: 'payment.captured', paymentId: 'pay_abc12345', amountMinor: 5000, pspRef: 'B1' });
    expect(a.verifyWebhook(body.replace('50.00', '5000.00'), { 'x-webhook-signature': sig, 'x-webhook-timestamp': ts })).toBeNull();
    expect(a.verifyWebhook(body, {})).toBeNull();
    expect(a.verifyWebhook(body, { 'x-webhook-signature': sig, 'x-webhook-timestamp': String(Number(ts) - 3600) })).toBeNull();
  });
  it('a bad BANK_IPN_CONFIG_JSON never half-applies; a good one overrides columns', () => {
    expect(bankIpnConfig({ BANK_IPN_CONFIG_JSON: '{nope' }).columns.bankRef).toBe('bankRef');
    expect(bankIpnConfig({ BANK_IPN_CONFIG_JSON: '{"columns":{"bankRef":"TXN"},"amountUnit":"minor"}' })).toMatchObject({ amountUnit: 'minor', columns: { bankRef: 'TXN', amount: 'amount' } });
  });
  it('has no refund and no hosted page', async () => { await expect(a.refund()).rejects.toThrow(/does not support refund/); expect(a.capabilities.hostedCheckout).toBe(false); });
  it('is a known PSP with its own startup check', () => { expect(vendorPspProblems({ PAYMENT_ENABLED_PSPS: 'bank_ipn', PAYMENT_ENVIRONMENT: 'sandbox' })).toEqual(expect.arrayContaining([expect.stringContaining('BANK_IPN_WEBHOOK_SECRET')])); });
});

describe('Paymob wallet methods (config only, no network)', () => {
  const calls: any[] = [];
  const fetchImpl = (async (_u: string, init: any) => { calls.push(JSON.parse(init.body)); return { ok: true, status: 200, text: async () => '{}', json: async () => ({ client_secret: 'cs', id: 'in_1' }) }; }) as never;
  const env = { PAYMOB_SECRET_KEY: 'egy_sk_test_x', PAYMOB_PUBLIC_KEY: 'egy_pk_test_x', PAYMOB_INTEGRATION_IDS: '11', PAYMOB_WALLET_INTEGRATION_IDS: 'vodafone_cash:77' };
  it('uses the wallet integration id for rail wallet and refuses a method that is not configured', async () => {
    const p = new PaymobPspAdapter(env, fetchImpl);
    await p.createCheckout({ paymentId: 'pay_w1', amountMinor: 1000, currency: 'EGP', rail: 'wallet', method: 'vodafone_cash' }).catch(() => undefined);
    expect(JSON.stringify(calls.at(-1))).toContain('77'); expect(JSON.stringify(calls.at(-1))).not.toContain('"payment_methods":[11]');
    await expect(p.createCheckout({ paymentId: 'pay_w2', amountMinor: 1000, currency: 'EGP', rail: 'wallet', method: 'orange_cash' })).rejects.toThrow(/NEEDS_HUMAN/);
  });
});

describe('PAY_* policy kinds', () => {
  it('are registered, default-valid and accepted by the maker-checker console', () => {
    for (const k of ['PAY_FRAUD_THRESHOLDS', 'PAY_MATCHING_POLICY', 'PAY_ROUTING_POLICY'] as const) { expect(POLICY_KINDS).toContain(k); expect(LOCAL_CONFIG_KINDS).toContain(k); expect(validatePolicy(k, defaultsOf(k))).toEqual([]); expect(validateGrowthConfig(k, {}).valid).toBe(true); }
  });
  it('safety floors hold: no enforce mode, no laxer-than-floor numbers, at most one rule off', () => {
    expect(validatePolicy('PAY_FRAUD_THRESHOLDS', { mode: 'ENFORCE' }).length).toBeGreaterThan(0);
    expect(validatePolicy('PAY_FRAUD_THRESHOLDS', { velocity: { maxAttempts: 500 } }).length).toBeGreaterThan(0);
    expect(validatePolicy('PAY_FRAUD_THRESHOLDS', { disabledRules: ['VELOCITY', 'CARD_TESTING'] }).length).toBeGreaterThan(0);
    expect(validatePolicy('PAY_FRAUD_THRESHOLDS', { mode: 'FLAG', velocity: { maxAttempts: 12 } })).toEqual([]);
    expect(validatePolicy('PAY_MATCHING_POLICY', { autoThreshold: 0.5 }).length).toBeGreaterThan(0);
    expect(validatePolicy('PAY_MATCHING_POLICY', { reviewThreshold: 0.8, autoThreshold: 0.9 })).toEqual([]);
    expect(validatePolicy('PAY_ROUTING_POLICY', { fee: 3 }).length).toBeGreaterThan(0); // no fee lives in a policy kind
    expect(validatePolicy('INTEGRATION_MODES', { modes: { BANK_IPN: 'real' } })).toEqual([]);
  });
});
