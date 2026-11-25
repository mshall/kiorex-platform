import { quietWindowEnd } from '../common/market-time';
import type { MsgChannel } from './messaging.types';

/**
 * MESSAGING_CHANNELS: the configuration kind (maker-checker, versioned, market-scoped, rollback-able, see GrowthConfigService) that decides everything about
 * how the four channels behave in a market WITHOUT a deploy: provider selection and order, sender ids, secret REFERENCES, retry / backoff, rate budgets,
 * cross-channel failover order, quiet hours, WhatsApp template names and the push deep-link schemes.
 *
 * Rules (each has a test):
 *  - Secrets are never values. A `secretRef` is a Secrets Manager PATH `/{product}/{env}/{purpose}`; the runtime reads the environment variable of the same
 *    name upper-cased with non-alphanumerics as `_` (ECS injects it, same convention as the growth INTEGRATION kind). Any key that looks like a credential is refused.
 *  - Per-market overrides live under `markets.<CC>` and are deep-merged over the global payload (no country branch in code).
 *  - MARKETING never fails over to another channel (consent is per channel).
 *  - Nothing here is required: an empty payload means "use the env contract in Docs/PROVIDERS.md", so mock mode and every existing test are unchanged.
 */
export const MSG_CONFIG_KIND = 'MESSAGING_CHANNELS';
export const FAILOVER_CLASSES = ['TRANSACTIONAL', 'SECURITY', 'REMINDER', 'MARKETING'] as const;
export type FailoverClass = (typeof FAILOVER_CLASSES)[number];
export const CHANNEL_KEYS = ['WHATSAPP', 'SMS', 'EMAIL', 'PUSH'] as const;

export interface RetryPolicy { maxRetries?: number; baseDelayMs?: number; maxDelayMs?: number }
export interface RateBudget { perSecond?: number; perMinute?: number; perDay?: number }
export interface ChannelSettings {
  enabled?: boolean;
  /** Ordered providers for this channel (first is primary, the rest are tried on a provider-level failure): whatsapp meta|gateway, sms twilio|aggregator|gateway, email ses|gateway, push fcm|apns|expo. */
  providers?: string[];
  /** Secrets Manager paths by provider key (or `default`), never values. */
  secretRefs?: Record<string, string>;
  /** From address (EMAIL), sender id or number (SMS), phone-number id (WHATSAPP). */
  senderId?: string;
  retry?: RetryPolicy;
  rateBudget?: RateBudget;
  /** Marketing e-mail: unsubscribe base URL and mailto (List-Unsubscribe, RFC 8058 one-click). */
  unsubscribe?: { baseUrl?: string; mailto?: string };
  /** SMS aggregator wire format, see vendors/sms-aggregator.ts. */
  aggregator?: Record<string, unknown>;
  /** WhatsApp Business Account id (template submit / sync / analytics) and Graph version. */
  wabaId?: string;
  apiVersion?: string;
}
export interface QuietHours { start?: string; end?: string; timezone?: string; channels?: string[] }
export interface WhatsappSettings {
  windowHours?: number;
  /** Fail fast with WA_TEMPLATE_NOT_APPROVED when the registry row says REJECTED / PAUSED / DISABLED (default true). */
  requireApprovedTemplates?: boolean;
  /** Per notification kind and language: override the Meta template name / category, or switch one template off. */
  templates?: Record<string, Record<string, { name?: string; category?: 'UTILITY' | 'MARKETING' | 'AUTHENTICATION'; enabled?: boolean }>>;
  /** Backoff for Meta throttle errors (131056 / 130429 / 131048 / 80007), seconds. */
  throttleBackoffSeconds?: number[];
}
export interface PushSettings {
  /** Android channel ids by template family (the app creates them at start). */
  androidChannels?: Record<string, string>;
  badge?: boolean;
  ttlSeconds?: number;
  /** Deep-link schemes by product, e.g. { kiorex: 'kiorex', kiorly: 'kiorly' }. */
  deepLinkSchemes?: Record<string, string>;
  apns?: { teamId?: string; keyId?: string; bundleId?: string; production?: boolean };
}
export interface MessagingChannelsConfig {
  channels?: Partial<Record<MsgChannel, ChannelSettings>>;
  failoverOrder?: Partial<Record<FailoverClass, MsgChannel[]>>;
  quietHours?: QuietHours;
  whatsapp?: WhatsappSettings;
  push?: PushSettings;
  markets?: Record<string, Omit<MessagingChannelsConfig, 'markets'>>;
}

