import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { growthKey } from '../common/privacy-hash';

/**
 * Widget session token (`kxw1.<payload>.<sig>`): short-lived, HMAC-SHA256, bound to ONE embedding origin and ONE registration. It proves "the widget was started for
 * this organisation by a page of this origin"; it is not an identity and carries no personal data. The key is derived from FIELD_ENCRYPTION_KEY (no new secret).
 * Revocation: the origin is re-checked against the live allow-list on every use, so removing an origin ends its tokens at once.
 */
export interface WidgetTokenClaims { v: 1; org: string; origin: string; iat: number; exp: number; n: string; sbx?: 1 }
const PREFIX = 'kxw1';
const key = () => growthKey('widget-session-token');
const sign = (body: string) => createHmac('sha256', key()).update(`${PREFIX}.${body}`).digest('base64url');

export function issueWidgetToken(c: { org: string; origin: string; sandbox?: boolean }, ttlSeconds: number, now = Date.now()): { token: string; expiresAt: string } {
  const iat = Math.floor(now / 1000);
  const claims: WidgetTokenClaims = { v: 1, org: c.org, origin: c.origin.toLowerCase(), iat, exp: iat + ttlSeconds, n: randomBytes(8).toString('base64url'), ...(c.sandbox ? { sbx: 1 as const } : {}) };
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return { token: `${PREFIX}.${body}.${sign(body)}`, expiresAt: new Date(claims.exp * 1000).toISOString() };
}

export type TokenCheck = { ok: true; claims: WidgetTokenClaims } | { ok: false; reason: 'MALFORMED' | 'BAD_SIGNATURE' | 'EXPIRED' };
export function verifyWidgetToken(token: unknown, now = Date.now()): TokenCheck {
  if (typeof token !== 'string' || token.length > 1024) return { ok: false, reason: 'MALFORMED' };
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) return { ok: false, reason: 'MALFORMED' };
  const expected = Buffer.from(sign(parts[1]!)); const got = Buffer.from(parts[2]!);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return { ok: false, reason: 'BAD_SIGNATURE' };
  let c: WidgetTokenClaims;
  try { c = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')); } catch { return { ok: false, reason: 'MALFORMED' }; }
  if (c?.v !== 1 || typeof c.org !== 'string' || typeof c.origin !== 'string' || typeof c.exp !== 'number') return { ok: false, reason: 'MALFORMED' };
  if (c.exp * 1000 <= now) return { ok: false, reason: 'EXPIRED' };
  return { ok: true, claims: c };
}
