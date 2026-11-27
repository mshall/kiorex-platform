/**
 * CORS of the public plans endpoint only (`/api/v1/public/plans`), read-only. The Kiorly site reads it from its own origin. Allowed origins: `PLANS_PUBLIC_ORIGINS` when set,
 * otherwise `LEADS_PUBLIC_ORIGINS` (the same site origin, generated from the URL registry), plus the platform's own allow-list. Route-scoped on purpose: the site origin is NOT
 * added to the API-wide CORS list. GET only, no credentials, a disallowed origin simply gets no CORS headers.
 */
import { leadsPublicOrigins } from '../leads/leads-public';

type Env = Record<string, string | undefined>;
export const plansPublicOrigins = (env: Env = process.env): string[] => [...new Set([...leadsPublicOrigins(env), ...(env.PLANS_PUBLIC_ORIGINS ?? '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean)])];

interface Req { method?: string; headers: Record<string, string | string[] | undefined> }
interface Res { setHeader(k: string, v: string): void; status(n: number): Res; end(): void }

export function plansPublicCors(env: Env = process.env) {
  return (req: Req, res: Res, next: () => void): void => {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin.replace(/\/+$/, '') : undefined;
    if (origin && plansPublicOrigins(env).includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'content-type');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') { res.status(204).end(); return; }
    next();
  };
}
