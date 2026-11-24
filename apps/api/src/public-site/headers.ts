import { createHash } from 'node:crypto';

/**
 * Response headers of the public site. Security headers follow ADR-038 (every host sends frame-ancestors 'none'; public pages are never framed)
 * with the single narrow ADR-044 exception: only the widget host passes `frameAncestors` (package G), never the patient site.
 */
export interface SecurityOpts {
  /** sha256 hashes (base64) of inline <style> blocks allowed by the CSP. */
  styleHashes: string[];
  frameAncestors?: string[];
  /** Origins public pages may call from the browser (the API origin when it is not same-origin). */
  connectSrc?: string[];
  hsts?: boolean;
}

export const sha256Base64 = (s: string): string => createHash('sha256').update(s).digest('base64');

export function contentSecurityPolicy(o: SecurityOpts): string {
  const ancestors = o.frameAncestors?.length ? o.frameAncestors.join(' ') : "'none'";
  return [
    "default-src 'self'",
    "script-src 'self'",
    `style-src 'self' ${o.styleHashes.map((h) => `'sha256-${h}'`).join(' ')}`.trim(),
    "img-src 'self' data: https:",
    "font-src 'self'",
    `connect-src 'self' ${(o.connectSrc ?? []).join(' ')}`.trim(),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${ancestors}`,
  ].join('; ');
}

export function securityHeaders(o: SecurityOpts): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Security-Policy': contentSecurityPolicy(o),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  };
  if (!o.frameAncestors?.length) h['X-Frame-Options'] = 'DENY';
  if (o.hsts !== false) h['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return h;
}

/** Plain security headers for non-HTML text responses (robots, sitemaps, JSON). */
export const textSecurityHeaders = (): Record<string, string> => ({
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
});

export interface CachePolicy { sMaxAge: number; staleWhileRevalidate: number }

/** CloudFront-friendly: shared cache lifetime and SWR, browsers revalidate (max-age=0) so a purge is visible at once. */
export const publicCacheControl = (p: CachePolicy): string => `public, max-age=0, s-maxage=${p.sMaxAge}, stale-while-revalidate=${p.staleWhileRevalidate}`;
export const errorCacheControl = (sMaxAge = 60): string => `public, max-age=0, s-maxage=${sMaxAge}`;
export const noStore = 'no-store';

export const etagOf = (body: string | Buffer): string => `W/"${createHash('sha1').update(body).digest('base64url').slice(0, 27)}"`;

/** If-None-Match handling, weak comparison (RFC 9110 section 13.1.2). */
export function etagMatches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  if (ifNoneMatch.trim() === '*') return true;
  const norm = (t: string) => t.trim().replace(/^W\//, '');
  return ifNoneMatch.split(',').some((t) => norm(t) === norm(etag));
}
