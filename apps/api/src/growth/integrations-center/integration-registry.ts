import { providerEnv, providerProblems, type ProviderKind } from '../../common/providers/env';
import { enabledPsps, mapsProblems, vendorPspProblems, videoProblems, aiProblems, PSP_VENDOR_MODE } from '../../common/providers/problems';
import { pushMode } from '../../common/providers/startup';
import { pushProblems } from '../../common/providers/vendors/push';

/**
 * Registry behind the Integrations Control Center. DATA ONLY plus pure readers over an env map: it never returns a value, only variable NAMES and whether each is set.
 * Mode and problems come from the same helpers the startup gate uses (`providerEnv`, `providerProblems`, `vendorPspProblems`...), so this page cannot disagree with `/health/providers`.
 * Things the Kiorex API cannot see (Clinic and Passport deployments) are marked `observable: false`: the page says "verify in that deployment" instead of guessing.
 */
type Env = Record<string, string | undefined>;
export const INTEGRATION_KEYS = ['PAYMOB', 'FAWRY', 'INSTAPAY', 'CARD_GATEWAY', 'BANK_IPN', 'SMS', 'EMAIL', 'WHATSAPP_CLOUD', 'PUSH_FCM', 'PUSH_APNS', 'PUSH_EXPO', 'GOOGLE_ADS', 'GA4', 'SEARCH_CONSOLE', 'META_ADS', 'TIKTOK', 'PLAY_CONSOLE', 'APP_STORE_CONNECT', 'CRUX', 'LLM_ASSISTANT', 'LLM_RECOMMENDATIONS', 'LLM_AI_GATEWAY', 'TURN_VIDEO', 'PASSPORT_IDP', 'MAPS_GEOCODING', 'OBJECT_STORAGE', 'ERROR_MONITORING'] as const;
export type IntegrationKey = (typeof INTEGRATION_KEYS)[number];
export type IntegrationGroup = 'payments' | 'messaging' | 'push' | 'marketing' | 'ai' | 'platform';
export type Mode = 'mock' | 'real';
export type TestSend = 'SMS' | 'EMAIL' | 'WHATSAPP' | 'PUSH';

export interface IntegrationDef {
  key: IntegrationKey; group: IntegrationGroup; label: { en: string; ar: string };
  /** Who runs the code that talks to the vendor. `kiorex` rows are fully observable from this API. */
  owner: 'kiorex' | 'clinic' | 'passport' | 'aws';
  observable: boolean;
  /** Variable names (never values) that must be present for REAL mode, and optional ones. */
  requiredEnv: string[]; optionalEnv: string[];
  /** Effective mode as the deployed environment decides it. `null` = cannot be observed from here. */
  modeOf(env: Env): Mode | null;
  /** Names of missing or invalid variables when the integration is (to be) real; never a value. */
  problems(env: Env): string[];
  webhook?: { path: string; verifyTokenEnv?: string; secretEnv?: string; note?: string };
  runbook: { file: 'INTEGRATION_RUNBOOK_MESSAGING.md' | 'INTEGRATION_RUNBOOK_PAYMENTS.md' | 'INTEGRATION_GO_LIVE_RUNBOOK.md'; anchor: string };
  testSend?: TestSend;
  /** Growth marketing integration kind whose circuit, last run and secretRef presence come from the growth `INTEGRATION` config. */
  growthKind?: string;
  /** Blocking human items (ids in the go-live runbook table). */
  needsHuman: string[];
  note?: string;
}

