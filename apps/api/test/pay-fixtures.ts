import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { signedWebhookHeaders } from '../src/common/providers/webhook';
import { fawryCallbackSignature } from '../src/common/providers/vendors/fawry';
import { paymobHmac } from '../src/common/providers/vendors/paymob';

/**
 * Vendor payload fixtures (PAY-READY). The JSON files in test/fixtures/pay are SHAPE-FAITHFUL SAMPLES written from each vendor's public documentation, not captures of real traffic:
 * they carry only dummy ids and test secrets. The first real sandbox run records the true payloads (PAYMENT_RECORD_FIXTURES_DIR, see the runbook), and a drift between a sample and a
 * recording is a test failure to fix, not to hide.
 */
export const FIXTURE_DIR = join(__dirname, 'fixtures', 'pay');
export const fixtureText = (name: string) => readFileSync(join(FIXTURE_DIR, name), 'utf8');
export const fixture = (name: string, vars: Record<string, string> = {}): any => {
  let t = fixtureText(name); for (const [k, v] of Object.entries(vars)) t = t.split(`__${k}__`).join(v); return JSON.parse(t);
};

/** Dummy credentials. None is a real secret. */
export const PAYMOB_ENV = { PAYMOB_SECRET_KEY: 'egy_sk_test_DUMMY0123456789', PAYMOB_PUBLIC_KEY: 'egy_pk_test_DUMMY0123456789', PAYMOB_HMAC_SECRET: 'paymob_hmac_dummy_secret_0001', PAYMOB_INTEGRATION_IDS: '4000001', PAYMOB_AUTH_INTEGRATION_IDS: '4000002', PAYMENT_FINGERPRINT_PEPPER: 'pepper_dummy_0123456789abcdef' } as Record<string, string>;
export const FAWRY_ENV = { FAWRY_MERCHANT_CODE: 'merchant_dummy', FAWRY_SECURE_KEY: 'fawry_secure_dummy_0001' } as Record<string, string>;
export const CARDGW_ENV = { CARDGW_API_URL: 'https://api.cardgw.example/v1', CARDGW_API_KEY: 'cardgw_key_dummy_0001', CARDGW_WEBHOOK_SECRET: 'cardgw_whsec_dummy_0123456789', PAYMENT_FINGERPRINT_PEPPER: 'pepper_dummy_0123456789abcdef' } as Record<string, string>;
export const INSTAPAY_ENV = { INSTAPAY_API_URL: 'https://api.instapay-gw.example/v1', INSTAPAY_API_KEY: 'ipay_key_dummy_0001', INSTAPAY_WEBHOOK_SECRET: 'ipay_whsec_dummy_0123456789' } as Record<string, string>;

export const paymobTxn = (paymentId: string, o: Record<string, unknown> = {}) => { const t = fixture('paymob-transaction-success.json', { PAYMENT_ID: paymentId }); return { ...t, ...o, order: { ...t.order, ...((o.order as object) ?? {}) }, source_data: { ...t.source_data, ...((o.source_data as object) ?? {}) } }; };
/** A signed Paymob processed callback: body + the `hmac` query parameter. */
export const paymobCallback = (obj: Record<string, unknown>, secret = PAYMOB_ENV.PAYMOB_HMAC_SECRET) => ({ raw: JSON.stringify({ type: 'TRANSACTION', obj }), query: { hmac: paymobHmac(secret, obj) } });
export const fawryCallback = (paymentId: string, o: Record<string, unknown> = {}, key = FAWRY_ENV.FAWRY_SECURE_KEY) => { const b: any = { ...fixture('fawry-callback-paid.json', { PAYMENT_ID: paymentId, SIGNATURE: '' }), ...o }; b.messageSignature = fawryCallbackSignature(key, b); return JSON.stringify(b); };
export const cardgwEvent = (name: string, paymentId: string, pspRef: string, o: Record<string, unknown> = {}) => ({ ...fixture(name, { PAYMENT_ID: paymentId }), paymentRef: pspRef, ...o });
export const cardgwSigned = (evt: object, secret = CARDGW_ENV.CARDGW_WEBHOOK_SECRET, now = Math.floor(Date.now() / 1000)) => { const raw = JSON.stringify(evt); return { raw, headers: signedWebhookHeaders(secret, raw, now) }; };
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export { createHmac };

export interface FakeCall { url: string; method: string; headers: Record<string, string>; body: any }
/** Scripted vendor HTTP: replies are matched by (method, path substring) in order, requests are captured. A reply may be a function of the request. */
export function fakeVendor(routes: Array<{ match: string | RegExp; method?: string; reply: Array<{ status?: number; json?: unknown } | ((c: FakeCall) => { status?: number; json?: unknown })> }>) {
  const calls: FakeCall[] = [];
  const fn = async (url: string, init: RequestInit = {}) => {
    const raw = typeof init.body === 'string' ? init.body : ''; let body: any = raw; try { body = JSON.parse(raw); } catch { /* empty */ }
    const headers: Record<string, string> = {}; new Headers(init.headers).forEach((v, k) => { headers[k] = v; });
    const call: FakeCall = { url, method: (init.method ?? 'GET').toUpperCase(), headers, body }; calls.push(call);
    const r = routes.find((x) => (typeof x.match === 'string' ? url.includes(x.match) : x.match.test(url)) && (!x.method || x.method.toUpperCase() === call.method));
    if (!r) return new Response(JSON.stringify({ error: 'no route' }), { status: 599 });
    const next = r.reply.length > 1 ? r.reply.shift()! : r.reply[0]; const out = typeof next === 'function' ? next(call) : next;
    return new Response(JSON.stringify(out.json ?? {}), { status: out.status ?? 200, headers: { 'content-type': 'application/json' } });
  };
  return { fn: fn as unknown as (u: string, i?: RequestInit) => Promise<Response>, calls, count: (m: string, sub: string) => calls.filter((c) => c.method === m && c.url.includes(sub)).length };
}
