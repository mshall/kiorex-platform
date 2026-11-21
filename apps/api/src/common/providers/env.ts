/**
 * Provider environment contract shared by the Kiorex platform and Passport (same names in every repo):
 *   <KIND>_MODE            mock | real            (default mock)
 *   <KIND>_API_URL         vendor base URL        (real only; https, http allowed for loopback only)
 *   <KIND>_API_KEY         vendor credential      (real only; secret)
 *   <KIND>_SENDER_ID       sender / from / phone-number-id (SMS, EMAIL, WHATSAPP; real only)
 *   <KIND>_WEBHOOK_SECRET  HMAC secret for delivery/payment status webhooks (real only; secret)
 *   <KIND>_TIMEOUT_MS      optional, default 8000
 *   <KIND>_MAX_RETRIES     optional, default 2 (so up to 3 attempts)
 * KIND is one of SMS, EMAIL, WHATSAPP, PAYMENT. Secrets are never logged: problems only ever name variables.
 */
export const PROVIDER_KINDS = ['SMS', 'EMAIL', 'WHATSAPP', 'PAYMENT'] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];
export type ProviderMode = 'mock' | 'real';
type Env = Record<string, string | undefined>;

export interface ProviderEnv {
  kind: ProviderKind;
  mode: ProviderMode;
  apiUrl: string;
  apiKey: string;
  senderId: string;
  webhookSecret: string;
  timeoutMs: number;
  maxRetries: number;
}

const NEEDS_SENDER: Record<ProviderKind, boolean> = { SMS: true, EMAIL: true, WHATSAPP: true, PAYMENT: false };
/** Dev-only default so mock-mode simulators can sign. WHATSAPP keeps the historical dev secret used by the inbound booking webhook. */
export const mockWebhookSecret = (kind: ProviderKind) => (kind === 'WHATSAPP' ? 'wa_dev_webhook_secret_change_me' : `mock_${kind.toLowerCase()}_webhook_secret`);

const intOr = (v: string | undefined, d: number, min: number): number => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) && n >= min ? Math.floor(n) : d;
};

/** Raw mode value; `undefined` when unset. Legacy aliases (MESSAGING_MODE, PSP_MODE) only apply when <KIND>_MODE is unset. */
function rawMode(kind: ProviderKind, env: Env): string | undefined {
  const v = env[`${kind}_MODE`];
  if (v !== undefined && v !== '') return v;
  if (kind === 'PAYMENT') {
    const legacy = env.PSP_MODE; // legacy: anything but `sandbox-fake` meant a real PSP
    if (!legacy) return undefined;
    return legacy === 'sandbox-fake' ? 'mock' : 'real';
  }
  return env.MESSAGING_MODE === 'real' ? 'real' : undefined;
}

export function providerEnv(kind: ProviderKind, env: Env = process.env): ProviderEnv {
  const mode: ProviderMode = rawMode(kind, env) === 'real' ? 'real' : 'mock';
  return {
    kind,
    mode,
    apiUrl: (env[`${kind}_API_URL`] ?? '').trim().replace(/\/+$/, ''),
    apiKey: env[`${kind}_API_KEY`] ?? '',
    senderId: env[`${kind}_SENDER_ID`] ?? '',
    webhookSecret: env[`${kind}_WEBHOOK_SECRET`] || (mode === 'mock' ? mockWebhookSecret(kind) : ''),
    timeoutMs: intOr(env[`${kind}_TIMEOUT_MS`], 8000, 1),
    maxRetries: intOr(env[`${kind}_MAX_RETRIES`], 2, 0),
  };
}

const isLoopback = (h: string) => h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.localhost');

/** Names of the variables that are missing / invalid. Never contains a value. */
export function providerProblems(kind: ProviderKind, env: Env = process.env): string[] {
  const out: string[] = [];
  const raw = rawMode(kind, env);
  if (raw !== undefined && raw !== 'mock' && raw !== 'real') out.push(`${kind}_MODE must be mock or real`);
  const p = providerEnv(kind, env);
  if (p.mode !== 'real') return out;
  if (!p.apiUrl) out.push(`${kind}_API_URL is required when ${kind}_MODE=real`);
  else {
    try {
      const u = new URL(p.apiUrl);
      if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLoopback(u.hostname))) out.push(`${kind}_API_URL must be https`);
    } catch { out.push(`${kind}_API_URL is not a valid URL`); }
  }
  if (!p.apiKey) out.push(`${kind}_API_KEY is required when ${kind}_MODE=real`);
  if (!p.webhookSecret) out.push(`${kind}_WEBHOOK_SECRET is required when ${kind}_MODE=real`);
  else if (p.webhookSecret.length < 16) out.push(`${kind}_WEBHOOK_SECRET must be at least 16 characters`);
  if (NEEDS_SENDER[kind] && !p.senderId) out.push(`${kind}_SENDER_ID is required when ${kind}_MODE=real`);
  return out;
}

export class ProviderConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Provider configuration invalid: ${problems.join('; ')}`);
    this.name = 'ProviderConfigError';
  }
}

/** Fail-fast startup check. Throws (listing variable names only) when any kind is MODE=real but URL / credentials are missing. */
export function assertProviderConfig(env: Env = process.env, kinds: readonly ProviderKind[] = PROVIDER_KINDS): void {
  const problems = kinds.flatMap((k) => providerProblems(k, env));
  if (problems.length) throw new ProviderConfigError(problems);
}
