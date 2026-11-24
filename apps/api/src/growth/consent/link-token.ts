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

export function verifyLinkToken(key: Buffer, token: unknown, now = Date.now()): LinkTokenResult {
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
