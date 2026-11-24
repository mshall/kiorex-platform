import { GROWTH_LANDING_KINDS } from '@kiorex/contracts';
import { detectPhi } from '../../safety/safety-public';
import { growthError } from '../growth-errors';

/**
 * Request sanitising for POST /growth/v1/touch (ARCH sections 6.2 and 19). Pure.
 * - Unknown top-level keys are DROPPED (not rejected); unknown keys inside `utm` are dropped too.
 * - A UTM value must match the contract pattern; an e-mail-like or PHI-like value rejects the WHOLE call (422), any other violation is 400.
 * - The click id is hashed by the service; this layer only validates kind and length.
 */
export const CLICK_ID_KINDS = ['GCLID', 'FBCLID', 'TTCLID', 'MSCLKID', 'WBRAID', 'GBRAID'] as const;
export const UTM_KEYS = ['source', 'medium', 'campaign', 'content', 'term'] as const;
export const UTM_PATTERN = /^[A-Za-z0-9_.~:+/-]{1,64}$/;
export const REF_PATTERN = /^[0-9A-Za-z]{4,16}$/;
export const TOUCH_MAX_BODY_BYTES = 4096;

export interface ParsedTouch {
  landingKind: (typeof GROWTH_LANDING_KINDS)[number];
  utm: Partial<Record<(typeof UTM_KEYS)[number], string>>;
  clickId?: { kind: (typeof CLICK_ID_KINDS)[number]; value: string };
  ref?: string;
  lt?: string;
  dwellMs?: number;
}

const looksPersonal = (v: string) => v.includes('@') || /%40/i.test(v) || detectPhi(v).length > 0;

export function parseTouchBody(body: unknown): ParsedTouch {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw growthError('GROWTH_INVALID_REQUEST', 'Body must be a JSON object');
  const b = body as Record<string, unknown>;
  if (!(GROWTH_LANDING_KINDS as readonly unknown[]).includes(b.landingKind)) throw growthError('GROWTH_INVALID_REQUEST', 'landingKind is required and must be a known landing kind', { allowed: GROWTH_LANDING_KINDS });
  const out: ParsedTouch = { landingKind: b.landingKind as ParsedTouch['landingKind'], utm: {} };
  if (b.utm !== undefined) {
    if (!b.utm || typeof b.utm !== 'object' || Array.isArray(b.utm)) throw growthError('GROWTH_INVALID_REQUEST', 'utm must be an object');
    for (const k of UTM_KEYS) {
      const v = (b.utm as Record<string, unknown>)[k];
      if (v === undefined) continue;
      if (typeof v !== 'string') throw growthError('GROWTH_INVALID_REQUEST', `utm.${k} must be a string`);
      if (looksPersonal(v)) throw growthError('GROWTH_PHI_REJECTED', `utm.${k} looks like personal data and the call was rejected`);
      if (!UTM_PATTERN.test(v)) throw growthError('GROWTH_INVALID_REQUEST', `utm.${k} must match ${UTM_PATTERN.source}`);
      out.utm[k] = v;
    }
  }
  if (b.clickId !== undefined) {
    const c = b.clickId as Record<string, unknown> | null;
    if (!c || typeof c !== 'object' || !(CLICK_ID_KINDS as readonly unknown[]).includes(c.kind) || typeof c.value !== 'string' || c.value.length < 1 || c.value.length > 128) throw growthError('GROWTH_INVALID_REQUEST', 'clickId needs a known kind and a value of 1 to 128 characters');
    out.clickId = { kind: c.kind as (typeof CLICK_ID_KINDS)[number], value: c.value };
  }
  if (b.ref !== undefined) {
    if (typeof b.ref !== 'string' || !REF_PATTERN.test(b.ref)) throw growthError('GROWTH_INVALID_REQUEST', 'ref must be 4 to 16 letters or digits');
    out.ref = b.ref;
  }
  if (b.lt !== undefined) {
    if (typeof b.lt !== 'string' || b.lt.length < 1 || b.lt.length > 512) throw growthError('GROWTH_INVALID_REQUEST', 'lt must be a string of at most 512 characters');
    out.lt = b.lt;
  }
  if (b.dwellMs !== undefined) {
    if (!Number.isInteger(b.dwellMs) || (b.dwellMs as number) < 0 || (b.dwellMs as number) > 600_000) throw growthError('GROWTH_INVALID_REQUEST', 'dwellMs must be an integer from 0 to 600000');
    out.dwellMs = b.dwellMs as number;
  }
  return out; // everything else was never copied: unknown keys are dropped
}

