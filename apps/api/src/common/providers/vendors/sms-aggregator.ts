import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Generic Egyptian SMS aggregator adapter (SMS_PROVIDER=aggregator). Egyptian bulk-SMS aggregators (Vodafone / Orange / Etisalat / WE resellers: SMS Misr,
 * Victory Link, Door, Cequens and similar) all do the same thing in slightly different clothes: an HTTPS call with credentials, a sender name, a mobile number in a
 * national or international format, a language / Unicode switch for Arabic, a text, and a delivery report (DLR) callback. The wire format is therefore DATA, not code:
 * the non-secret description below lives in the MESSAGING_CHANNELS config (`channels.SMS.aggregator`) or SMS_AGGREGATOR_CONFIG (JSON env), the credential in SMS_API_KEY
 * (`user:password` or a token; from Secrets Manager). Going live with another aggregator is a config change, not a code change. The two mocks in the tests are
 * modelled on the two most common shapes (query/body credentials with a JSON answer, and bearer token with our own message id).
 *
 * VERIFY AT GO-LIVE with the chosen aggregator's own documentation: field names, success codes, Unicode switch, registered sender-name rules and DLR statuses.
 */
export interface AggregatorConfig {
  /** Path appended to SMS_API_URL, e.g. `/api/SMS/`. */
  path?: string;
  /** POST body encoding. */
  encoding?: 'json' | 'form' | 'query';
  /** How the SMS_API_KEY is presented: bearer, basic (`user:pass`), `body` / `query` (user + password fields), `header:<Name>` (raw key). */
  auth?: 'bearer' | 'basic' | 'body' | 'query' | `header:${string}`;
  /** Field names on the wire. */
  fields?: { to?: string; from?: string; text?: string; reference?: string; callback?: string; username?: string; password?: string; language?: string };
  /** Constant, NON-SECRET fields added to every request (e.g. environment: '1'). */
  fixed?: Record<string, string>;
  /** Mobile number format on the wire. e164 `+2010..`, `intl` `2010..`, `local` `010..`. */
  toFormat?: 'e164' | 'intl' | 'local';
  /** Value of the `language` field for Arabic (Unicode) and Latin (GSM) text. */
  unicode?: { arabic: string; latin: string };
  /** Success detection on the 2xx answer: `idPath` holds the aggregator's message id; `okPath` must equal one of `okValues` (string compare). */
  response?: { idPath?: string; okPath?: string; okValues?: string[]; idFromReference?: boolean };
  /** Delivery report callback: field names, status words -> our states, and the verification scheme. */
  dlr?: { idField?: string; statusField?: string; errorField?: string; statusMap?: Record<string, 'SENT' | 'DELIVERED' | 'FAILED'>; verify?: 'token' | 'hmac' | 'basic'; tokenName?: string; hmacHeader?: string };
}

export const AGGREGATOR_DEFAULTS: Required<Pick<AggregatorConfig, 'path' | 'encoding' | 'auth' | 'toFormat'>> & { fields: Required<NonNullable<AggregatorConfig['fields']>>; response: Required<NonNullable<AggregatorConfig['response']>>; dlr: Required<NonNullable<AggregatorConfig['dlr']>> } = {
  path: '/sms/send', encoding: 'json', auth: 'bearer', toFormat: 'intl',
  fields: { to: 'to', from: 'from', text: 'text', reference: 'reference', callback: 'callback', username: 'username', password: 'password', language: 'language' },
  response: { idPath: 'id', okPath: '', okValues: [], idFromReference: false },
  dlr: { idField: 'id', statusField: 'status', errorField: 'error', statusMap: { delivered: 'DELIVERED', delivrd: 'DELIVERED', '1': 'DELIVERED', sent: 'SENT', submitted: 'SENT', accepted: 'SENT', failed: 'FAILED', undelivered: 'FAILED', undeliv: 'FAILED', rejected: 'FAILED', expired: 'FAILED', '0': 'FAILED' }, verify: 'token', tokenName: 'token', hmacHeader: 'x-signature' },
};

let holder: AggregatorConfig | undefined;
/** The hub sets the effective config after each MESSAGING_CHANNELS refresh. */
export const setAggregatorConfig = (c: AggregatorConfig | undefined): void => { holder = c; };
export function aggregatorConfig(env: Record<string, string | undefined> = process.env): AggregatorConfig {
  if (holder) return holder;
  try { const j = JSON.parse(env.SMS_AGGREGATOR_CONFIG ?? '{}'); return j && typeof j === 'object' && !Array.isArray(j) ? j : {}; } catch { return {}; }
}
const merged = (c: AggregatorConfig) => ({
  ...AGGREGATOR_DEFAULTS, ...c,
  fields: { ...AGGREGATOR_DEFAULTS.fields, ...(c.fields ?? {}) }, response: { ...AGGREGATOR_DEFAULTS.response, ...(c.response ?? {}) }, dlr: { ...AGGREGATOR_DEFAULTS.dlr, ...(c.dlr ?? {}), statusMap: { ...AGGREGATOR_DEFAULTS.dlr.statusMap, ...(c.dlr?.statusMap ?? {}) } },
});

/** +20 10 1234 5678 in the aggregator's format. Non-Egyptian numbers are only reformatted (intl / e164), never rewritten to a local format. */
export function formatMobile(e164: string, f: NonNullable<AggregatorConfig['toFormat']>): string {
  const digits = e164.replace(/[^\d]/g, '');
  if (f === 'e164') return `+${digits}`;
  if (f === 'local') return digits.startsWith('20') && digits.length === 12 ? `0${digits.slice(2)}` : `+${digits}`;
  return digits;
}
export const isArabicText = (s: string) => /[؀-ۿݐ-ݿ]/.test(s);
const dig = (o: any, path: string): unknown => path.split('.').reduce((a, k) => (a === undefined || a === null ? undefined : a[k]), o);

