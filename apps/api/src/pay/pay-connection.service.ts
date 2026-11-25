import { createHmac } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { cfg } from '../common/config';
import { providerEnv } from '../common/providers/env';
import { ProviderError } from '../common/providers/http';
import { signedWebhookHeaders } from '../common/providers/webhook';
import { fawryCallbackSignature } from '../common/providers/vendors/fawry';
import { paymobHmac } from '../common/providers/vendors/paymob';
import { breakerSnapshots } from './psp-breaker';
import { keyModeProblem, PSP_NAMES, PSP_SECRETS, secretRef, settingsProblems, type PspName } from './psp-config';
import { PspConfigService } from './psp-config.service';
import { pspAdapter } from './psp';
import { PSP_VENDOR_MODE, vendorPspProblems } from './psp.vendors';

type Env = Record<string, string | undefined>;
export interface SecretStatus { purpose: string; ref: string; env: string; kind: string; present: boolean }
export interface PspConnection {
  psp: PspName; enabled: boolean; mode: 'sandbox' | 'live'; ready: boolean;
  /** Names of environment variables that are missing or invalid (never values). */
  missing: string[]; secrets: SecretStatus[];
  webhook: { url: string; scheme: string; secretRef: string | null; secretEnv: string | null; register: string };
  selfTest: { ok: boolean; detail: string }; problems: string[];
  breaker: { state: string; consecutiveFailures: number; openedAt: string | null } | null;
  live?: { ok: boolean; status: string; ms: number };
}
const SCHEME: Record<PspName, { scheme: string; register: string }> = {
  paymob: { scheme: 'HMAC-SHA512 over the documented fields, sent as the `hmac` query parameter of the processed callback', register: 'Paymob dashboard > Developers > Payment Integrations > (each card integration) > "Transaction processed callback"' },
  fawry: { scheme: 'messageSignature = SHA-256 over refNumber + merchantRefNumber + amounts + status + method + secure key (in the JSON body)', register: 'Fawry merchant portal > Integration > Callback URL (v2); the per-order `orderWebHookUrl` is also sent with every charge request' },
  instapay: { scheme: 'X-Webhook-Timestamp + X-Webhook-Signature = sha256=HMAC-SHA256(secret, "<ts>.<rawBody>")', register: 'The InstaPay gateway / acquirer console: webhook endpoint (event types payment.* refund.* dispute.*)' },
  bank_ipn: { scheme: 'X-Webhook-Timestamp + X-Webhook-Signature = HMAC-SHA256(secret, "<ts>.<rawBody>") of the bank / aggregator IPN, or a daily IPN file uploaded in ops', register: 'The bank or its aggregator: IPN endpoint, or agree a daily IPN file (NEEDS_HUMAN LG-INT-PAY-12: the bank\'s real layout and signature)' },
  card: { scheme: 'X-Webhook-Timestamp + X-Webhook-Signature = sha256=HMAC-SHA256(secret, "<ts>.<rawBody>")', register: 'The card gateway console: webhook endpoint (event types payment.* refund.* dispute.*)' },
};
const FIXTURE_OBJ = { amount_cents: 15000, created_at: '2026-11-25T10:00:00.000000', currency: 'EGP', error_occured: false, has_parent_transaction: false, id: 900001, integration_id: 1, is_3d_secure: true, is_auth: false, is_capture: false, is_refunded: false, is_standalone_payment: true, is_voided: false, order: { id: 700001 }, owner: 1, pending: false, source_data: { pan: '2346', sub_type: 'MasterCard', type: 'card' }, success: true };

/**
 * "Payments connection check" (ops, mock-safe). Answers, WITHOUT any vendor call unless the operator asks for a live probe: which PSPs are enabled, whether every secret is present (by
 * REFERENCE name and a yes/no, never the value), which URL to register at the vendor and how it is signed, whether the HMAC secret and verifier work (a canned fixture is signed with the configured
 * secret and verified through the real adapter), whether a test key is in a live setup, the circuit-breaker state, and the settings problems. The live probe is one read-only, authenticated,
 * non-money call per PSP (a status inquiry for a reference that does not exist): "unauthorised" means the credentials are wrong, "not found" means the connection works.
 */
