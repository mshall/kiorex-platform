import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FetchLike } from '../common/providers/http';

/**
 * Fixture recorder for the FIRST real sandbox run. With PAYMENT_RECORD_FIXTURES_DIR set (never in production) every vendor request and response is written as a JSON file with all credentials
 * REDACTED (authorization / key headers, secret-looking body fields, signatures in URLs). The founder commits the recordings under apps/api/test/fixtures/pay and the shape tests then run against
 * what the vendor really sends. A recording failure never affects the payment.
 */
const SECRET_KEY = /(authorization|api[-_]?key|secret|token|password|signature|hmac|cvv|card[-_]?number|pan)$/i;
export function redact(v: unknown, depth = 0): unknown {
  if (depth > 8) return '[deep]';
  if (Array.isArray(v)) return v.map((x) => redact(x, depth + 1));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, SECRET_KEY.test(k) && !/^(is_|has_)/.test(k) ? '[REDACTED]' : redact(x, depth + 1)]));
  return typeof v === 'string' && v.length > 2000 ? `${v.slice(0, 2000)}[cut]` : v;
}
export const redactUrl = (u: string) => u.replace(/([?&](?:signature|hmac|token|key|secret)[^=]*=)[^&]*/gi, '$1[REDACTED]');
export function recordingFetch(inner: FetchLike, env: Record<string, string | undefined> = process.env): FetchLike {
  const dir = env.PAYMENT_RECORD_FIXTURES_DIR; if (!dir || env.NODE_ENV === 'production') return inner;
  let n = 0;
  return async (url, init) => {
    const res = await inner(url, init);
    try {
      const text = await res.clone().text(); let body: unknown = text; try { body = JSON.parse(text); } catch { /* not json */ }
      let req: unknown = init?.body; if (typeof req === 'string') { try { req = JSON.parse(req); } catch { /* not json */ } }
      const h: Record<string, string> = {}; new Headers(init?.headers).forEach((v, k) => { h[k] = SECRET_KEY.test(k) ? '[REDACTED]' : v; });
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${String(Date.now())}-${String(++n).padStart(3, '0')}-${(init?.method ?? 'GET').toLowerCase()}.recorded.json`), JSON.stringify({ request: { method: init?.method ?? 'GET', url: redactUrl(String(url)), headers: h, body: redact(req) }, response: { status: res.status, body: redact(body) } }, null, 2));
    } catch { /* never affects the payment */ }
    return res;
  };
}