/** Browser family and platform class only (never the full user agent string). */
export function uaClassOf(ua: string | undefined): string {
  if (!ua) return 'unknown';
  const s = ua.toLowerCase();
  if (/bot|crawl|spider|slurp|headless|preview|facebookexternalhit|curl|wget/.test(s)) return 'bot';
  const platform = /iphone|ipad|ios/.test(s) ? 'ios' : /android/.test(s) ? 'android' : /windows|macintosh|linux|cros/.test(s) ? 'desktop' : 'other';
  const family = /edg\//.test(s) ? 'edge' : /chrome|crios/.test(s) ? 'chrome' : /firefox|fxios/.test(s) ? 'firefox' : /safari/.test(s) ? 'safari' : 'other';
  return `${platform}-${family}`;
}

/** Referrer HOST only: a full referrer URL can carry search terms. Own-site referrers (same host as the caller) carry no information and are dropped. */
export function referrerHostOf(referer: string | undefined, selfOrigin?: string): string | null {
  if (!referer) return null;
  try {
    const u = new URL(referer);
    if (selfOrigin) { try { if (new URL(selfOrigin).host === u.host) return null; } catch { /* ignore */ } }
    return u.host.slice(0, 255);
  } catch { return null; }
}

const SEARCH_HOSTS = /(^|\.)(google|bing|yahoo|duckduckgo|yandex|baidu|ecosia)\./i;
const PAID_MEDIUM = /^(cpc|ppc|paid|paidsocial|paid-social|display|cpm|banner|retargeting|sms|whatsapp|email|push|campaign)$/i;
export type TouchSourceKind = 'PROVIDER_LINK' | 'WIDGET' | 'REFERRAL' | 'CAMPAIGN' | 'WHATSAPP' | 'ORGANIC_SEARCH' | 'DIRECT';

/** Which acquisition source kind a landing is. Deterministic; provider and referral kinds are decided by the landing, the rest by medium and referrer. */
export function sourceKindOf(t: ParsedTouch, referrerHost: string | null): TouchSourceKind {
  switch (t.landingKind) {
    case 'PROVIDER_LINK': return 'PROVIDER_LINK';
    case 'WIDGET': return 'WIDGET';
    case 'REFERRAL': return 'REFERRAL';
    case 'WHATSAPP': return 'WHATSAPP';
    case 'CAMPAIGN': return 'CAMPAIGN';
    case 'APP_OPEN': return 'DIRECT';
    default: break;
  }
  if (t.clickId || (t.utm.medium && PAID_MEDIUM.test(t.utm.medium))) return 'CAMPAIGN';
  if (t.utm.medium?.toLowerCase() === 'organic' || (referrerHost && SEARCH_HOSTS.test(referrerHost))) return 'ORGANIC_SEARCH';
  if (['SPECIALTY_CITY', 'SPECIALTY_DISTRICT', 'CARE_TYPE_DISTRICT', 'HUB', 'DOCTOR', 'CLINIC'].includes(t.landingKind)) return 'ORGANIC_SEARCH'; // SEO landing pages are entered from search
  return 'DIRECT';
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) { try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore malformed */ } }
  }
  return out;
}
export const VISITOR_KEY_PATTERN = /^kxv_[A-Za-z0-9_-]{22,64}$/;