@Injectable()
export class PayConnectionService {
  constructor(private readonly config: PspConfigService) {}

  private secretsOf(psp: PspName, env: Env, environment: string): SecretStatus[] {
    return PSP_SECRETS.filter((s) => s.psp === psp || (s.psp === 'all' && s.kind === 'pepper')).map((s) => ({ purpose: s.purpose, ref: secretRef('kiorex', environment === 'live' ? 'prod' : 'staging', s.purpose), env: s.env, kind: s.kind, present: !!(env[s.env] ?? '').trim() }));
  }

  /** Canned fixture signed with the CONFIGURED secret and verified through the real adapter: proves the secret is present and the verification path works (no network). */
  private selfTest(psp: PspName, env: Env): { ok: boolean; detail: string } {
    try {
      const a = pspAdapter(psp);
      if (cfg().pspMode === 'sandbox-fake') return { ok: true, detail: 'mock mode: the fake PSP signature path is used' };
      if (psp === 'paymob') {
        const secret = env.PAYMOB_HMAC_SECRET ?? ''; if (!secret) return { ok: false, detail: 'PAYMOB_HMAC_SECRET missing' };
        const raw = JSON.stringify({ type: 'TRANSACTION', obj: FIXTURE_OBJ });
        const ev = a.verifyWebhook(raw, {}, { hmac: paymobHmac(secret, FIXTURE_OBJ) });
        const bad = a.verifyWebhook(raw, {}, { hmac: 'x'.repeat(128) });
        return ev && !bad ? { ok: true, detail: 'a signed fixture verifies and a forged one is rejected' } : { ok: false, detail: 'verification self-test failed' };
      }
      if (psp === 'fawry') {
        const key = env.FAWRY_SECURE_KEY ?? ''; if (!key) return { ok: false, detail: 'FAWRY_SECURE_KEY missing' };
        const b: Record<string, unknown> = { fawryRefNumber: '1', merchantRefNumber: 'pay_selftest', paymentAmount: 150, orderAmount: 150, orderStatus: 'PAID', paymentMethod: 'PAYATFAWRY', paymentRefrenceNumber: '9' };
        const raw = JSON.stringify({ ...b, messageSignature: fawryCallbackSignature(key, b) });
        const bad = JSON.stringify({ ...b, paymentAmount: 1, messageSignature: fawryCallbackSignature(key, b) });
        return a.verifyWebhook(raw, {}) && !a.verifyWebhook(bad, {}) ? { ok: true, detail: 'a signed fixture verifies and a tampered amount is rejected' } : { ok: false, detail: 'verification self-test failed' };
      }
      const secret = psp === 'card' ? env.CARDGW_WEBHOOK_SECRET : env.INSTAPAY_WEBHOOK_SECRET; if (!secret) return { ok: false, detail: `${psp === 'card' ? 'CARDGW' : 'INSTAPAY'}_WEBHOOK_SECRET missing` };
      const raw = JSON.stringify({ id: 'evt_selftest', type: 'payment.captured', paymentRef: 'ref', reference: 'pay_selftest', amountMinor: 15000, occurredAt: new Date().toISOString() });
      const ok = a.verifyWebhook(raw, signedWebhookHeaders(secret, raw)); const bad = a.verifyWebhook(raw, { ...signedWebhookHeaders(secret, raw), 'x-webhook-signature': `sha256=${createHmac('sha256', 'wrong').update(raw).digest('hex')}` });
      return ok && !bad ? { ok: true, detail: 'a signed fixture verifies and a forged one is rejected' } : { ok: false, detail: 'verification self-test failed' };
    } catch (e) { return { ok: false, detail: `self-test error: ${(e as Error).name}` }; }
  }