const has = (env: Env, k: string) => !!(env[k] ?? '').trim();
const msgKind = (k: ProviderKind) => ({
  modeOf: (env: Env): Mode => providerEnv(k, env).mode,
  problems: (env: Env) => providerProblems(k, env),
});
const pspMode = (psp: string) => (env: Env): Mode => (providerEnv('PAYMENT', env).mode === 'real' && PSP_VENDOR_MODE(env) && enabledPsps(env).includes(psp as never) ? 'real' : 'mock');
const pspProblems = (psp: string) => (env: Env) => (providerEnv('PAYMENT', env).mode === 'real' && PSP_VENDOR_MODE(env) && enabledPsps(env).includes(psp as never) ? vendorPspProblems(env).filter((p) => p.toUpperCase().startsWith(psp.toUpperCase()) || p.includes(`(${psp} enabled)`)) : []);
const growth = (key: IntegrationKey, group: IntegrationGroup, en: string, ar: string, kind: string, needsHuman: string[], anchor: string, note?: string): IntegrationDef => ({
  key, group, label: { en, ar }, owner: 'kiorex', observable: true, requiredEnv: [], optionalEnv: [], growthKind: kind, needsHuman, note,
  modeOf: () => null, problems: () => [], runbook: { file: 'INTEGRATION_RUNBOOK_MESSAGING.md', anchor }, // overwritten below for marketing rows
});

const marketing = (d: IntegrationDef): IntegrationDef => ({ ...d, runbook: { file: 'INTEGRATION_GO_LIVE_RUNBOOK.md', anchor: d.runbook.anchor } });

