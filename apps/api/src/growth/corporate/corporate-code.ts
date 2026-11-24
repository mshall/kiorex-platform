import { createHmac, randomInt } from 'node:crypto';
import { growthKey } from '../../common/privacy-hash';

/**
 * Corporate redemption codes (GRW-P4-C). Crockford base32 without I, L, O and U, so a code read over the phone or from a poster cannot be mistyped into another valid code.
 * Only the keyed hash is stored (the plain code is shown once to the ops user who creates it). Input is forgiving (case, hyphens, spaces, the Crockford look-alikes 0/O and 1/I/L),
 * the hash is taken over the normalised form, so every spelling of one code maps to one hash. Pure apart from the key derivation.
 */
export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const DEFAULT_CODE_LENGTH = 10;

export interface CodeFormat { length: number; groupSize: number }

export function generateCode(format: CodeFormat = { length: DEFAULT_CODE_LENGTH, groupSize: 5 }, rnd: (n: number) => number = (n) => randomInt(n)): string {
  if (!Number.isInteger(format.length) || format.length < 8 || format.length > 16) throw new RangeError('code length must be 8..16');
  let s = '';
  for (let i = 0; i < format.length; i++) s += CODE_ALPHABET[rnd(CODE_ALPHABET.length)];
  return formatCode(s, format.groupSize);
}

export function formatCode(normalised: string, groupSize: number): string {
  if (!groupSize || groupSize < 1) return normalised;
  return normalised.match(new RegExp(`.{1,${groupSize}}`, 'g'))!.join('-');
}

/** Upper-case, drop separators, map the look-alikes. Returns null for anything that cannot be a code (wrong characters or length). */
export function normaliseCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const s = input.normalize('NFKC').toUpperCase().replace(/[\s\-_.]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length < 8 || s.length > 16) return null;
  for (const ch of s) if (!CODE_ALPHABET.includes(ch)) return null;
  return s;
}

/** Keyed hash under its own label: a value hashed for another purpose (referral codes, phone numbers) can never match. */
export function hashCode(normalised: string): string {
  return createHmac('sha256', growthKey('corporate-code')).update(normalised).digest('base64url');
}

/** Stable keyed hash of a person for the member table (never the Passport sub itself; one-way, only this module and the maintenance service compute it). */
export function memberHashOf(sub: string): string {
  return createHmac('sha256', growthKey('corporate-member')).update(sub).digest('base64url');
}

/** Keyed hash of a phone number or e-mail address for HR lists (normalised first, own label). */
export function hrKeyHash(address: string): string {
  const n = address.trim().toLowerCase().replace(/[\s()-]/g, '');
  return createHmac('sha256', growthKey('corporate-hr')).update(n).digest('base64url');
}

/** Domain of an e-mail address (lower-case), or null. */
export function emailDomain(email: string | undefined): string | null {
  if (!email) return null;
  const m = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/.exec(email.trim().toLowerCase());
  return m ? m[1] : null;
}
