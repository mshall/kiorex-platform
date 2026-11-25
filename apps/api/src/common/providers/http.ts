import type { ProviderEnv } from './env';

export type ProviderErrorCode =
  | 'TIMEOUT' | 'NETWORK' | 'RATE_LIMITED' | 'UNAUTHORIZED' | 'REJECTED' | 'INVALID_REQUEST' | 'PROVIDER_UNAVAILABLE' | 'BAD_RESPONSE';

/** Error mapped from a vendor failure. `message` is safe to store/log: it never contains URLs with credentials, keys or bodies. */
export class ProviderError extends Error {
  constructor(public readonly code: ProviderErrorCode, public readonly retryable: boolean, public readonly status?: number, public readonly attempts = 1, /** vendor's numeric/short error code from the error body (never the message text); lets adapters classify (e.g. Meta 131047) */ public readonly vendorCode?: string) {
    super(`PROVIDER_${code}${status ? `_${status}` : ''}`);
    this.name = 'ProviderError';
  }
}

export interface ProviderRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Path appended to <KIND>_API_URL. */
  path: string;
  body?: unknown;
  /** application/x-www-form-urlencoded body (Twilio-style); takes precedence over `body`. */
  form?: Record<string, string>;
  /** Absolute URL override (vendor hosts that differ from <KIND>_API_URL, e.g. the FCM OAuth token endpoint). */
  absoluteUrl?: string;
  /** Per-attempt request signing (AWS SigV4 etc.): receives the final method/url/body string, returns extra headers. */
  sign?: (r: { method: string; url: string; body: string }) => Record<string, string>;
  headers?: Record<string, string>;
  /** Sent as `Idempotency-Key` on every attempt of this request, so a retried send can never double-charge / double-send. */
  idempotencyKey?: string;
}
export interface ProviderResponse { status: number; json: any; headers: Headers; attempts: number }
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export interface HttpDeps {
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  /** 0..1 jitter source (tests pin it). */
  random?: () => number;
}

export function mapStatus(status: number): { code: ProviderErrorCode; retryable: boolean } {
  if (status === 429) return { code: 'RATE_LIMITED', retryable: true };
  if (status === 401 || status === 403) return { code: 'UNAUTHORIZED', retryable: false };
  if (status === 408) return { code: 'TIMEOUT', retryable: true };
  if (status >= 500) return { code: 'PROVIDER_UNAVAILABLE', retryable: true };
  if (status === 422 || status === 400) return { code: 'INVALID_REQUEST', retryable: false };
  return { code: 'REJECTED', retryable: false };
}

/** Short vendor error code from a JSON error body (Meta `error.code`, generic `code` / `errors[0].code`). Only a bounded token is kept, never text. */
export function vendorCodeOf(text: string): string | undefined {
  try {
    const j = JSON.parse(text); const c = j?.error?.code ?? j?.errors?.[0]?.code ?? j?.code;
    return (typeof c === 'number' || typeof c === 'string') && /^[A-Za-z0-9_.-]{1,40}$/.test(String(c)) ? String(c) : undefined;
  } catch { return undefined; }
}

const BASE_DELAY_MS = 250;
const MAX_DELAY_MS = 5000;

/** Single HTTP call with timeout, retries (network / timeout / 429 / 5xx) with exponential backoff + jitter, idempotency key, error mapping. */
export async function providerRequest(env: ProviderEnv, req: ProviderRequest, deps: HttpDeps = {}, authHeaders: Record<string, string> = {}): Promise<ProviderResponse> {
  const f = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const rnd = deps.random ?? Math.random;
  const url = req.absoluteUrl ?? `${env.apiUrl}${req.path.startsWith('/') ? '' : '/'}${req.path}`;
  const method = req.method ?? 'POST';
  const bodyStr = req.form ? new URLSearchParams(req.form).toString() : req.body === undefined ? undefined : JSON.stringify(req.body);
  const headers: Record<string, string> = { accept: 'application/json', ...(req.form ? { 'content-type': 'application/x-www-form-urlencoded' } : req.body !== undefined ? { 'content-type': 'application/json' } : {}), ...authHeaders, ...req.headers };
  if (req.idempotencyKey) headers['idempotency-key'] = req.idempotencyKey;
  const max = env.maxRetries + 1;
  let last: ProviderError | undefined;
  for (let attempt = 1; attempt <= max; attempt++) {
    let retryAfterMs = 0;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), env.timeoutMs);
    try {
      const signed = req.sign ? req.sign({ method, url, body: bodyStr ?? '' }) : {};
      const res = await f(url, { method, headers: { ...headers, ...signed }, body: bodyStr, signal: ctl.signal });
      const text = await res.text();
      if (res.ok) {
        let json: any = {};
        if (text) { try { json = JSON.parse(text); } catch { throw new ProviderError('BAD_RESPONSE', false, res.status, attempt); } }
        return { status: res.status, json, headers: res.headers, attempts: attempt };
      }
      const m = mapStatus(res.status);
      const ra = Number(res.headers.get('retry-after'));
      if (Number.isFinite(ra) && ra > 0) retryAfterMs = Math.min(ra * 1000, MAX_DELAY_MS);
      last = new ProviderError(m.code, m.retryable, res.status, attempt, vendorCodeOf(text));
    } catch (e) {
      if (e instanceof ProviderError) { last = e; if (!e.retryable) throw e; } // BAD_RESPONSE on a 2xx is final: the vendor did process it
      else last = new ProviderError((e as Error)?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK', true, undefined, attempt);
    } finally { clearTimeout(timer); }
    if (!last.retryable || attempt === max) break;
    const backoff = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (attempt - 1));
    await sleep(Math.max(retryAfterMs, backoff / 2 + rnd() * (backoff / 2)));
  }
  throw new ProviderError(last!.code, last!.retryable, last!.status, last!.attempts, last!.vendorCode);
}
