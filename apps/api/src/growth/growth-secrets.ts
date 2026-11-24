import { growthKey } from '../common/privacy-hash';

export { addressHash, growthKey, ipHashOf, randomToken, sha256Hex, subRefOf } from '../common/privacy-hash';

/** HMAC key of the in-session link token. GROWTH_LINK_TOKEN_SECRET (at least 16 characters) is shared with the service that issues provider links (D1). */
export function linkTokenKey(): Buffer {
  const env = process.env.GROWTH_LINK_TOKEN_SECRET;
  if (env && env.length >= 16) return Buffer.from(env, 'utf8');
  return growthKey('link-token');
}
