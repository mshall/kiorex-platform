import { siteCanonicalHost } from '../../common/hosts';
import { DEFAULT_MARKET } from '../../market/market-core-public';
import { randomInt } from 'node:crypto';
import { REFERRAL_CODE_ALPHABET, REFERRAL_CODE_PATTERN } from '@kiorex/contracts';

/**
 * Referral codes (GRW-P2-B1): 8 Crockford base32 characters (no I, L, O, U, so nothing is ambiguous when read aloud or typed), case-insensitive, one active code per patient.
 * The deny list below is a PROPOSED list of unwanted words in the code alphabet (Latin and common Arabic transliterations); an Arabic-literate human reviews it (NEEDS_HUMAN).
 */
export const CODE_DENY_SUBSTRINGS: readonly string[] = ['SEX', 'ASS', 'TIT', 'KKK', 'NAZI', 'HATE', 'DIE', 'RAPE', 'ZEB', 'KOS', 'ZIFT', 'SHRM', 'NEEK', 'GAY', 'HIV', 'COVID', 'ISIS', '666', '911'];

/** A code with a run of four identical characters, or only two distinct characters, is never issued (easy to guess, hard to read). */
export function isAcceptableCode(code: string): boolean {
  if (!REFERRAL_CODE_PATTERN.test(code)) return false;
  if (/(.)\1{3,}/.test(code)) return false;
  if (new Set(code).size < 4) return false;
  return !CODE_DENY_SUBSTRINGS.some((w) => code.includes(w));
}

export function generateReferralCode(rand: (n: number) => number = (n) => randomInt(n)): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    let s = '';
    for (let i = 0; i < 8; i++) s += REFERRAL_CODE_ALPHABET[rand(REFERRAL_CODE_ALPHABET.length)];
    if (isAcceptableCode(s)) return s;
  }
  throw new Error('referral code generator exhausted its attempts');
}

/** Typed codes: case-insensitive, spaces and dashes ignored; O reads as 0 and I or L as 1. Null when it cannot be a code (no hint why: no oracle). */
export function normalizeReferralCode(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 40) return null;
  const s = raw.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return REFERRAL_CODE_PATTERN.test(s) ? s : null;
}

const HOST = siteCanonicalHost;
/** `https://kiorex.com/{locale}/{cc}/invite/<code>` (SSR page: noindex, shows the inviter only as "a friend"). */
export function inviteUrl(code: string, o: { locale?: string; market?: string } = {}): string {
  const loc = o.locale === 'en' ? 'en' : 'ar';
  const cc = /^[A-Z]{2}$/.test(o.market ?? '') ? (o.market as string).toLowerCase() : DEFAULT_MARKET.toLowerCase();
  return `${HOST()}/${loc}/${cc}/invite/${code}`;
}
export const inviteDeepLink = (code: string) => `kiorex://invite/${code}`;

/** Share text, Arabic and English. No name of the inviter, no health word; the final wording is a human (CMO and counsel) item. */
export function shareText(code: string, o: { locale?: string; market?: string } = {}): string {
  const url = inviteUrl(code, o);
  return o.locale === 'en'
    ? `A friend invited you to Kiorex, where you can book a visit with a doctor. Join here: ${url}`
    : `صديق دعاك لتجربة كيوريكس لحجز موعد مع طبيب. سجّل من هنا: ${url}`;
}
