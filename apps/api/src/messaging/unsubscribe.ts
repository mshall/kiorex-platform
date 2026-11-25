import { createHmac, timingSafeEqual } from 'node:crypto';
import { cfg } from '../common/config';
import { addressHash, growthKey } from '../common/privacy-hash';

/**
 * One-click unsubscribe (RFC 8058) for marketing e-mail. The token is a signed, self-contained claim: the keyed HASH of the address (never the address), the market, an
 * optional subject and an expiry. The mail provider (Gmail, Yahoo) POSTs `List-Unsubscribe=One-Click` to the URL without any login; the handler adds the address to the
 * suppression list. Links stay valid for 180 days. Tokens for another purpose can never verify (domain-separated key).
 */
export interface UnsubClaim { ah: string; market: string; sub?: string; exp: number }
const key = () => growthKey('email-unsubscribe');
const b64 = (s: string) => Buffer.from(s).toString('base64url');

export function signUnsubscribeToken(i: { address: string; market?: string; sub?: string; ttlDays?: number }, nowMs = Date.now()): string {
  const claim: UnsubClaim = { ah: addressHash(i.address), market: i.market ?? 'EG', ...(i.sub ? { sub: i.sub } : {}), exp: nowMs + (i.ttlDays ?? 180) * 86_400_000 };
  const body = b64(JSON.stringify(claim));
  return `u1.${body}.${createHmac('sha256', key()).update(`u1.${body}`).digest('base64url')}`;
}
export function verifyUnsubscribeToken(token: string, nowMs = Date.now()): UnsubClaim | null {
  const [v, body, sig] = token.split('.');
  if (v !== 'u1' || !body || !sig) return null;
  const expect = createHmac('sha256', key()).update(`u1.${body}`).digest('base64url');
  const a = Buffer.from(sig); const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try { const c = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as UnsubClaim; return typeof c.ah === 'string' && typeof c.exp === 'number' && c.exp > nowMs ? c : null; } catch { return null; }
}
export const unsubscribeUrlFor = (token: string): string => `${cfg().publicBaseUrl.replace(/\/+$/, '')}/api/v1/messaging/unsubscribe/${token}`;
