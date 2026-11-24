import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Signed, short-lived in-session link token `lt` (ARCH section 6.2, threat table: "forged provider token"). It lets a visitor who opened a provider's
 * link book with that provider in the same session WITHOUT any cookie or stored identifier. It is bound to the organisation, the link code and a
 * time window; it carries no person, no IP, no health data. A token is opaque to the browser. Lifetime is capped at 30 minutes.
 * Pure: the key and the clock are arguments, so tests need no environment.
 */
export const LT_PREFIX = 'kxl1';
export const LT_MAX_TTL_SECONDS = 30 * 60;

export interface LinkTokenClaims { org: string; code: string; iat: number; exp: number; n: string }
export type LinkTokenResult = { ok: true; claims: LinkTokenClaims } | { ok: false; reason: 'INVALID' | 'EXPIRED' };

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const sig = (key: Buffer, payload: string) => createHmac('sha256', key).update(`${LT_PREFIX}.${payload}`).digest();

export function issueLinkToken(key: Buffer, i: { orgRef: string; linkCode: string; ttlSeconds?: number; now?: number; nonce?: string }): string {
  const now = Math.floor((i.now ?? Date.now()) / 1000);
  const ttl = Math.min(Math.max(1, Math.floor(i.ttlSeconds ?? LT_MAX_TTL_SECONDS)), LT_MAX_TTL_SECONDS);
  const claims: LinkTokenClaims = { org: i.orgRef, code: i.linkCode, iat: now, exp: now + ttl, n: i.nonce ?? randomBytes(6).toString('base64url') };
  const payload = b64(JSON.stringify(claims));
  return `${LT_PREFIX}.${payload}.${b64(sig(key, payload))}`;
}

export function verifyLinkToken(key: Buffer | null, token: unknown, now = Date.now()): LinkTokenResult {
  if (!key) return { ok: false, reason: 'INVALID' };
  if (typeof token !== 'string' || token.length > 512) return { ok: false, reason: 'INVALID' };
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== LT_PREFIX) return { ok: false, reason: 'INVALID' };
  const expected = sig(key, parts[1]!);
  let given: Buffer;
  try { given = Buffer.from(parts[2]!, 'base64url'); } catch { return { ok: false, reason: 'INVALID' }; }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: 'INVALID' };
  let c: LinkTokenClaims;
  try { c = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as LinkTokenClaims; } catch { return { ok: false, reason: 'INVALID' }; }
  if (typeof c.org !== 'string' || typeof c.code !== 'string' || !Number.isFinite(c.iat) || !Number.isFinite(c.exp) || c.exp - c.iat > LT_MAX_TTL_SECONDS) return { ok: false, reason: 'INVALID' };
  if (Math.floor(now / 1000) >= c.exp || Math.floor(now / 1000) < c.iat - 60) return { ok: false, reason: 'EXPIRED' };
  return { ok: true, claims: c };
}

/**
 * The token the Clinic itself issues for provider links, QR codes and widgets (clinics-management `growth/provider-links/link-touch.ts`, ARCH 4.2): `<base64url claims>.<base64url sig>`,
 * claims `{o: tenant id, c: 8-char link code, t: issued-at ms, v: 1}`, HMAC-SHA256 over `"kx-lt1\n" + payload`, 72 h lifetime. Same verdicts as `verifyLinkToken`, normalised to
 * `{org, code}` claims so one decision function reads both formats. Pure: key and clock are arguments.
 */
export const PROVIDER_LT_PREFIX = 'kx-lt1\n';
export const PROVIDER_LT_TTL_MS = 72 * 60 * 60 * 1000;
const CROCKFORD = /^[0-9A-HJKMNP-TV-Z]{8}$/;

export function signProviderLinkTouch(secret: string, i: { orgRef: string; code: string; now?: number }): string {
  const payload = b64(JSON.stringify({ o: i.orgRef, c: i.code.toUpperCase(), t: i.now ?? Date.now(), v: 1 }));
  return `${payload}.${createHmac('sha256', secret).update(PROVIDER_LT_PREFIX + payload).digest('base64url')}`;
}

export type ProviderLinkTouchResult = { ok: true; claims: { org: string; code: string; iat: number } } | { ok: false; reason: 'INVALID' | 'EXPIRED' };

export function verifyProviderLinkTouch(secret: string | null, token: unknown, now = Date.now()): ProviderLinkTouchResult {
  if (!secret || typeof token !== 'string' || token.length > 600) return { ok: false, reason: 'INVALID' };
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'INVALID' };
  const expected = Buffer.from(createHmac('sha256', secret).update(PROVIDER_LT_PREFIX + parts[0]).digest('base64url'));
  const given = Buffer.from(parts[1]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: 'INVALID' };
  let c: { o?: unknown; c?: unknown; t?: unknown; v?: unknown };
  try { c = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { return { ok: false, reason: 'INVALID' }; }
  if (!c || c.v !== 1 || typeof c.o !== 'string' || !c.o || typeof c.t !== 'number' || typeof c.c !== 'string' || !CROCKFORD.test(c.c.toUpperCase())) return { ok: false, reason: 'INVALID' };
  if (c.t > now + 5 * 60_000 || now - c.t > PROVIDER_LT_TTL_MS) return { ok: false, reason: 'EXPIRED' };
  return { ok: true, claims: { org: c.o, code: c.c.toUpperCase(), iat: Math.floor(c.t / 1000) } };
}

/** Either format. `kxl1.*` is the in-session token minted by Kiorex tooling; anything else is tried as the Clinic's provider-link token. */
export function verifyAnyLinkToken(keys: { kxl1: Buffer | null; provider: string | null }, token: unknown, now = Date.now()): { ok: true; claims: { org: string; code: string }; format: 'KXL1' | 'PROVIDER_LT' } | { ok: false; reason: 'INVALID' | 'EXPIRED' } {
  if (typeof token === 'string' && token.startsWith(`${LT_PREFIX}.`)) { const r = verifyLinkToken(keys.kxl1, token, now); return r.ok ? { ok: true, claims: { org: r.claims.org, code: r.claims.code }, format: 'KXL1' } : r; }
  const r = verifyProviderLinkTouch(keys.provider, token, now);
  return r.ok ? { ok: true, claims: { org: r.claims.org, code: r.claims.code }, format: 'PROVIDER_LT' } : r;
}
