import { EXPERIMENT_POLICY } from './experiment.types';

/**
 * SSR and cache handling of experiment variants (GRW-P3-A). One small cookie `kxe` = `<experimentKey>:<variant>` joined by `.`, at most 3 entries, set ONLY with analytics consent.
 * Without the cookie (or without consent) the control is rendered and the page stays cacheable by the plain path key. CloudFront cache key includes `kxe` (tofu contract note in NEEDS_HUMAN, validate only).
 * PURE: the renderer asks `variantsFor` and the middleware asks `setCookieFor`.
 */
export const KXE_COOKIE = 'kxe';
const ENTRY = /^[a-z0-9][a-z0-9_-]{1,62}:[a-z0-9_-]{1,32}$/;

export function parseKxe(cookieHeader: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  const m = /(?:^|;\s*)kxe=([^;]*)/.exec(cookieHeader ?? '');
  if (!m) return out;
  let raw = ''; try { raw = decodeURIComponent(m[1]!); } catch { return out; }
  for (const e of raw.split('.').slice(0, EXPERIMENT_POLICY.maxCookieExperiments)) { if (!ENTRY.test(e)) continue; const [k, v] = e.split(':'); if (!out.has(k!)) out.set(k!, v!); }
  return out;
}

/** The variant to render for a running experiment: the cookie value when it names a real variant of that experiment, otherwise control. A tampered value falls back to control. */
export function variantFor(cookieHeader: string | undefined, exp: { key: string; variants: readonly { key: string }[] }): string {
  const v = parseKxe(cookieHeader).get(exp.key);
  return v && exp.variants.some((x) => x.key === v) ? v : exp.variants[0]!.key;
}

/** Set-Cookie header value, or null: never without analytics consent, never for an empty set, only the first N entries. */
export function setCookieFor(assignments: readonly { key: string; variant: string }[], consentAnalytics: boolean, o: { secure?: boolean } = {}): string | null {
  if (!consentAnalytics || assignments.length === 0) return null;
  const v = assignments.slice(0, EXPERIMENT_POLICY.maxCookieExperiments).map((a) => `${a.key}:${a.variant}`).join('.');
  return `${KXE_COOKIE}=${encodeURIComponent(v)}; Path=/; Max-Age=${14 * 86400}; SameSite=Lax${o.secure === false ? '' : '; Secure'}`;
}
export const clearCookie = (): string => `${KXE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; Secure`;

/** The CDN cache-key addition: the cookie value when present and well formed, otherwise the empty key (control, shared cache). */
export function cacheVaryKey(cookieHeader: string | undefined): string {
  const m = parseKxe(cookieHeader); return [...m.entries()].map(([k, v]) => `${k}:${v}`).join('.');
}
