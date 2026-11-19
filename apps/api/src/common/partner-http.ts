import { signKiorlyRequest } from './hmac';

/** A definitive 4xx answer from a partner product (Kiorly Pharmacy / Kiorly Lab). */
export class PartnerHttpError extends Error {
  constructor(public readonly status: number, public readonly code: string | undefined, public readonly body: any) {
    super(`partner ${status}${code ? ` ${code}` : ''}`);
  }
}
/** Network error, timeout, 5xx or 429: outcome unknown / partner unavailable. Callers retry via the outbox, never with a new key. */
export class PartnerTransientError extends Error {
  constructor(message: string, public readonly kind: 'TIMEOUT' | 'NETWORK' | 'HTTP_5XX', public readonly status?: number) { super(message); }
}

export interface PartnerConn { baseUrl: string; clientKey: string; clientSecret: string; timeoutMs: number }
export interface PartnerReq { method: string; path: string; query?: Record<string, string | number | undefined>; body?: unknown; idempotencyKey?: string }

/** HMAC REST call, same signing scheme as the Kiorly marketplace client (KX-09 §02). */
export async function partnerRequest<T = any>(c: PartnerConn, r: PartnerReq): Promise<{ status: number; data: T }> {
  const base = c.baseUrl.replace(/\/$/, '');
  const qs = r.query ? '?' + new URLSearchParams(Object.entries(r.query).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString() : '';
  const url = `${base}${r.path}${qs}`;
  const body = r.body === undefined ? undefined : JSON.stringify(r.body);
  const signed = signKiorlyRequest({ clientKey: c.clientKey, clientSecret: c.clientSecret, method: r.method, path: new URL(url).pathname, body });
  const headers: Record<string, string> = { ...signed.headers, accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (r.idempotencyKey) headers['idempotency-key'] = r.idempotencyKey;
  let res: Response;
  try {
    res = await fetch(url, { method: r.method, headers, body, signal: AbortSignal.timeout(c.timeoutMs) });
  } catch (e) {
    const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw new PartnerTransientError(timeout ? 'timeout' : `network: ${(e as Error).message}`, timeout ? 'TIMEOUT' : 'NETWORK');
  }
  const text = await res.text();
  let data: any;
  try { data = text ? JSON.parse(text) : undefined; } catch { data = { raw: text.slice(0, 200) }; }
  if (res.status >= 500 || res.status === 429) throw new PartnerTransientError(`HTTP ${res.status}`, 'HTTP_5XX', res.status);
  if (res.status >= 400) throw new PartnerHttpError(res.status, data?.code, data);
  return { status: res.status, data: data as T };
}
