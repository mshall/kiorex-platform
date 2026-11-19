/** Lazy env config (read at call time so tests can override process.env). */
const env = (k: string, d = ''): string => process.env[k] ?? d;
const num = (k: string, d: number): number => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && process.env[k] !== undefined && process.env[k] !== '' ? v : d;
};
const bool = (k: string, d: boolean): boolean => (process.env[k] === undefined ? d : process.env[k] === 'true');

export const cfg = () => ({
  port: num('PORT', 4000),
  nodeEnv: env('NODE_ENV', 'development'),
  isProd: env('NODE_ENV') === 'production',
  oidcIssuer: env('OIDC_ISSUER', 'http://localhost:4400'),
  oidcAudience: env('OIDC_AUDIENCE', 'kiorex-api'),
  kiorlyBaseUrl: env('KIORLY_BASE_URL', 'http://localhost:3010/api/v1/marketplace/v1'),
  kiorlyClientKey: env('KIORLY_CLIENT_KEY', 'kx_dev_client'),
  kiorlyClientSecret: env('KIORLY_CLIENT_SECRET', 'kx_dev_secret_change_me'),
  kiorlyWebhookSecret: env('KIORLY_WEBHOOK_SECRET', 'kx_dev_webhook_secret'),
  kiorlyTimeoutMs: num('KIORLY_TIMEOUT_MS', 8000),
  fieldKey: env('FIELD_ENCRYPTION_KEY', 'a2lvcmV4LWRldi1vbmx5LWZpZWxkLWtleS0zMmJ5dGU='),
  pspMode: env('PSP_MODE', 'sandbox-fake'),
  pspFakeSecret: env('PSP_FAKE_WEBHOOK_SECRET', 'psp_fake_secret_change_me'),
  payLinkBase: env('KIOREX_PAY_LINK_BASE_URL', 'http://localhost:4000/api/v1/pay/links'),
  publicBaseUrl: env('PUBLIC_BASE_URL', 'http://localhost:4000'),
  /** NEEDS_HUMAN (KX-12): PSP fee rate and deposit amount are never invented; 0 = unset. */
  pspFeeBps: num('PSP_FEE_BPS', 0),
  depositDefaultMinor: num('DEPOSIT_DEFAULT_MINOR', 0),
  messagingMode: env('MESSAGING_MODE', 'log'),
  aiProvider: env('AI_PROVIDER', 'fake'),
  aiDailyQuota: num('AI_DAILY_QUOTA', 20),
  openaiBase: env('OPENAI_EU_BASE_URL'),
  openaiKey: env('OPENAI_EU_API_KEY'),
  jobsEnabled: bool('JOBS_ENABLED', true),
  /** NEEDS_HUMAN: quiet hours default (local Africa/Cairo hours) */
  quietStart: num('QUIET_HOURS_START', 22),
  quietEnd: num('QUIET_HOURS_END', 8),
  tzOffsetHours: num('MARKET_TZ_OFFSET_HOURS', 2),
  slotCacheTtlMs: num('SLOT_CACHE_TTL_MS', 60_000),
  holdMinutes: num('HOLD_MINUTES', 5),
});