export const MESSAGING_CHANNELS_DEFAULT = (): MessagingChannelsConfig => ({
  channels: {
    WHATSAPP: { enabled: true, retry: { maxRetries: 2, baseDelayMs: 250, maxDelayMs: 5000 }, rateBudget: { perSecond: 40, perDay: 1000 }, apiVersion: 'v21.0' },
    SMS: { enabled: true, retry: { maxRetries: 2, baseDelayMs: 250, maxDelayMs: 5000 }, rateBudget: { perSecond: 10 } },
    EMAIL: { enabled: true, retry: { maxRetries: 2, baseDelayMs: 250, maxDelayMs: 5000 }, rateBudget: { perSecond: 14 } }, // SES production default; the sandbox allows 1 per second: tune per account
    PUSH: { enabled: true, retry: { maxRetries: 2, baseDelayMs: 100, maxDelayMs: 2000 }, rateBudget: { perSecond: 200 } },
  },
  failoverOrder: { TRANSACTIONAL: ['WHATSAPP', 'SMS', 'EMAIL'], SECURITY: ['SMS', 'WHATSAPP'], REMINDER: ['WHATSAPP', 'SMS'], MARKETING: [] },
  quietHours: { start: '21:00', end: '09:00', timezone: 'Africa/Cairo', channels: ['WHATSAPP', 'SMS', 'PUSH'] },
  whatsapp: { windowHours: 24, requireApprovedTemplates: true, templates: {}, throttleBackoffSeconds: [30, 120, 600, 1800] },
  push: { androidChannels: { bookings: 'kiorex-bookings', reminders: 'kiorex-reminders', orders: 'kiorex-orders', default: 'kiorex-default' }, badge: true, ttlSeconds: 86_400, deepLinkSchemes: { kiorex: 'kiorex', kiorly: 'kiorly' } },
});

// ───────────────────────── validation ─────────────────────────

/** `/{product}/{env}/{purpose}` in lower case, e.g. `/kiorex/staging/whatsapp_token`. */
export const SECRET_PATH = /^\/[a-z0-9][a-z0-9-]{0,30}\/[a-z0-9][a-z0-9-]{0,30}\/[a-z0-9][a-z0-9_-]{0,60}$/;
const CREDENTIAL_KEY = /(^|_|-)(api_?key|token|password|passwd|secret|private_?key|credential|bearer|authorization|access_?key)s?$/i;
const SECRET_LIKE_VALUE = /(AKIA[0-9A-Z]{16}|-----BEGIN|EAA[A-Za-z0-9]{40,}|sk_(live|test)_|^eyJ[A-Za-z0-9_-]{20,}\.)/;
const PROVIDERS: Record<string, string[]> = { WHATSAPP: ['meta', 'gateway'], SMS: ['twilio', 'aggregator', 'gateway'], EMAIL: ['ses', 'gateway'], PUSH: ['fcm', 'apns', 'expo'] };
const HHMM = /^([01]\d|2[0-3]):00$/; // whole hours: the quiet-window maths (market-time.ts) works in hours
const TOP_KEYS = ['channels', 'failoverOrder', 'quietHours', 'whatsapp', 'push', 'markets'];
const CHANNEL_SETTING_KEYS = ['enabled', 'providers', 'secretRefs', 'senderId', 'retry', 'rateBudget', 'unsubscribe', 'aggregator', 'wabaId', 'apiVersion'];

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const int = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