/** GSM-7 vs UCS-2 and the segment count (160 / 153 GSM, 70 / 67 Unicode): for the cost guard and the ops preview. */
export function smsSegments(text: string): { encoding: 'GSM7' | 'UCS2'; segments: number; length: number } {
  const ucs = /[^\x20-\x7E\n\r]/.test(text); const len = Array.from(text).length;
  const single = ucs ? 70 : 160; const multi = ucs ? 67 : 153;
  return { encoding: ucs ? 'UCS2' : 'GSM7', segments: len <= single ? 1 : Math.ceil(len / multi), length: len };
}

export function aggregatorBuildSend(c: AggregatorConfig, i: { to: string; from: string; text: string; reference: string; apiKey: string; callback?: string }): { path: string; body?: unknown; form?: Record<string, string>; headers?: Record<string, string> } {
  const m = merged(c); const f = m.fields;
  const params: Record<string, string> = { ...(c.fixed ?? {}), [f.to]: formatMobile(i.to, m.toFormat), [f.from]: i.from, [f.text]: i.text, [f.reference]: i.reference };
  if (i.callback) params[f.callback] = i.callback;
  if (m.unicode) params[f.language] = isArabicText(i.text) ? m.unicode.arabic : m.unicode.latin;
  const headers: Record<string, string> = {};
  const auth = m.auth;
  if (auth === 'bearer') headers.authorization = `Bearer ${i.apiKey}`;
  else if (auth === 'basic') headers.authorization = `Basic ${Buffer.from(i.apiKey).toString('base64')}`;
  else if (auth.startsWith('header:')) headers[auth.slice(7).toLowerCase()] = i.apiKey;
  else { const k = i.apiKey.indexOf(':'); params[f.username] = k > 0 ? i.apiKey.slice(0, k) : i.apiKey; if (k > 0) params[f.password] = i.apiKey.slice(k + 1); }
  if (m.encoding === 'json') return { path: m.path, body: params, headers };
  if (m.encoding === 'form') return { path: m.path, form: params, headers };
  const qs = new URLSearchParams(params).toString(); // credentials in the query string: only for aggregators that force it; the URL is never logged by the client
  return { path: `${m.path}${m.path.includes('?') ? '&' : '?'}${qs}`, headers };
}

export function aggregatorParseSend(c: AggregatorConfig, json: any, reference: string): { providerRef: string } {
  const r = merged(c).response;
  if (r.okPath) {
    const ok = String(dig(json, r.okPath) ?? '');
    if (!r.okValues.map(String).includes(ok)) throw new Error('aggregator did not accept the message');
  }
  if (r.idFromReference) return { providerRef: reference };
  const id = dig(json, r.idPath);
  if ((typeof id !== 'string' && typeof id !== 'number') || String(id) === '') throw new Error('no message id in aggregator response');
  return { providerRef: String(id) };
}

const eq = (a: string, b: string) => { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const hv = (h: Record<string, unknown>, n: string) => { const v = h[n.toLowerCase()]; return Array.isArray(v) ? String(v[0] ?? '') : String(v ?? ''); };

/** DLR verification. `token`: shared secret as query parameter (or `x-dlr-token` header); `hmac`: sha256 of the raw body in a header; `basic`: HTTP basic password. Unsigned callbacks are refused. */
export function aggregatorVerifyDlr(c: AggregatorConfig, secret: string, rawBody: string, headers: Record<string, unknown>, query: Record<string, unknown> = {}): boolean {
  if (!secret) return false;
  const d = merged(c).dlr;
  if (d.verify === 'hmac') { const sig = hv(headers, d.hmacHeader).replace(/^sha256=/, ''); return !!sig && eq(sig, createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')); }
  if (d.verify === 'basic') { const a = hv(headers, 'authorization'); if (!a.startsWith('Basic ')) return false; return eq(Buffer.from(a.slice(6), 'base64').toString('utf8').split(':').slice(1).join(':'), secret); }
  const got = String(query[d.tokenName] ?? '') || hv(headers, 'x-dlr-token');
  return !!got && eq(got, secret);
}

export function aggregatorParseDlr(c: AggregatorConfig, raw: string, contentType = ''): Array<{ providerRef: string; status: 'SENT' | 'DELIVERED' | 'FAILED'; error?: string; occurredAt?: string }> {
  const d = merged(c).dlr;
  let rows: any[] = [];
  const t = raw.trim();
  try {
    if (t.startsWith('{') || t.startsWith('[')) { const j = JSON.parse(t); rows = Array.isArray(j) ? j : Array.isArray(j?.events) ? j.events : Array.isArray(j?.reports) ? j.reports : [j]; }
    else if (t) rows = [Object.fromEntries(new URLSearchParams(t).entries())];
  } catch { return []; }
  void contentType;
  const out: Array<{ providerRef: string; status: 'SENT' | 'DELIVERED' | 'FAILED'; error?: string; occurredAt?: string }> = [];
  for (const r of rows) {
    const id = dig(r, d.idField); const st = String(dig(r, d.statusField) ?? '').trim().toLowerCase();
    const status = d.statusMap[st]; if (!status || id === undefined || String(id) === '') continue;
    const err = dig(r, d.errorField);
    out.push({ providerRef: String(id), status, ...(status === 'FAILED' ? { error: `SMS_${String(err ?? st).toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 40)}` } : {}) });
  }
  return out;
}
