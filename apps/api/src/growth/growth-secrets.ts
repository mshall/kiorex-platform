import { cfg } from '../common/config';
import { growthKey } from '../common/privacy-hash';

export { addressHash, growthKey, ipHashOf, randomToken, sha256Hex, subRefOf } from '../common/privacy-hash';

/**
 * HMAC key of the in-session link token (`kxl1.` format). GROWTH_LINK_TOKEN_SECRET (at least 16 characters) comes from Secrets Manager in AWS
 * (`/kiorex-platform/<env>/growth-link-token`, see infra product-stack `growth_link_token_secret`). A deterministic DEV default derived from the field key is used
 * ONLY outside production; in production without the secret the function returns null and every such token is treated as invalid (never a guessable key).
 */
export function linkTokenKey(): Buffer | null {
  const env = process.env.GROWTH_LINK_TOKEN_SECRET;
  if (env && env.length >= 16) return Buffer.from(env, 'utf8');
  return cfg().isProd ? null : growthKey('link-token');
}

/**
 * Secret of the Clinic-issued provider-link token (`lt`, format `<payload>.<sig>` with the `kx-lt1` prefix). It is the HMAC secret Kiorex already shares with the Clinic
 * for webhooks (the Clinic signs with LINK_TOUCH_SIGNING_SECRET, falling back to KIOREX_OUTBOX_WEBHOOK_SECRET), so Kiorex uses LINK_TOUCH_SIGNING_SECRET, then KIORLY_WEBHOOK_SECRET.
 */
export function providerLinkTouchSecret(): string | null {
  const s = process.env.LINK_TOUCH_SIGNING_SECRET?.trim() || cfg().kiorlyWebhookSecret;
  return s ? s : null;
}

/** Readiness line for /health: which link-token secrets are provisioned (never the values). */
export function growthSecretsStatus(): { linkTokenSecret: 'configured' | 'dev-default' | 'missing'; providerLinkTouchSecret: 'configured' | 'dev-default' | 'missing' } {
  const env = process.env.GROWTH_LINK_TOKEN_SECRET;
  const lt = env && env.length >= 16 ? 'configured' : cfg().isProd ? 'missing' : 'dev-default';
  const pl = process.env.LINK_TOUCH_SIGNING_SECRET?.trim() ? 'configured' : (process.env.KIORLY_WEBHOOK_SECRET ? 'configured' : cfg().isProd ? 'missing' : 'dev-default');
  return { linkTokenSecret: lt, providerLinkTouchSecret: pl };
}
