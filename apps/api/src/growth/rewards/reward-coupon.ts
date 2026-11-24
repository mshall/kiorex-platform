import { createHmac, randomInt } from 'node:crypto';
import { REFERRAL_CODE_ALPHABET } from '@kiorex/contracts';
import { growthKey } from '../../common/privacy-hash';

/**
 * Coupon codes of COUPON mode (GRW-P2-B2). 10 Crockford characters (no I, L, O, U), generated from the system CSPRNG. Only a keyed hash is stored; the plain code is sealed
 * until the patient has seen it once (RewardLot.couponCodeSealed) and then discarded. A code belongs to ONE patient: redeeming it from another account is refused (RF_REDEEM_ABUSE).
 */
export const COUPON_LENGTH = 10;
export const COUPON_PATTERN = /^[0-9A-HJKMNP-TV-Z]{10}$/;

export function generateCoupon(rand: (n: number) => number = (n) => randomInt(n)): string {
  let s = '';
  for (let i = 0; i < COUPON_LENGTH; i++) s += REFERRAL_CODE_ALPHABET[rand(REFERRAL_CODE_ALPHABET.length)];
  return s;
}
/** Case-insensitive, tolerant of spaces and dashes; the look-alike letters of Crockford base32 map to their digits (O to 0, I and L to 1). Returns null when it cannot be a code. */
export function normalizeCoupon(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return COUPON_PATTERN.test(s) ? s : null;
}
export const couponHash = (code: string): string => createHmac('sha256', growthKey('reward-coupon')).update(code).digest('base64url');
/** What the app shows after the one-time reveal: the last four characters only. */
export const maskCoupon = (code: string): string => `${'•'.repeat(COUPON_LENGTH - 4)}${code.slice(-4)}`;
