import type { INestApplication } from '@nestjs/common';

/**
 * Process-wide HTTP hardening (pentest 2026-11, _docs/security/PENTEST_2026-11_REPORT.md). Pure functions over env so they are unit-testable.
 *  - `securityHeaders`: nosniff, no referrer, no framing of the JSON API, HSTS in production, no X-Powered-By.
 *  - `corsOrigin`: an allow-list instead of reflecting every Origin with credentials (CORS_ORIGINS + the configured product URLs; any
 *    localhost origin only outside production).
 *  - `swaggerEnabled`: the OpenAPI UI is off in production unless SWAGGER_ENABLED=true (infra already sets SWAGGER_ENABLED=false).
 *  - `assertProductionSecrets`: refuse to boot in production on the public dev secrets from `.env.example`.
 */
type Env = Record<string, string | undefined>;

const originOf = (u: string | undefined): string | null => {
  if (!u) return null;
  try { return new URL(u).origin; } catch { return null; }
};
const isLocalOrigin = (o: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(o);

export function allowedCorsOrigins(env: Env = process.env): string[] {
  const explicit = (env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
  const derived = [env.WEB_BASE_URL, env.PUBLIC_BASE_URL, env.PUBLIC_APP_URL, env.OPS_BASE_URL, env.APP_WEB_URL].map(originOf).filter((x): x is string => !!x);
  return [...new Set([...explicit, ...derived])];
}

/** Express/Nest `origin` callback semantics: true = reflect this origin, false = no CORS headers. */
export function corsOriginAllowed(origin: string | undefined, env: Env = process.env): boolean {
  if (!origin) return true; // not a browser CORS request
  if (allowedCorsOrigins(env).includes(origin.replace(/\/+$/, ''))) return true;
  return env.NODE_ENV !== 'production' && isLocalOrigin(origin);
}

export const corsOptions = (env: Env = process.env) => ({
  origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => cb(null, corsOriginAllowed(origin, env)),
  credentials: true,
});

export function swaggerEnabled(env: Env = process.env): boolean {
  const v = env.SWAGGER_ENABLED?.trim().toLowerCase();
  if (v === 'true') return true;
  if (v === 'false') return false;
  return env.NODE_ENV !== 'production';
}

/** Header map for a request path. The widget/public-site hosts set their own CSP / framing rules and are not under `/api/`. */
export function securityHeaderMap(path: string, env: Env = process.env): Record<string, string> {
  const h: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
  if (env.NODE_ENV === 'production') h['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  if (path.startsWith('/api/') && !path.startsWith('/api/docs')) {
    h['X-Frame-Options'] = 'DENY';
    h['Content-Security-Policy'] = "frame-ancestors 'none'";
  }
  return h;
}

export function securityHeaders(env: Env = process.env) {
  return (req: { path?: string; url?: string }, res: { setHeader(k: string, v: string): void; removeHeader?(k: string): void }, next: () => void) => {
    for (const [k, v] of Object.entries(securityHeaderMap(req.path ?? req.url ?? '', env))) res.setHeader(k, v);
    res.removeHeader?.('X-Powered-By');
    next();
  };
}

/** Number of reverse proxies in front of the API (CloudFront + App Runner = 2). 0 (default) means req.ip is the socket peer and X-Forwarded-For is never trusted. */
export function trustedProxyHops(env: Env = process.env): number {
  const n = Number(env.TRUSTED_PROXY_HOPS);
  return Number.isInteger(n) && n >= 0 && n <= 5 ? n : 0;
}

export function applyHttpHardening(app: INestApplication, env: Env = process.env) {
  const http = app.getHttpAdapter().getInstance() as { disable?: (k: string) => void; set?: (k: string, v: unknown) => void; use?: (f: unknown) => void };
  http.disable?.('x-powered-by');
  http.set?.('trust proxy', trustedProxyHops(env));
  http.use?.(securityHeaders(env));
}

/** Production must never run on the secrets published in `.env.example`/config defaults. Returns the offending variable NAMES (never values). */
export function insecureProductionSecrets(env: Env = process.env, devDefaults: Record<string, string>): string[] {
  if (env.NODE_ENV !== 'production' || env.ALLOW_INSECURE_DEFAULT_SECRETS === 'true') return [];
  return Object.entries(devDefaults).filter(([k, dev]) => { const v = env[k]?.trim(); return !v || v === dev || /change_me|dev[-_]only|_dev_/i.test(v); }).map(([k]) => k);
}

export const KIOREX_DEV_SECRET_DEFAULTS: Record<string, string> = {
  FIELD_ENCRYPTION_KEY: 'a2lvcmV4LWRldi1vbmx5LWZpZWxkLWtleS0zMmJ5dGU=',
  KIORLY_CLIENT_SECRET: 'kx_dev_secret_change_me',
  KIORLY_WEBHOOK_SECRET: 'kx_dev_webhook_secret',
  PSP_FAKE_WEBHOOK_SECRET: 'psp_fake_secret_change_me',
  WHATSAPP_WEBHOOK_SECRET: 'wa_dev_webhook_secret_change_me',
  KIOREX_RECORD_SHARE_HMAC_SECRET: 'dev-record-share-secret',
  RX_VERIFY_HMAC_SECRET: 'rx_dev_verify_secret_change_me',
};

export function assertProductionSecrets(env: Env = process.env): void {
  const bad = insecureProductionSecrets(env, KIOREX_DEV_SECRET_DEFAULTS);
  if (bad.length) throw new Error(`Refusing to start in production with missing or published dev secrets: ${bad.join(', ')} (set real values from Secrets Manager; ALLOW_INSECURE_DEFAULT_SECRETS=true is for staging bring-up only)`);
}
