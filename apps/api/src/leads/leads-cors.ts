/**
 * CORS of the public join endpoint only (`/api/v1/public/leads`). The Kiorly site posts from its own origin, so the browser needs the allow headers and a preflight answer.
 * Allowed origins: `LEADS_PUBLIC_ORIGINS` (generated from the URL registry: the site origin) plus the platform's own allow-list (`common/security`). A route-scoped rule on purpose:
 * the site origin is NOT added to the API-wide CORS list. No credentials are ever allowed here (the endpoint takes none), a disallowed origin simply gets no CORS headers.
 */
import { allowedCorsOrigins } from '../common/security';

type Env = Record<string, string | undefined>;
export const leadsPublicOrigins = (env: Env = process.env): string[] => [...new Set([...(env.LEADS_PUBLIC_ORIGINS ?? '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean), ...allowedCorsOrigins(env)])];

interface Req { method?: string; headers: Record<string, string | string[] | undefined> }
interface Res { setHeader(k: string, v: string): void; status(n: number): Res; end(): void }

export function leadsPublicCors(env: Env = process.env) {
  return (req: Req, res: Res, next: () => void): void => {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin.replace(/\/+$/, '') : undefined;
    if (origin && leadsPublicOrigins(env).includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'content-type, idempotency-key');
      res.setHeader('Access-Control-Expose-Headers', 'retry-after');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') { res.status(204).end(); return; } // a preflight is answered here, with or without the allow headers
    next();
  };
}
