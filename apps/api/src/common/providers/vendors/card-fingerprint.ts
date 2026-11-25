import { createHmac } from 'node:crypto';

/**
 * Card fingerprint for the fraud signals (referral self-referral and farming rules). PCI SAQ-A: the PAN never reaches this server, so a fingerprint can only be
 * made from what the vendor reports about the card:
 *   STRONG  the vendor sends a stable per-card id (a gateway `card.fingerprint`, a saved-card token id): the same physical card gives the same value everywhere.
 *   WEAK    derived from brand + last four + issuer (Paymob reports masked data only): many cards share it, so it is NOT used as a signal unless ops opt in (acceptWeakFingerprint).
 * The value stored is HMAC-SHA256(pepper, "<psp>|<kind>|<raw>"): never reversible, never the raw vendor value, never logged. The pepper is a secret by reference
 * (`/kiorex/<env>/payment-fingerprint-pepper`, env PAYMENT_FINGERPRINT_PEPPER); without it no fingerprint is produced (null), so nothing weak is invented.
 */
export interface CardFingerprint { hash: string; strength: 'STRONG' | 'WEAK' }
export function cardFingerprint(i: { psp: string; pepper: string; stable?: string | null; brand?: string | null; last4?: string | null; issuer?: string | null }): CardFingerprint | null {
  if (!i.pepper) return null;
  const h = (kind: string, raw: string) => createHmac('sha256', i.pepper).update(`${i.psp}|${kind}|${raw}`).digest('hex');
  const stable = (i.stable ?? '').trim();
  if (stable) return { hash: h('stable', stable), strength: 'STRONG' };
  const last4 = (i.last4 ?? '').replace(/\D/g, '');
  if (last4.length === 4 && (i.brand || i.issuer)) return { hash: h('derived', `${(i.brand ?? '').toLowerCase()}|${(i.issuer ?? '').toLowerCase()}|${last4}`), strength: 'WEAK' };
  return null;
}
export const last4Of = (v: unknown): string | undefined => { const d = String(v ?? '').replace(/\D/g, ''); return d.length >= 4 ? d.slice(-4) : undefined; };