  private async probe(psp: PspName): Promise<{ ok: boolean; status: string; ms: number }> {
    const t0 = Date.now();
    try {
      const a = pspAdapter(psp); if (!a.status) return { ok: false, status: 'NO_STATUS_CALL', ms: 0 };
      await a.status({ pspRef: 'kx-connection-probe', paymentId: 'kx-connection-probe' });
      return { ok: true, status: 'REACHABLE', ms: Date.now() - t0 };
    } catch (e) {
      if (e instanceof ProviderError) {
        if (e.code === 'UNAUTHORIZED') return { ok: false, status: 'UNAUTHORIZED: credentials rejected', ms: Date.now() - t0 };
        if (e.code === 'REJECTED' || e.code === 'INVALID_REQUEST' || e.code === 'BAD_RESPONSE') return { ok: true, status: `AUTHENTICATED (vendor answered ${e.status ?? e.code} for the probe reference)`, ms: Date.now() - t0 };
        return { ok: false, status: `${e.code}${e.status ? ` ${e.status}` : ''}`, ms: Date.now() - t0 };
      }
      return { ok: false, status: (e as Error).message.slice(0, 80), ms: Date.now() - t0 };
    }
  }

  async check(o: { live?: boolean; env?: Env } = {}) {
    const env = o.env ?? process.env;
    const real = providerEnv('PAYMENT', env).mode === 'real';
    const vendor = PSP_VENDOR_MODE(env);
    const all = await this.config.all('EG');
    const missingAll = real && vendor ? vendorPspProblems(env) : [];
    const breakers = breakerSnapshots();
    const psps: PspConnection[] = [];
    for (const psp of PSP_NAMES) {
      const s = all[psp]; const enabled = s.enabled;
      const secrets = this.secretsOf(psp, env, s.mode);
      const missing = missingAll.filter((m) => new RegExp(`^${psp === 'card' ? 'CARDGW' : psp.toUpperCase()}_`).test(m)).map((m) => m.split(' ')[0]);
      const whSecret = PSP_SECRETS.find((x) => x.psp === psp && x.kind === 'hmac');
      const problems = [...(enabled ? settingsProblems(psp, s, env) : []), ...(keyModeProblem(psp, s.mode, env) ? [keyModeProblem(psp, s.mode, env)!] : [])];
      if (real && !env.PAYMENT_FINGERPRINT_PEPPER && enabled) problems.push('PAYMENT_FINGERPRINT_PEPPER not set: no card fingerprint reaches the fraud signals (optional)');
      if (real && enabled && !/^https:\/\//.test(cfg().publicBaseUrl) && s.mode === 'live') problems.push('PUBLIC_BASE_URL is not https: vendors cannot call back');
      const c: PspConnection = {
        psp, enabled, mode: s.mode, ready: real ? enabled && missing.length === 0 && secrets.filter((x) => x.kind !== 'pepper' && x.kind !== 'public-key' ? true : false).every((x) => x.present || !enabled) : true,
        missing, secrets, problems,
        webhook: { url: `${cfg().publicBaseUrl}/api/v1/pay/webhooks/${psp}`, ...SCHEME[psp], secretRef: whSecret ? secretRef('kiorex', s.mode === 'live' ? 'prod' : 'staging', whSecret.purpose) : null, secretEnv: whSecret?.env ?? null },
        selfTest: enabled || !real ? this.selfTest(psp, env) : { ok: true, detail: 'not enabled' },
        breaker: breakers[`${psp}:${s.mode}`] ?? null,
      };
      if (o.live && real && enabled) c.live = await this.probe(psp);
      psps.push(c);
    }
    const enabled = psps.filter((p) => p.enabled);
    const failing = enabled.filter((p) => !p.ready || !p.selfTest.ok || (p.live && !p.live.ok));
    return {
      mode: real ? 'real' : 'mock', provider: !real ? 'mock' : vendor ? 'vendor' : 'gateway', environment: all.paymob.mode,
      publicBaseUrl: cfg().publicBaseUrl, webBaseUrl: cfg().webBaseUrl, postToPayLedgerNote: 'REWARD_RULES.postToPayLedger is a finance decision (H-25), default false; both paths are tested',
      overall: !real ? 'MOCK' : failing.length ? 'FAIL' : enabled.some((p) => p.problems.length) ? 'WARN' : 'OK',
      psps, startupProblems: missingAll, liveProbe: !!(o.live && real),
    };
  }
}