function scanForSecrets(node: unknown, path: string, errors: string[]): void {
  if (typeof node === 'string') { if (SECRET_LIKE_VALUE.test(node)) errors.push(`${path}: looks like a credential value; use a secretRef path`); return; }
  if (Array.isArray(node)) { node.forEach((x, i) => scanForSecrets(x, `${path}[${i}]`, errors)); return; }
  if (!isObj(node)) return;
  for (const [k, v] of Object.entries(node)) {
    if (CREDENTIAL_KEY.test(k) && k !== 'secretRefs' && k !== 'secretRef') errors.push(`${path}.${k}: credential-looking key; configuration holds secretRefs only`);
    scanForSecrets(v, `${path}.${k}`, errors);
  }
}

function validateBlock(p: Record<string, unknown>, at: string, errors: string[], isMarket: boolean): void {
  for (const k of Object.keys(p)) if (!TOP_KEYS.includes(k) || (isMarket && k === 'markets')) errors.push(`${at}.${k}: unknown key`);
  if (p.channels !== undefined) {
    if (!isObj(p.channels)) errors.push(`${at}.channels must be an object`);
    else for (const [ch, raw] of Object.entries(p.channels)) {
      const w = `${at}.channels.${ch}`;
      if (!(CHANNEL_KEYS as readonly string[]).includes(ch)) { errors.push(`${w}: unknown channel`); continue; }
      if (!isObj(raw)) { errors.push(`${w} must be an object`); continue; }
      for (const k of Object.keys(raw)) if (!CHANNEL_SETTING_KEYS.includes(k)) errors.push(`${w}.${k}: unknown key`);
      if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') errors.push(`${w}.enabled must be boolean`);
      if (raw.providers !== undefined) {
        if (!Array.isArray(raw.providers) || !raw.providers.length || raw.providers.length > 4) errors.push(`${w}.providers must be 1 to 4 provider keys`);
        else for (const pr of raw.providers) if (!PROVIDERS[ch].includes(String(pr))) errors.push(`${w}.providers: ${String(pr)} is not one of ${PROVIDERS[ch].join('|')}`);
        else if (new Set(raw.providers).size !== raw.providers.length) errors.push(`${w}.providers has a duplicate`);
      }
      if (raw.secretRefs !== undefined) {
        if (!isObj(raw.secretRefs)) errors.push(`${w}.secretRefs must be an object`);
        else for (const [pk, ref] of Object.entries(raw.secretRefs)) if (typeof ref !== 'string' || !SECRET_PATH.test(ref)) errors.push(`${w}.secretRefs.${pk} must be a Secrets Manager path /{product}/{env}/{purpose}`);
      }
      if (raw.senderId !== undefined && (typeof raw.senderId !== 'string' || !raw.senderId.trim() || raw.senderId.length > 200)) errors.push(`${w}.senderId must be 1 to 200 characters`);
      if (raw.retry !== undefined) {
        const r = raw.retry; if (!isObj(r)) errors.push(`${w}.retry must be an object`);
        else {
          if (r.maxRetries !== undefined && !int(r.maxRetries, 0, 6)) errors.push(`${w}.retry.maxRetries must be 0..6`);
          if (r.baseDelayMs !== undefined && !int(r.baseDelayMs, 10, 60_000)) errors.push(`${w}.retry.baseDelayMs must be 10..60000`);
          if (r.maxDelayMs !== undefined && !int(r.maxDelayMs, 10, 600_000)) errors.push(`${w}.retry.maxDelayMs must be 10..600000`);
          if (int(r.baseDelayMs, 0, 1e9) && int(r.maxDelayMs, 0, 1e9) && (r.baseDelayMs as number) > (r.maxDelayMs as number)) errors.push(`${w}.retry.baseDelayMs must not exceed maxDelayMs`);
        }
      }
      if (raw.rateBudget !== undefined) {
        const r = raw.rateBudget; if (!isObj(r)) errors.push(`${w}.rateBudget must be an object`);
        else for (const k of ['perSecond', 'perMinute', 'perDay']) if (r[k] !== undefined && !int(r[k], 1, 10_000_000)) errors.push(`${w}.rateBudget.${k} must be a positive integer`);
      }
      if (raw.unsubscribe !== undefined) {
        const u = raw.unsubscribe; if (!isObj(u)) errors.push(`${w}.unsubscribe must be an object`);
        else {
          if (u.baseUrl !== undefined && !(typeof u.baseUrl === 'string' && /^https:\/\//.test(u.baseUrl))) errors.push(`${w}.unsubscribe.baseUrl must be https`);
          if (u.mailto !== undefined && !(typeof u.mailto === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.mailto))) errors.push(`${w}.unsubscribe.mailto must be an e-mail address`);
        }
      }
      if (raw.aggregator !== undefined && !isObj(raw.aggregator)) errors.push(`${w}.aggregator must be an object`);
      if (raw.wabaId !== undefined && !(typeof raw.wabaId === 'string' && /^\d{5,30}$/.test(raw.wabaId))) errors.push(`${w}.wabaId must be the numeric WhatsApp Business Account id`);
      if (raw.apiVersion !== undefined && !(typeof raw.apiVersion === 'string' && /^v\d{1,2}\.\d$/.test(raw.apiVersion))) errors.push(`${w}.apiVersion must look like v21.0`);
    }
  }
  if (p.failoverOrder !== undefined) {
    if (!isObj(p.failoverOrder)) errors.push(`${at}.failoverOrder must be an object`);
    else for (const [cls, order] of Object.entries(p.failoverOrder)) {
      const w = `${at}.failoverOrder.${cls}`;
      if (!(FAILOVER_CLASSES as readonly string[]).includes(cls)) { errors.push(`${w}: unknown message class`); continue; }
      if (!Array.isArray(order) || order.some((c) => !(CHANNEL_KEYS as readonly string[]).includes(String(c))) || new Set(order).size !== order.length) errors.push(`${w} must be a list of distinct channels`);
      else if (cls === 'MARKETING' && order.length > 1) errors.push(`${w}: marketing never fails over (consent is per channel)`);
    }
  }
  if (p.quietHours !== undefined) {
    const q = p.quietHours; const w = `${at}.quietHours`;
    if (!isObj(q)) errors.push(`${w} must be an object`);
    else {
      if (q.start !== undefined && !(typeof q.start === 'string' && HHMM.test(q.start))) errors.push(`${w}.start must be a whole hour HH:00`);
      if (q.end !== undefined && !(typeof q.end === 'string' && HHMM.test(q.end))) errors.push(`${w}.end must be a whole hour HH:00`);
      if (q.timezone !== undefined) { try { new Intl.DateTimeFormat('en', { timeZone: String(q.timezone) }); } catch { errors.push(`${w}.timezone is not an IANA zone`); } }
      if (q.channels !== undefined && (!Array.isArray(q.channels) || q.channels.some((c) => !(CHANNEL_KEYS as readonly string[]).includes(String(c))))) errors.push(`${w}.channels must list channels`);
    }
  }
  if (p.whatsapp !== undefined) {
    const wa = p.whatsapp; const w = `${at}.whatsapp`;
    if (!isObj(wa)) errors.push(`${w} must be an object`);
    else {
      for (const k of Object.keys(wa)) if (!['windowHours', 'requireApprovedTemplates', 'templates', 'throttleBackoffSeconds'].includes(k)) errors.push(`${w}.${k}: unknown key`);
      if (wa.windowHours !== undefined && !int(wa.windowHours, 1, 24)) errors.push(`${w}.windowHours must be 1..24 (Meta's window is 24)`);
      if (wa.requireApprovedTemplates !== undefined && typeof wa.requireApprovedTemplates !== 'boolean') errors.push(`${w}.requireApprovedTemplates must be boolean`);
      if (wa.throttleBackoffSeconds !== undefined && (!Array.isArray(wa.throttleBackoffSeconds) || !wa.throttleBackoffSeconds.length || wa.throttleBackoffSeconds.some((n) => !int(n, 1, 86_400)))) errors.push(`${w}.throttleBackoffSeconds must be a list of seconds`);
      if (wa.templates !== undefined) {
        if (!isObj(wa.templates)) errors.push(`${w}.templates must be an object`);
        else for (const [kind, langs] of Object.entries(wa.templates)) {
          if (!/^[A-Z][A-Z0-9_]{1,60}$/.test(kind)) errors.push(`${w}.templates.${kind}: key must be a notification kind`);
          if (!isObj(langs)) { errors.push(`${w}.templates.${kind} must be an object by language`); continue; }
          for (const [lang, t] of Object.entries(langs)) {
            if (!/^[a-z]{2}(_[A-Z]{2})?$/.test(lang)) errors.push(`${w}.templates.${kind}.${lang}: language must look like ar or en_US`);
            if (!isObj(t)) { errors.push(`${w}.templates.${kind}.${lang} must be an object`); continue; }
            if (t.name !== undefined && !(typeof t.name === 'string' && /^[a-z][a-z0-9_]{0,511}$/.test(t.name))) errors.push(`${w}.templates.${kind}.${lang}.name must be a Meta template name (lower case, digits, underscore)`);
            if (t.category !== undefined && !['UTILITY', 'MARKETING', 'AUTHENTICATION'].includes(String(t.category))) errors.push(`${w}.templates.${kind}.${lang}.category invalid`);
            if (t.enabled !== undefined && typeof t.enabled !== 'boolean') errors.push(`${w}.templates.${kind}.${lang}.enabled must be boolean`);
          }
        }
      }
    }
  }
  if (p.push !== undefined) {
    const pu = p.push; const w = `${at}.push`;
    if (!isObj(pu)) errors.push(`${w} must be an object`);
    else {
      for (const k of Object.keys(pu)) if (!['androidChannels', 'badge', 'ttlSeconds', 'deepLinkSchemes', 'apns'].includes(k)) errors.push(`${w}.${k}: unknown key`);
      if (pu.ttlSeconds !== undefined && !int(pu.ttlSeconds, 60, 2_419_200)) errors.push(`${w}.ttlSeconds must be 60..2419200`);
      if (pu.badge !== undefined && typeof pu.badge !== 'boolean') errors.push(`${w}.badge must be boolean`);
      if (pu.deepLinkSchemes !== undefined) {
        if (!isObj(pu.deepLinkSchemes)) errors.push(`${w}.deepLinkSchemes must be an object`);
        else for (const [prod, sch] of Object.entries(pu.deepLinkSchemes)) if (!['kiorex', 'kiorly'].includes(prod) || !(typeof sch === 'string' && /^[a-z][a-z0-9+.-]{1,30}$/.test(sch))) errors.push(`${w}.deepLinkSchemes.${prod}: product must be kiorex or kiorly and the scheme a URL scheme`);
      }
      if (pu.apns !== undefined) {
        const a = pu.apns; if (!isObj(a)) errors.push(`${w}.apns must be an object`);
        else {
          if (a.teamId !== undefined && !(typeof a.teamId === 'string' && /^[A-Z0-9]{10}$/.test(a.teamId))) errors.push(`${w}.apns.teamId must be the 10-character Apple team id`);
          if (a.keyId !== undefined && !(typeof a.keyId === 'string' && /^[A-Z0-9]{10}$/.test(a.keyId))) errors.push(`${w}.apns.keyId must be the 10-character key id`);
          if (a.bundleId !== undefined && !(typeof a.bundleId === 'string' && /^[A-Za-z0-9.-]{3,155}$/.test(a.bundleId))) errors.push(`${w}.apns.bundleId invalid`);
        }
      }
    }
  }
}

/** Errors only (empty = valid), same shape as the other local growth validators. */
export function validateMessagingChannels(payload: unknown): { errors: string[] } {
  const errors: string[] = [];
  if (!isObj(payload)) return { errors: ['payload must be an object'] };
  scanForSecrets(payload, '$', errors);
  validateBlock(payload, '$', errors, false);
  if (payload.markets !== undefined) {
    if (!isObj(payload.markets)) errors.push('$.markets must be an object');
    else for (const [cc, blk] of Object.entries(payload.markets)) {
      if (!/^[A-Z]{2}$/.test(cc)) { errors.push(`$.markets.${cc}: market must be a two-letter code`); continue; }
      if (!isObj(blk)) { errors.push(`$.markets.${cc} must be an object`); continue; }
      validateBlock(blk, `$.markets.${cc}`, errors, true);
    }
  }
  return { errors };
}

export const MESSAGING_CHANNELS_SCHEMA = {
  type: 'object', additionalProperties: false,
  description: 'Channel behaviour per market. Secrets by Secrets Manager path only. See Docs/INTEGRATION_RUNBOOK_MESSAGING.md.',
  properties: {
    channels: { type: 'object', description: 'WHATSAPP | SMS | EMAIL | PUSH: enabled, providers (ordered), secretRefs, senderId, retry, rateBudget, unsubscribe, aggregator, wabaId, apiVersion' },
    failoverOrder: { type: 'object', description: 'By class TRANSACTIONAL | SECURITY | REMINDER | MARKETING (marketing never fails over)' },
    quietHours: { type: 'object', description: '{ start, end, timezone, channels }' },
    whatsapp: { type: 'object', description: '{ windowHours, requireApprovedTemplates, templates, throttleBackoffSeconds }' },
    push: { type: 'object', description: '{ androidChannels, badge, ttlSeconds, deepLinkSchemes, apns }' },
    markets: { type: 'object', description: 'Per-market overrides, deep-merged over the global payload' },
  },
} as const;

// ───────────────────────── resolution ─────────────────────────

function deepMerge<T>(base: T, over: unknown): T {
  if (!isObj(base) || !isObj(over)) return (over === undefined ? base : (over as T));
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over)) out[k] = k in out && isObj(out[k]) && isObj(v) ? deepMerge(out[k], v) : v; // arrays and scalars replace
  return out as T;
}

