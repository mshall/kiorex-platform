import { CAMPAIGN_CHANNELS } from '@kiorex/contracts';

/**
 * UTM builder (GRW-P2-A). PURE. Produces utm_source / utm_medium / utm_campaign / utm_content / utm_term with the naming rules of CAMPAIGN_POLICY (lower-case ASCII tokens,
 * length cap at most the touch sanitiser's 64) and tracked short URLs on the public host. `utm_campaign` is always `<market lower case>-<key>`, unique per market, and
 * never changes after the campaign was ACTIVE. Nothing here contains a person, a specialty or a provider.
 */
export const UTM_TOKEN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const CAMPAIGN_KEY = /^[a-z0-9][a-z0-9-]{1,47}$/;
export const MEDIUM_BY_CHANNEL: Readonly<Record<(typeof CAMPAIGN_CHANNELS)[number], string>> = {
  ORGANIC_SEARCH: 'organic', EMAIL: 'email', SMS: 'sms', WHATSAPP: 'whatsapp', PUSH: 'push', IN_APP: 'in_app', PARTNER: 'partner', PAID_SEARCH: 'cpc', PAID_SOCIAL: 'paid_social', PAID_VIDEO: 'paid_video', OFFLINE: 'offline', REFERRAL: 'referral',
};
export interface UtmConfig { source?: string; medium?: string; content?: string; term?: string; targetPath?: string; locale?: 'ar' | 'en' }
export interface UtmSet { utm_source: string; utm_medium: string; utm_campaign: string; utm_content?: string; utm_term?: string }

export const utmCampaignOf = (market: string, key: string) => `${market.toLowerCase()}-${key}`;
/** Lower-cases, turns spaces and punctuation into `-`, drops everything outside a-z0-9_-, caps the length. Empty stays empty. */
export const token = (v: string, max = 40) => v.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_]+|[-_]+$/g, '').replace(/-{2,}/g, '-').slice(0, Math.min(max, 64));

export function validateUtmConfig(c: unknown, max: number): { valid: true; value: UtmConfig } | { valid: false; errors: string[] } {
  const errors: string[] = []; const out: UtmConfig = {};
  if (c === undefined || c === null) return { valid: true, value: {} };
  if (typeof c !== 'object' || Array.isArray(c)) return { valid: false, errors: ['/utmConfig: must be an object'] };
  const o = c as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!['source', 'medium', 'content', 'term', 'targetPath', 'locale'].includes(k)) errors.push(`/utmConfig/${k}: unknown key`);
  for (const k of ['source', 'medium', 'content', 'term'] as const) if (o[k] !== undefined) {
    const v = o[k];
    if (typeof v !== 'string' || !UTM_TOKEN.test(v) || v.length > max) errors.push(`/utmConfig/${k}: lower-case a-z, 0-9, _ or - only, at most ${max} characters`); else out[k] = v;
  }
  if (o.targetPath !== undefined) {
    const p = o.targetPath;
    if (typeof p !== 'string' || !/^\/[A-Za-z0-9/_.~%-]{0,200}$/.test(p) || p.includes('//') || p.includes('..')) errors.push('/utmConfig/targetPath: a site-relative path such as /doctors');
    else out.targetPath = p;
  }
  if (o.locale !== undefined) { if (o.locale === 'ar' || o.locale === 'en') out.locale = o.locale; else errors.push('/utmConfig/locale: ar or en'); }
  return errors.length ? { valid: false, errors } : { valid: true, value: out };
}

/** The UTM set for a campaign. The medium defaults from the first channel; an explicit config value wins. */
export function buildUtm(i: { market: string; key: string; channels: readonly string[]; config: UtmConfig }): UtmSet {
  const medium = i.config.medium ?? (MEDIUM_BY_CHANNEL as Record<string, string>)[i.channels[0] ?? ''] ?? 'campaign';
  return { utm_source: i.config.source ?? 'kiorex', utm_medium: medium, utm_campaign: utmCampaignOf(i.market, i.key), ...(i.config.content ? { utm_content: i.config.content } : {}), ...(i.config.term ? { utm_term: i.config.term } : {}) };
}
export interface TrackedLinks { webUrl: string; appLink: string; landingPath: string; utm: UtmSet }
/**
 * Tracked URLs on the public host: `https://kiorex.com/{locale}/{cc}{targetPath}?utm_...`. The app link is the same https URL: it is a universal / app link, so the Kiorex
 * app opens on it when installed and the deferred deep link carries the campaign (the touch endpoint reads the same utm parameters).
 */
export function trackedLinks(i: { market: string; key: string; channels: readonly string[]; config: UtmConfig; host: string; locale?: 'ar' | 'en' }): TrackedLinks {
  const utm = buildUtm(i); const locale = i.config.locale ?? i.locale ?? 'ar';
  const landingPath = `/${locale}/${i.market.toLowerCase()}${i.config.targetPath ?? ''}`;
  const qs = new URLSearchParams(Object.entries(utm)).toString();
  const url = `${i.host.replace(/\/+$/, '')}${landingPath}?${qs}`;
  return { webUrl: url, appLink: url, landingPath, utm };
}
