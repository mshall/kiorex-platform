/**
 * GRW-P1-H: strict, allow-list validation of every link parameter the platform handles (landing pages, well-known files, bootstrap hints).
 * The same rules are mirrored (pure, dependency free) in the patient app `src/lib/deepLink.ts` and the staff app `src/lib/deepLink.ts`.
 * Principle: parameters are matched against a pattern and then used to build a path from a fixed template. A value that is a URL, contains a
 * scheme, a slash, a dot-segment, a control character or an encoded variant of those is rejected, never "cleaned".
 */

/** ProviderReferralLink.code: 8 Crockford base32 characters without I, L, O, U (contracts 1.10.0 link code format). */
export const PROVIDER_LINK_CODE_RE = /^[0-9A-HJKMNP-TV-Z]{8}$/;
/** Patient referral / campaign code (contracts TouchRequest.ref). */
export const REF_CODE_RE = /^[0-9A-Za-z]{4,16}$/;
/** An id or an ASCII slug (canonical URL convention D5): letters, digits, `-`, `_`; never `.` (no dot-segments), never `/`. */
export const SAFE_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
export const LOCALES = ['ar', 'en'] as const;
export type LinkLocale = (typeof LOCALES)[number];
const CC_RE = /^[a-z]{2}$/;

export const isProviderLinkCode = (v: unknown): v is string => typeof v === 'string' && PROVIDER_LINK_CODE_RE.test(v);
export const isRefCode = (v: unknown): v is string => typeof v === 'string' && REF_CODE_RE.test(v);
export const isSafeSegment = (v: unknown): v is string => typeof v === 'string' && SAFE_SEGMENT_RE.test(v);

/** A code from a QR or a short link: provider link codes are case-insensitive on input, stored upper case. */
export function normalizeProviderCode(v: unknown): string | null {
  if (typeof v !== 'string' || v.length !== 8) return null;
  const u = v.toUpperCase();
  return PROVIDER_LINK_CODE_RE.test(u) ? u : null;
}
export function normalizeLocale(v: unknown, fallback: LinkLocale = 'ar'): LinkLocale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v.toLowerCase()) ? (v.toLowerCase() as LinkLocale) : fallback;
}
/** Lower case ISO-3166 alpha-2 shape only; whether the market is LIVE is decided separately (see `chooseMarket`). */
export function normalizeCc(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const l = v.toLowerCase();
  return CC_RE.test(l) ? l : null;
}
/**
 * Market-aware routing: the link's `cc` wins when it is a LIVE market; otherwise the default live market is used (never an error, never a
 * market selector). With no live market at all the default is returned unchanged.
 */
export function chooseMarket(linkCc: unknown, liveMarkets: readonly string[], defaultMarket: string): string {
  const cc = normalizeCc(linkCc);
  const live = liveMarkets.map((m) => m.toUpperCase());
  if (cc && live.includes(cc.toUpperCase())) return cc.toUpperCase();
  return live.includes(defaultMarket.toUpperCase()) ? defaultMarket.toUpperCase() : (live[0] ?? defaultMarket.toUpperCase());
}

/** Query parameter names that would turn a link into a redirect. They are never read anywhere; listed so tests can prove they are ignored. */
export const URL_VALUED_PARAMS = ['to', 'url', 'redirect', 'redirect_uri', 'redirectUrl', 'next', 'return', 'returnTo', 'return_url', 'continue', 'dest', 'destination', 'target', 'link', 'u', 'goto'] as const;

/** True for a value that looks like a URL or path tail (scheme, `//`, backslash, `%`-encoded slash or dot, control characters). */
export function looksLikeUrlOrTraversal(v: string): boolean {
  if (/[\u0000-\u001f\u007f\\]/.test(v)) return true;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(v) || v.startsWith('//')) return true;
  let d = v;
  for (let i = 0; i < 3; i++) { try { const n = decodeURIComponent(d); if (n === d) break; d = n; } catch { return true; } }
  return /[\\/]|\.\.|^[a-zA-Z][a-zA-Z0-9+.-]*:|\u0000/.test(d);
}
