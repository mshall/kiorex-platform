import { PARTNER_DEV_DEFAULTS } from '@kiorex/contracts';
import { providerEnv } from './providers/env';

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
  kiorlyBaseUrl: env('KIORLY_BASE_URL', 'http://localhost:3010/marketplace/v1'),
  kiorlyClientKey: env('KIORLY_CLIENT_KEY', 'kx_dev_client'),
  kiorlyClientSecret: env('KIORLY_CLIENT_SECRET', 'kx_dev_secret_change_me'),
  kiorlyWebhookSecret: env('KIORLY_WEBHOOK_SECRET', 'kx_dev_webhook_secret'),
  kiorlyTimeoutMs: num('KIORLY_TIMEOUT_MS', 8000),
  fieldKey: env('FIELD_ENCRYPTION_KEY', 'a2lvcmV4LWRldi1vbmx5LWZpZWxkLWtleS0zMmJ5dGU='),
  /** PAYMENT_MODE=mock|real (legacy PSP_MODE=sandbox-fake|real still honoured). `sandbox-fake` == mock. */
  pspMode: (providerEnv('PAYMENT').mode === 'real' ? 'real' : 'sandbox-fake') as 'sandbox-fake' | 'real',
  pspFakeSecret: env('PSP_FAKE_WEBHOOK_SECRET', 'psp_fake_secret_change_me'),
  payLinkBase: env('KIOREX_PAY_LINK_BASE_URL', 'http://localhost:4000/api/v1/pay/links'),
  publicBaseUrl: env('PUBLIC_BASE_URL', 'http://localhost:4000'),
  /** NEEDS_HUMAN (KX-12): PSP fee rate and deposit amount are never invented; 0 = unset. */
  pspFeeBps: num('PSP_FEE_BPS', 0),
  depositDefaultMinor: num('DEPOSIT_DEFAULT_MINOR', 0),
  /** BR54: deposit required by default for home visits; amount NEEDS_HUMAN (KX-12), falls back to DEPOSIT_DEFAULT_MINOR, 0 = unset. */
  homeDepositDefaultMinor: num('HOME_DEPOSIT_DEFAULT_MINOR', 0),
  /** Rev 2.3 maps (Amazon Location, KX-08 C4) behind a mock-default adapter; real provider is the pre-launch pass (Docs/NEEDS_HUMAN.md). */
  mapsMode: (env('MAPS_MODE', 'mock') === 'real' ? 'real' : 'mock') as 'mock' | 'real',
  /** Safety-alert delivery (KX-09 §08, <= 60 s) to Kiorex ops on-call: mock adapter by default; real paging is a go-live task. */
  safetyDeliveryMode: (env('SAFETY_DELIVERY_MODE', 'mock') === 'real' ? 'real' : 'mock') as 'mock' | 'real',
  safetySloSeconds: num('SAFETY_SLO_SECONDS', 60),
  /** KX-09 §08: no acknowledgement within 10 minutes escalates to the Kiorex ops on-call. */
  safetyAckEscalateMinutes: num('SAFETY_ACK_ESCALATE_MINUTES', 10),
  /** KXMHV10 / Kiorly HV-PRV-01: the visit address is hidden 24 h after the visit. */
  addressMaskHours: num('ADDRESS_MASK_HOURS', 24),
  /** KXMOP05: home-visit complaints carry a 1 h SLA. */
  homeComplaintSlaMinutes: num('HOME_COMPLAINT_SLA_MINUTES', 60),
  familyShareMax: num('FAMILY_SHARE_MAX', 3),
  homeGateMinProviders: num('HOME_GATE_MIN_PROVIDERS', 50),
  /** Overall mock|real: `real` as soon as ANY of SMS_MODE / EMAIL_MODE / WHATSAPP_MODE (or legacy MESSAGING_MODE) is real. Per-channel modes: providerEnv(kind). See Docs/PROVIDERS.md. */
  messagingMode: (['SMS', 'EMAIL', 'WHATSAPP'].some((k) => providerEnv(k as 'SMS').mode === 'real') || env('MESSAGING_MODE') === 'real' ? 'real' : 'mock') as 'mock' | 'real',
  videoMode: (env('VIDEO_MODE', 'mock') === 'real' ? 'real' : 'mock') as 'mock' | 'real',
  storageMode: (env('STORAGE_MODE', 'local') === 's3' ? 's3' : 'local') as 'local' | 's3',
  storageLocalDir: env('STORAGE_LOCAL_DIR', '.data/vault'),
  vaultMaxBytes: num('VAULT_MAX_BYTES', 5 * 1024 * 1024),
  /** Dev inbox + dev routes (/dev/messaging/*) exist only outside production AND in mock messaging mode. */
  devRoutesEnabled: env('NODE_ENV') !== 'production' && !['SMS', 'EMAIL', 'WHATSAPP'].some((k) => providerEnv(k as 'SMS').mode === 'real') && env('MESSAGING_MODE') !== 'real',
  /** Dev payment simulation (/dev/payments/*): never in production, never when PAYMENT_MODE=real. */
  payDevRoutesEnabled: env('NODE_ENV') !== 'production' && providerEnv('PAYMENT').mode !== 'real',
  /** SAFETY_DELIVERY_MODE=real pages the on-call phones below through the real SMS provider (ids + district only, never PHI). */
  safetyOncallPhones: env('SAFETY_ONCALL_PHONES').split(',').map((x) => x.trim()).filter(Boolean),
  appLinkBase: env('PUBLIC_APP_URL', 'https://kiorex.com/app'),
  /** Same variable as WHATSAPP_WEBHOOK_SECRET in the provider contract: signs the normalised inbound-booking webhook AND verifies delivery-status webhooks. */
  whatsappWebhookSecret: env('WHATSAPP_WEBHOOK_SECRET', 'wa_dev_webhook_secret_change_me'),
  /** Kiorly marketplace API only accepts channel MARKETPLACE|CLINIC_LINK today; flip when Kiorly adds KIOREX_WHATSAPP. */
  kiorlyAcceptsWhatsappChannel: bool('KIORLY_ACCEPTS_WHATSAPP_CHANNEL', false),
  whatsappSessionMinutes: num('WHATSAPP_SESSION_MINUTES', 30),
  waitlistOfferMinutes: num('WAITLIST_OFFER_MINUTES', 15),
  waitlistHorizonDays: num('WAITLIST_HORIZON_DAYS', 30),
  /** KX-11 record shares: HMAC secret shared with Kiorly (KIOREX_RECORD_SHARE_HMAC_SECRET there). */
  recordShareSecret: env('KIOREX_RECORD_SHARE_HMAC_SECRET', 'dev-record-share-secret'),
  rxVerifySecret: env('RX_VERIFY_HMAC_SECRET', 'rx_dev_verify_secret_change_me'),
  rxVerifyBase: env('RX_VERIFY_BASE_URL', 'https://kiorex.com/rx/verify'),
  /**
   * Vertical partners (Kiorly Pharmacy / Lab): HMAC REST, same scheme as the marketplace client. The REAL source of truth is the
   * PartnerRegistration table (ops-configurable per partner); these env values are the fallback and the dev seed source. `*BaseUrl` is the
   * partner HOST only (kiorex-contracts PARTNER_API_PATH is appended). Defaults = PARTNER_DEV_DEFAULTS (local only, never production).
   */
  pharmacyBaseUrl: env('KIORLY_PHARMACY_BASE_URL', PARTNER_DEV_DEFAULTS.pharmacy.baseUrl),
  pharmacyClientKey: env('KIORLY_PHARMACY_CLIENT_KEY', PARTNER_DEV_DEFAULTS.pharmacy.clientKey),
  pharmacyClientSecret: env('KIORLY_PHARMACY_CLIENT_SECRET', PARTNER_DEV_DEFAULTS.pharmacy.clientSecret),
  pharmacyWebhookSecret: env('KIORLY_PHARMACY_WEBHOOK_SECRET', PARTNER_DEV_DEFAULTS.pharmacy.webhookSecret),
  labBaseUrl: env('KIORLY_LAB_BASE_URL', PARTNER_DEV_DEFAULTS.lab.baseUrl),
  labClientKey: env('KIORLY_LAB_CLIENT_KEY', PARTNER_DEV_DEFAULTS.lab.clientKey),
  labClientSecret: env('KIORLY_LAB_CLIENT_SECRET', PARTNER_DEV_DEFAULTS.lab.clientSecret),
  labWebhookSecret: env('KIORLY_LAB_WEBHOOK_SECRET', PARTNER_DEV_DEFAULTS.lab.webhookSecret),
  /** KNLAB01: Kiorex's registration at the Lab with the KIORLY_NURSE client source (same host as the lab by default). */
  labNurseClientKey: env('KIORLY_LAB_NURSE_CLIENT_KEY', PARTNER_DEV_DEFAULTS.labNurse.clientKey),
  labNurseClientSecret: env('KIORLY_LAB_NURSE_CLIENT_SECRET', PARTNER_DEV_DEFAULTS.labNurse.clientSecret),
  partnerTimeoutMs: num('PARTNER_TIMEOUT_MS', 8000),
  /** NEEDS_HUMAN (KX-12): marketplace take rates in basis points. 0 = unset. KX-03 §08 lists 4% / 8% only as "test points" — never final. */
  pharmacyTakeRateBps: num('PHARMACY_TAKE_RATE_BPS', 0),
  labTakeRateBps: num('LAB_TAKE_RATE_BPS', 0),
  teleConsultFeeMinor: num('TELE_CONSULT_FEE_MINOR', 0),
  /** NEEDS_HUMAN: VAT is config on Kiorex's OWN fee statements only (never reported to any authority). */
  feeStatementVatBps: num('FEE_STATEMENT_VAT_BPS', 0),
  deliveryFeeMinor: num('PHARMACY_DELIVERY_FEE_MINOR', 0),
  analyticsMaxBatch: num('ANALYTICS_MAX_BATCH', 20),
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
