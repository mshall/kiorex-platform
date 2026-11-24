import { createHash, createHmac, randomBytes } from 'node:crypto';
import { cfg } from './config';

/**
 * Keyed hashing for the growth and consent family (shared kernel so patient, engagement and growth can use it without importing each other).
 * No new secret to provision: every key is derived from FIELD_ENCRYPTION_KEY with a domain label, so a value hashed for one purpose can never be
 * matched against another. Nothing here stores or logs an IP address, phone number or e-mail address: callers keep only the hash.
 */
export const growthKey = (label: string): Buffer => createHmac('sha256', cfg().fieldKey).update(`kiorex-growth:${label}`).digest();

/** Daily-rotating keyed hash of the client IP (rate limits, fraud rules and the consent audit; blanked from touches after 24 h by growth_purge_expired). */
export function ipHashOf(ip: string | undefined, now = new Date()): string {
  const day = now.toISOString().slice(0, 10);
  return createHmac('sha256', growthKey(`ip:${day}`)).update(ip ?? 'unknown').digest('base64url').slice(0, 32);
}

/** Stable keyed hash of a phone number or e-mail address for the suppression list (case and spacing normalised; no rotation: it must match later). */
export function addressHash(address: string): string {
  const n = address.trim().toLowerCase().replace(/[\s()-]/g, '');
  return createHmac('sha256', growthKey('address')).update(n).digest('base64url');
}

/** Opaque subject reference for internal events: stable, keyed, never the Passport sub itself. */
export const subRefOf = (sub: string): string => createHmac('sha256', growthKey('subref')).update(sub).digest('base64url').slice(0, 32);

export const sha256Hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
export const randomToken = (bytes = 16) => randomBytes(bytes).toString('base64url');