/** Defaults < payload < payload.markets[market]. Pure. */
export function effectiveMessagingConfig(payload: MessagingChannelsConfig | null | undefined, market = 'EG'): Omit<MessagingChannelsConfig, 'markets'> {
  const base = deepMerge(MESSAGING_CHANNELS_DEFAULT(), payload ? { ...payload, markets: undefined } : {});
  const m = payload?.markets?.[market];
  const { markets: _drop, ...merged } = (m ? deepMerge(base, m) : base) as MessagingChannelsConfig;
  return merged;
}

/** ECS injects a Secrets Manager secret as the environment variable of the same name upper-cased with non-alphanumerics as `_` (same convention as the growth INTEGRATION kind). */
export const secretEnvName = (ref: string) => ref.toUpperCase().replace(/[^A-Z0-9]/g, '_');
export function resolveSecretRef(ref: string | undefined, env: Record<string, string | undefined> = process.env): string | null {
  if (!ref || !SECRET_PATH.test(ref)) return null;
  const v = env[secretEnvName(ref)];
  return v && v.length ? v : null;
}
/** Presence only (boolean), for status screens. */
export const secretRefPresent = (ref: string | undefined, env: Record<string, string | undefined> = process.env): boolean => resolveSecretRef(ref, env) !== null;

export function failoverOrderFor(cfg: Omit<MessagingChannelsConfig, 'markets'>, cls: FailoverClass): MsgChannel[] {
  return cls === 'MARKETING' ? (cfg.failoverOrder?.MARKETING ?? []).slice(0, 1) : ([...(cfg.failoverOrder?.[cls] ?? [])] as MsgChannel[]);
}
export function retryFor(cfg: Omit<MessagingChannelsConfig, 'markets'>, ch: MsgChannel): Required<RetryPolicy> {
  const r = cfg.channels?.[ch]?.retry ?? {};
  return { maxRetries: r.maxRetries ?? 2, baseDelayMs: r.baseDelayMs ?? 250, maxDelayMs: r.maxDelayMs ?? 5000 };
}

/** Is `nowMs` inside the configured quiet window for the channel? Returns the instant the window ends, or null when sending is allowed. Zone-correct on the two Cairo DST nights. */
export function quietUntil(cfg: Omit<MessagingChannelsConfig, 'markets'>, channel: MsgChannel, nowMs: number): number | null {
  const q = cfg.quietHours; if (!q || !q.start || !q.end) return null;
  if (q.channels && !q.channels.includes(channel)) return null;
  const hour = (s: string) => Number(s.slice(0, 2));
  return quietWindowEnd(nowMs, hour(q.start), hour(q.end), q.timezone || undefined);
}
