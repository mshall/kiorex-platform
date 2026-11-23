import { createHmac } from 'node:crypto';
import { cfg } from '../common/config';
import { safeEqual } from '../common/crypto';

/**
 * Prescription verification QR (KXM-RC-02 / CL03). The QR carries only an opaque signed token — never patient or drug data.
 * A pharmacist scans it and calls GET /rx/verify?t=<token>, which answers validity + issuing clinic id + signed date.
 */
const mac = (recordId: string, signedAt: string) => createHmac('sha256', cfg().rxVerifySecret).update(`rx1:${recordId}:${signedAt}`).digest('base64url').slice(0, 24);

export function rxToken(recordId: string, signedAt: Date): string {
  return `kxrx1.${recordId}.${mac(recordId, signedAt.toISOString())}`;
}
/** Record ids are `kx_rec_*` for vault records and seed ids such as `demo_rec_*` for demo data: the HMAC, not the id shape, is what authenticates a token. */
export function parseRxToken(token: string): { recordId: string; mac: string } | null {
  const m = /^kxrx1\.([A-Za-z0-9_-]{3,64})\.([A-Za-z0-9_-]{24})$/.exec(token ?? '');
  return m ? { recordId: m[1], mac: m[2] } : null;
}
export const rxTokenValid = (recordId: string, signedAt: Date, given: string) => safeEqual(mac(recordId, signedAt.toISOString()), given);
export const rxVerifyUrl = (token: string) => `${cfg().rxVerifyBase}?t=${encodeURIComponent(token)}`;
/** What the app renders as a QR code. */
export const rxQrPayload = (token: string) => rxVerifyUrl(token);
