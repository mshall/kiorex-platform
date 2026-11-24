import { deriveIntakeSigningKey } from '@kiorex/contracts';

type Env = Record<string, string | undefined>;

/** Fixed value used ONLY outside production (local dev, tests, e2e). Never accepted in production. */
export const DEV_LEAD_SIGNING_SECRET = 'kiorex-dev-lead-signing-secret';
/** Production floor: the setup script writes 64 hex characters (256 bits). */
export const MIN_PROD_LEAD_SECRET_LENGTH = 32;

/**
 * PARTNER_LEAD_SIGNING_SECRET holds the CURRENT secret, optionally followed by the PREVIOUS one after a comma ("new,old") for a rotation window
 * (scripts/setup-partner-lead-secret.sh --rotate / --finish-rotation). At most two are accepted; all other entries are ignored.
 */
export function leadSecrets(env: Env = process.env): string[] {
  const prod = env.NODE_ENV === 'production';
  const parts = (env.PARTNER_LEAD_SIGNING_SECRET ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 2);
  const usable = prod ? parts.filter((s) => s.length >= MIN_PROD_LEAD_SECRET_LENGTH) : parts;
  if (usable.length) return usable;
  return prod ? [] : [DEV_LEAD_SIGNING_SECRET];
}

/** Derived HMAC keys (current first, then previous). Empty = nothing authenticates. */
export function leadSigningKeys(env: Env = process.env): string[] {
  return leadSecrets(env).map(deriveIntakeSigningKey);
}

/** First (current) derived key, kept for callers that only need one. */
export function leadSigningKey(env: Env = process.env): string | null {
  return leadSigningKeys(env)[0] ?? null;
}

export interface LeadSigningStatus { status: 'configured' | 'not configured'; previousAccepted: boolean }
/** For /health/ready: never contains the value. */
export function leadSigningStatus(env: Env = process.env): LeadSigningStatus {
  const n = leadSecrets(env).length;
  return { status: n > 0 ? 'configured' : 'not configured', previousAccepted: n > 1 };
}

export class LeadSigningConfigError extends Error {
  constructor() {
    super(`PARTNER_LEAD_SIGNING_SECRET is missing or shorter than ${MIN_PROD_LEAD_SECRET_LENGTH} characters (production). Run scripts/setup-partner-lead-secret.sh <env>; variable name only, no value.`);
    this.name = 'LeadSigningConfigError';
  }
}

/**
 * Startup gate: in production an unset (or too short) secret means every lead and funnel request would answer 401, so the API refuses to boot.
 * PARTNER_LEAD_SIGNING_OPTIONAL=true (set by OpenTofu only while the secret is not wired yet) downgrades this to a warning. Returns the status.
 */
export function verifyLeadSigningStartup(env: Env = process.env): LeadSigningStatus {
  const s = leadSigningStatus(env);
  if (env.NODE_ENV === 'production' && s.status === 'not configured' && env.PARTNER_LEAD_SIGNING_OPTIONAL !== 'true') throw new LeadSigningConfigError();
  return s;
}