export const INTEGRATIONS: readonly IntegrationDef[] = [
  { key: 'PAYMOB', group: 'payments', label: { en: 'Paymob (cards, wallets)', ar: 'باي موب (بطاقات ومحافظ)' }, owner: 'kiorex', observable: true,
    requiredEnv: ['PAYMENT_MODE', 'PAYMENT_PROVIDER', 'PAYMENT_ENABLED_PSPS', 'PAYMOB_SECRET_KEY', 'PAYMOB_PUBLIC_KEY', 'PAYMOB_HMAC_SECRET', 'PAYMOB_INTEGRATION_IDS', 'PUBLIC_BASE_URL'], optionalEnv: ['PAYMOB_API_URL'],
    modeOf: pspMode('paymob'), problems: pspProblems('paymob'), webhook: { path: '/api/v1/pay/webhooks/paymob', secretEnv: 'PAYMOB_HMAC_SECRET', note: 'HMAC over the processed callback; the same URL is entered in the Paymob dashboard' },
    runbook: { file: 'INTEGRATION_RUNBOOK_PAYMENTS.md', anchor: 'paymob' }, needsHuman: ['NH-PSP'] },
  { key: 'FAWRY', group: 'payments', label: { en: 'Fawry (reference codes)', ar: 'فوري (أكواد الدفع)' }, owner: 'kiorex', observable: true,
    requiredEnv: ['PAYMENT_MODE', 'PAYMENT_PROVIDER', 'PAYMENT_ENABLED_PSPS', 'FAWRY_MERCHANT_CODE', 'FAWRY_SECURE_KEY', 'PUBLIC_BASE_URL'], optionalEnv: ['FAWRY_API_URL'],
    modeOf: pspMode('fawry'), problems: pspProblems('fawry'), webhook: { path: '/api/v1/pay/webhooks/fawry', secretEnv: 'FAWRY_SECURE_KEY', note: 'Signature over the callback fields' },
    runbook: { file: 'INTEGRATION_RUNBOOK_PAYMENTS.md', anchor: 'fawry' }, needsHuman: ['NH-PSP'] },
  { key: 'INSTAPAY', group: 'payments', label: { en: 'InstaPay', ar: 'إنستا باي' }, owner: 'kiorex', observable: true,
    requiredEnv: ['PAYMENT_MODE', 'PAYMENT_PROVIDER', 'PAYMENT_ENABLED_PSPS', 'INSTAPAY_API_URL', 'INSTAPAY_API_KEY', 'INSTAPAY_WEBHOOK_SECRET', 'PUBLIC_BASE_URL'], optionalEnv: [],
    modeOf: pspMode('instapay'), problems: pspProblems('instapay'), webhook: { path: '/api/v1/pay/webhooks/instapay', secretEnv: 'INSTAPAY_WEBHOOK_SECRET' },
    runbook: { file: 'INTEGRATION_RUNBOOK_PAYMENTS.md', anchor: 'instapay' }, needsHuman: ['NH-PSP'] },
  { key: 'CARD_GATEWAY', group: 'payments', label: { en: 'Card gateway (generic acquirer)', ar: 'بوابة البطاقات (مزود الدفع العام)' }, owner: 'kiorex', observable: true,
    requiredEnv: ['PAYMENT_MODE', 'PAYMENT_PROVIDER', 'PAYMENT_ENABLED_PSPS', 'CARDGW_API_URL', 'CARDGW_API_KEY', 'CARDGW_WEBHOOK_SECRET', 'PUBLIC_BASE_URL'], optionalEnv: ['PAYMENT_FINGERPRINT_PEPPER'],
    modeOf: pspMode('card'), problems: pspProblems('card'), webhook: { path: '/api/v1/pay/webhooks/card', secretEnv: 'CARDGW_WEBHOOK_SECRET', note: 'X-Webhook-Timestamp + X-Webhook-Signature (HMAC-SHA256)' },
    runbook: { file: 'INTEGRATION_RUNBOOK_PAYMENTS.md', anchor: 'card-gateway' }, needsHuman: ['NH-PSP'] },
  { key: 'BANK_IPN', group: 'payments', label: { en: 'Bank transfer notifications (IPN)', ar: 'إشعارات التحويل البنكي (IPN)' }, owner: 'kiorex', observable: true,
    requiredEnv: ['PAYMENT_MODE', 'PAYMENT_PROVIDER', 'PAYMENT_ENABLED_PSPS', 'BANK_IPN_WEBHOOK_SECRET', 'PUBLIC_BASE_URL'], optionalEnv: ['BANK_IPN_CONFIG_JSON'],
    modeOf: pspMode('bank_ipn'), problems: pspProblems('bank_ipn'), webhook: { path: '/api/v1/pay/webhooks/bank_ipn', secretEnv: 'BANK_IPN_WEBHOOK_SECRET', note: 'Signed IPN from the bank or aggregator; a daily IPN file can be uploaded in ops. The real layout is NEEDS_HUMAN (LG-INT-PAY-12)' },
    runbook: { file: 'INTEGRATION_RUNBOOK_PAYMENTS.md', anchor: 'bank-ipn' }, needsHuman: ['NH-PSP'] },
  { key: 'SMS', group: 'messaging', label: { en: 'SMS', ar: 'الرسائل النصية' }, owner: 'kiorex', observable: true, testSend: 'SMS',
    requiredEnv: ['SMS_MODE', 'SMS_API_URL', 'SMS_API_KEY', 'SMS_SENDER_ID', 'SMS_WEBHOOK_SECRET'], optionalEnv: ['SMS_PROVIDER', 'SMS_WEBHOOK_PUBLIC_URL', 'SMS_TIMEOUT_MS', 'SMS_MAX_RETRIES'],
    ...msgKind('SMS'), webhook: { path: '/api/v1/messaging/webhooks/sms', secretEnv: 'SMS_WEBHOOK_SECRET', note: 'Delivery status; HMAC (gateway) or the vendor signature (Twilio)' },
    runbook: { file: 'INTEGRATION_RUNBOOK_MESSAGING.md', anchor: 'sms' }, needsHuman: ['NH-SMS'] },
  { key: 'EMAIL', group: 'messaging', label: { en: 'Email', ar: 'البريد الإلكتروني' }, owner: 'kiorex', observable: true, testSend: 'EMAIL',
    requiredEnv: ['EMAIL_MODE', 'EMAIL_API_URL', 'EMAIL_API_KEY', 'EMAIL_SENDER_ID', 'EMAIL_WEBHOOK_SECRET'], optionalEnv: ['EMAIL_PROVIDER', 'EMAIL_SES_CONFIGURATION_SET', 'EMAIL_TIMEOUT_MS', 'EMAIL_MAX_RETRIES'],
    ...msgKind('EMAIL'), webhook: { path: '/api/v1/messaging/webhooks/email', secretEnv: 'EMAIL_WEBHOOK_SECRET', note: 'Bounces and complaints' },
    runbook: { file: 'INTEGRATION_RUNBOOK_MESSAGING.md', anchor: 'email' }, needsHuman: ['NH-EMAIL'] },
  { key: 'WHATSAPP_CLOUD', group: 'messaging', label: { en: 'WhatsApp Cloud API', ar: 'واتساب كلاود' }, owner: 'kiorex', observable: true, testSend: 'WHATSAPP', growthKind: 'whatsappcloud',
    requiredEnv: ['WHATSAPP_MODE', 'WHATSAPP_API_KEY', 'WHATSAPP_SENDER_ID', 'WHATSAPP_WEBHOOK_SECRET', 'WHATSAPP_VERIFY_TOKEN'], optionalEnv: ['WHATSAPP_PROVIDER', 'WHATSAPP_API_URL', 'WHATSAPP_TIMEOUT_MS', 'WHATSAPP_MAX_RETRIES'],
    ...msgKind('WHATSAPP'), webhook: { path: '/api/v1/messaging/webhooks/whatsapp', verifyTokenEnv: 'WHATSAPP_VERIFY_TOKEN', secretEnv: 'WHATSAPP_WEBHOOK_SECRET', note: 'GET answers the Meta hub.challenge with the verify token; POST carries signed statuses and inbound messages' },
    runbook: { file: 'INTEGRATION_RUNBOOK_MESSAGING.md', anchor: 'whatsapp' }, needsHuman: ['NH-WA'] },
  { key: 'PUSH_FCM', group: 'push', label: { en: 'Push: Firebase (FCM, Android)', ar: 'الإشعارات: فايربيس (أندرويد)' }, owner: 'kiorex', observable: true, testSend: 'PUSH', growthKind: 'fcmapns',
    requiredEnv: ['PUSH_MODE', 'PUSH_FCM_SERVICE_ACCOUNT_JSON'], optionalEnv: ['PUSH_FCM_PROJECT_ID', 'PUSH_ANDROID_CHANNEL_ID'],
    modeOf: (env) => pushMode(env), problems: (env) => (pushMode(env) === 'real' ? pushProblems(env) : []), runbook: { file: 'INTEGRATION_RUNBOOK_MESSAGING.md', anchor: 'push' }, needsHuman: ['NH-PUSH'] },
  { key: 'PUSH_APNS', group: 'push', label: { en: 'Push: Apple (APNs, iOS)', ar: 'الإشعارات: أبل (آي أو إس)' }, owner: 'kiorex', observable: true,
    requiredEnv: ['PUSH_MODE'], optionalEnv: [], modeOf: (env) => pushMode(env), problems: () => [],
    runbook: { file: 'INTEGRATION_RUNBOOK_MESSAGING.md', anchor: 'push' }, needsHuman: ['NH-PUSH', 'NH-STORE'], note: 'APNs is reached through Expo push (or FCM); the APNs key is uploaded to Expo, not to this API, so no variable exists here.' },
  { key: 'PUSH_EXPO', group: 'push', label: { en: 'Push: Expo push service', ar: 'الإشعارات: خدمة إكسبو' }, owner: 'kiorex', observable: true, testSend: 'PUSH',
    requiredEnv: ['PUSH_MODE', 'PUSH_EXPO_ENABLED'], optionalEnv: ['PUSH_EXPO_ACCESS_TOKEN'], modeOf: (env) => (pushMode(env) === 'real' && (env.PUSH_EXPO_ENABLED === 'true' || has(env, 'PUSH_EXPO_ACCESS_TOKEN')) ? 'real' : 'mock'), problems: () => [],
    runbook: { file: 'INTEGRATION_RUNBOOK_MESSAGING.md', anchor: 'push' }, needsHuman: ['NH-PUSH'] },
  marketing(growth('GOOGLE_ADS', 'marketing', 'Google Ads (spend, clicks)', 'إعلانات جوجل (الإنفاق والنقرات)', 'googleads', ['NH-ADS'], 'marketing-integrations')),
  marketing(growth('GA4', 'marketing', 'Google Analytics 4 (comparison only)', 'تحليلات جوجل 4 (للمقارنة فقط)', 'ga4', ['NH-ADS'], 'marketing-integrations')),
  marketing(growth('SEARCH_CONSOLE', 'marketing', 'Google Search Console', 'أداة مشرفي المواقع من جوجل', 'searchconsole', ['NH-DNS'], 'marketing-integrations')),
  marketing(growth('META_ADS', 'marketing', 'Meta Ads', 'إعلانات ميتا', 'metaads', ['NH-ADS'], 'marketing-integrations')),
  marketing(growth('TIKTOK', 'marketing', 'TikTok Ads', 'إعلانات تيك توك', 'tiktok', ['NH-ADS'], 'marketing-integrations')),
  marketing(growth('PLAY_CONSOLE', 'marketing', 'Google Play Console', 'جوجل بلاي كونسول', 'playconsole', ['NH-STORE'], 'marketing-integrations', 'Real parser waits for a recorded sample (launch guide H-9).')),
  marketing(growth('APP_STORE_CONNECT', 'marketing', 'App Store Connect', 'آب ستور كونكت', 'appstoreconnect', ['NH-STORE'], 'marketing-integrations', 'Real parser waits for a recorded sample (launch guide H-9).')),
  marketing(growth('CRUX', 'marketing', 'Chrome UX Report (field web vitals)', 'تقرير تجربة مستخدمي كروم', 'crux', ['NH-DNS'], 'marketing-integrations')),
  { key: 'LLM_ASSISTANT', group: 'ai', label: { en: 'LLM: WhatsApp assistant', ar: 'نموذج لغوي: مساعد واتساب' }, owner: 'kiorex', observable: true,
    requiredEnv: ['ASSISTANT_BASE_URL', 'ASSISTANT_MODEL', 'ASSISTANT_API_KEY'], optionalEnv: ['ASSISTANT_MOCK_COST_PER_1K_MINOR'], modeOf: () => null, problems: () => [],
    runbook: { file: 'INTEGRATION_GO_LIVE_RUNBOOK.md', anchor: 'llm' }, needsHuman: ['NH-LLM', 'NH-WA'], note: 'Real model needs ASSISTANT_POLICY.model.mode=real, the flag growth.assistant_real_model and the three variables; otherwise the mock answers.' },
  { key: 'LLM_RECOMMENDATIONS', group: 'ai', label: { en: 'LLM: recommendation summaries', ar: 'نموذج لغوي: ملخصات التوصيات' }, owner: 'kiorex', observable: true,
    requiredEnv: ['RECOMMENDATION_MODEL_MODE', 'RECOMMENDATION_MODEL_BASE_URL', 'RECOMMENDATION_MODEL', 'RECOMMENDATION_MODEL_API_KEY'], optionalEnv: [],
    modeOf: (env) => (env.RECOMMENDATION_MODEL_MODE === 'real' ? 'real' : 'mock'), problems: (env) => (env.RECOMMENDATION_MODEL_MODE === 'real' ? ['RECOMMENDATION_MODEL_BASE_URL', 'RECOMMENDATION_MODEL', 'RECOMMENDATION_MODEL_API_KEY'].filter((k) => !has(env, k)).map((k) => `${k} is required when RECOMMENDATION_MODEL_MODE=real`) : []),
    runbook: { file: 'INTEGRATION_GO_LIVE_RUNBOOK.md', anchor: 'llm' }, needsHuman: ['NH-LLM'], note: 'Aggregates only reach the model (assertAggregateOnly); launch-locked flag growth.ai_recommendations.' },
  { key: 'LLM_AI_GATEWAY', group: 'ai', label: { en: 'LLM: AI gateway (OpenAI EU)', ar: 'نموذج لغوي: بوابة الذكاء الاصطناعي' }, owner: 'kiorex', observable: true,
    requiredEnv: ['AI_PROVIDER', 'OPENAI_EU_BASE_URL', 'OPENAI_EU_API_KEY'], optionalEnv: [], modeOf: (env) => ((env.AI_PROVIDER ?? 'fake') === 'fake' ? 'mock' : 'real'), problems: (env) => aiProblems(env),
    runbook: { file: 'INTEGRATION_GO_LIVE_RUNBOOK.md', anchor: 'llm' }, needsHuman: ['NH-LLM'] },
  { key: 'TURN_VIDEO', group: 'platform', label: { en: 'Video: Cloudflare STUN/TURN (Clinic owns the call)', ar: 'الفيديو: كلاودفلير (العيادة تدير المكالمة)' }, owner: 'clinic', observable: false,
    requiredEnv: ['VIDEO_MODE'], optionalEnv: [], modeOf: (env) => (env.VIDEO_MODE === 'clinic-p2p' ? 'real' : 'mock'), problems: (env) => videoProblems(env),
    runbook: { file: 'INTEGRATION_GO_LIVE_RUNBOOK.md', anchor: 'video-turn' }, needsHuman: ['NH-TURN'], note: 'Kiorex only stores the session id and join link. TURN credentials live in the Clinic (TELEHEALTH_TURN_SECRET_NAME, a Secrets Manager name): verify them in the Clinic deployment.' },
  { key: 'PASSPORT_IDP', group: 'platform', label: { en: 'Kiorex Passport (identity provider)', ar: 'كيوركس باسبورت (مزود الهوية)' }, owner: 'passport', observable: true,
    requiredEnv: ['OIDC_ISSUER', 'OIDC_AUDIENCE'], optionalEnv: [], modeOf: (env) => (/^https:\/\/(?!localhost)/.test(env.OIDC_ISSUER ?? '') ? 'real' : 'mock'),
    problems: (env) => (env.NODE_ENV === 'production' && !/^https:\/\//.test(env.OIDC_ISSUER ?? '') ? ['OIDC_ISSUER must be the https issuer of the production identity provider'] : []),
    runbook: { file: 'INTEGRATION_GO_LIVE_RUNBOOK.md', anchor: 'passport' }, needsHuman: ['NH-IDP'], note: 'real = a non-local https issuer. The Cognito pool, hosted domain and client registration are NEEDS_HUMAN.' },
  { key: 'MAPS_GEOCODING', group: 'platform', label: { en: 'Maps and geocoding (Amazon Location)', ar: 'الخرائط وتحديد المواقع' }, owner: 'kiorex', observable: true,
    requiredEnv: ['MAPS_MODE', 'MAPS_API_URL', 'MAPS_API_KEY'], optionalEnv: ['MAPS_ACCESS_KEY_ID', 'MAPS_SECRET_ACCESS_KEY'], modeOf: (env) => (env.MAPS_MODE === 'real' ? 'real' : 'mock'), problems: (env) => mapsProblems(env),
    runbook: { file: 'INTEGRATION_GO_LIVE_RUNBOOK.md', anchor: 'maps' }, needsHuman: ['NH-AWS'] },
  { key: 'OBJECT_STORAGE', group: 'platform', label: { en: 'Object storage (documents, exports)', ar: 'تخزين الملفات' }, owner: 'clinic', observable: false,
    requiredEnv: [], optionalEnv: [], modeOf: () => null, problems: () => [], runbook: { file: 'INTEGRATION_GO_LIVE_RUNBOOK.md', anchor: 'storage' }, needsHuman: ['NH-AWS'],
    note: 'Owned by the Clinic (local directory in dev, an S3 bucket from the OpenTofu plan in AWS). Not observable from the Kiorex API.' },
  { key: 'ERROR_MONITORING', group: 'platform', label: { en: 'Error monitoring and tracing (Sentry, OpenTelemetry)', ar: 'مراقبة الأخطاء والتتبع' }, owner: 'clinic', observable: false,
    requiredEnv: [], optionalEnv: [], modeOf: () => null, problems: () => [], runbook: { file: 'INTEGRATION_GO_LIVE_RUNBOOK.md', anchor: 'observability' }, needsHuman: ['NH-AWS'],
    note: 'The Clinic reads SENTRY_DSN and OTEL_EXPORTER_OTLP_ENDPOINT; the Kiorex API has neither. Verify in the Clinic deployment.' },
];

export const integrationByKey = (k: string): IntegrationDef | undefined => INTEGRATIONS.find((d) => d.key === k);

/** Names of the required and optional variables and whether each is set. Values never leave this function. */
export function envPresence(def: IntegrationDef, env: Env): Array<{ name: string; required: boolean; set: boolean }> {
  return [...def.requiredEnv.map((n) => ({ name: n, required: true, set: has(env, n) })), ...def.optionalEnv.map((n) => ({ name: n, required: false, set: has(env, n) }))];
}
