/** Thin adapter over @kiorex/contracts HMAC helpers (single source of truth for the signing schemes). */
import { kiorlyCanonicalString, sha256BodyHex, signCanonical, signKiorlyRequest, signWebhook as cSignWebhook, verifyWebhook as cVerifyWebhook, verifyControlPlaneRequest } from '@kiorex/contracts';

export { kiorlyCanonicalString as canonicalString, sha256BodyHex, signCanonical, signKiorlyRequest, verifyControlPlaneRequest };
export const HMAC_MAX_SKEW_MS = 5 * 60 * 1000;

export function signWebhook(secret: string, timestampSeconds: number | string, rawBody: string): string {
  return cSignWebhook({ secret, body: rawBody, timestamp: Number(timestampSeconds) }).signature;
}

/** Kiorly -> Kiorex webhook: sha256=hex(HMAC(secret, `${ts}.${rawBody}`)), ts in unix seconds. */
export function verifyWebhook(secret: string, signature: string | undefined, rawBody: string, timestamp: string | undefined): boolean {
  return cVerifyWebhook({ secret, body: rawBody, timestamp, signature }).ok;
}
