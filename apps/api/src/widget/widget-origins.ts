import { WIDGET_MAX_ORIGINS, isValidWidgetOrigin } from '@kiorex/contracts';
import { widgetCfg } from './widget.config';

/** Pure origin helpers. The allow-list rule is the contract rule (`isValidWidgetOrigin`): exact https origin, no wildcard, no path, at most 10. */

const DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:[0-9]{1,5})?$/;

/** Scheme + host + port of a URL, lower-cased, or null when it is not an http(s) URL. Never throws. */
export function originOfUrl(raw: string | undefined | null): string | null {
  if (!raw || typeof raw !== 'string' || raw.length > 2048) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.origin.toLowerCase();
  } catch { return null; }
}

/** Registered origins as stored: only contract-valid exact origins survive, deduplicated, at most 10. */
export function sanitizeRegisteredOrigins(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const o of list) {
    if (typeof o !== 'string') continue;
    const v = o.trim().toLowerCase();
    if (isValidWidgetOrigin(v) && !out.includes(v)) out.push(v);
    if (out.length >= WIDGET_MAX_ORIGINS) break;
  }
  return out;
}

/** Local test origins (non-production only, see widget.config.ts). */
export function devOrigins(): string[] { return widgetCfg().devOrigins.filter((o) => DEV_ORIGIN.test(o)); }

/** Allowed embedding origins of one registration: its verified origins plus the non-production dev origins. */
export function allowedOrigins(registered: string[]): string[] { return [...new Set([...sanitizeRegisteredOrigins(registered), ...devOrigins()])]; }

/** Exact, case-insensitive comparison. No suffix, subdomain or wildcard matching, ever. */
export function isOriginAllowed(origin: string | null | undefined, allowed: string[]): boolean {
  if (!origin) return false;
  const o = origin.toLowerCase();
  return allowed.some((a) => a === o);
}

/** `frame-ancestors` source list: the exact origins, or `'none'` (ADR-038). */
export function frameAncestorsOf(allowed: string[]): string { return allowed.length ? allowed.join(' ') : "'none'"; }

/** The origin the widget itself is served from (used for the Origin check of widget API calls and the postMessage target of the iframe). */
export function widgetSelfOrigin(reqProto: string | undefined, reqHost: string | undefined): string | null {
  const host = (widgetCfg().host || reqHost || '').toLowerCase();
  if (!host) return null;
  const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(host);
  const proto = widgetCfg().host && !local ? 'https' : (reqProto ?? 'http');
  return `${proto}://${host}`;
}
