import { allowedCorsOrigins, assertProductionSecrets, corsOriginAllowed, insecureProductionSecrets, KIOREX_DEV_SECRET_DEFAULTS, securityHeaderMap, securityHeaders, swaggerEnabled, trustedProxyHops } from './security';

/** Pentest 2026-11 regression tests: CORS allow-list, security headers, swagger gating, published-dev-secret refusal, trusted proxy hops. */
describe('http hardening (security)', () => {
  const prod = { NODE_ENV: 'production', WEB_BASE_URL: 'https://kiorex.com', CORS_ORIGINS: 'https://ops.kiorex.com/' };
  it('CORS never reflects an arbitrary origin in production, nor in development', () => {
    expect(corsOriginAllowed('https://evil.example', prod)).toBe(false);
    expect(corsOriginAllowed('https://evil.example', { NODE_ENV: 'development' })).toBe(false);
    expect(corsOriginAllowed('null', prod)).toBe(false);
    expect(corsOriginAllowed('https://kiorex.com', prod)).toBe(true);
    expect(corsOriginAllowed('https://ops.kiorex.com', prod)).toBe(true);
    expect(corsOriginAllowed('https://kiorex.com.evil.example', prod)).toBe(false);
    expect(corsOriginAllowed(undefined, prod)).toBe(true);
  });
  it('localhost origins are allowed only outside production', () => {
    expect(corsOriginAllowed('http://localhost:5180', { NODE_ENV: 'development' })).toBe(true);
    expect(corsOriginAllowed('http://localhost:5180', prod)).toBe(false);
    expect(allowedCorsOrigins(prod)).toEqual(['https://ops.kiorex.com', 'https://kiorex.com']);
  });
  it('security headers on the API; frame denial excludes the docs UI; HSTS only in production', () => {
    const api = securityHeaderMap('/api/v1/bookings', prod);
    expect(api['X-Content-Type-Options']).toBe('nosniff');
    expect(api['X-Frame-Options']).toBe('DENY');
    expect(api['Content-Security-Policy']).toContain("frame-ancestors 'none'");
    expect(api['Strict-Transport-Security']).toContain('max-age=31536000');
    expect(securityHeaderMap('/api/v1/bookings', { NODE_ENV: 'development' })['Strict-Transport-Security']).toBeUndefined();
    expect(securityHeaderMap('/v1/embed/acme', prod)['X-Frame-Options']).toBeUndefined(); // the widget host sets its own framing rules
  });
  it('middleware sets headers and strips X-Powered-By', () => {
    const set: Record<string, string> = {}; const removed: string[] = []; let called = false;
    securityHeaders(prod)({ path: '/api/v1/x' }, { setHeader: (k, v) => { set[k] = v; }, removeHeader: (k) => removed.push(k) }, () => { called = true; });
    expect(called).toBe(true); expect(removed).toContain('X-Powered-By'); expect(set['Referrer-Policy']).toBe('no-referrer');
  });
  it('swagger is off in production unless explicitly enabled', () => {
    expect(swaggerEnabled({ NODE_ENV: 'production' })).toBe(false);
    expect(swaggerEnabled({ NODE_ENV: 'production', SWAGGER_ENABLED: 'false' })).toBe(false);
    expect(swaggerEnabled({ NODE_ENV: 'production', SWAGGER_ENABLED: 'true' })).toBe(true);
    expect(swaggerEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(swaggerEnabled({ NODE_ENV: 'development', SWAGGER_ENABLED: 'false' })).toBe(false);
  });
  it('production refuses to start on the published dev secrets, development is untouched', () => {
    const devEnv: Record<string, string> = { ...KIOREX_DEV_SECRET_DEFAULTS };
    expect(() => assertProductionSecrets({ NODE_ENV: 'production', ...devEnv })).toThrow(/FIELD_ENCRYPTION_KEY/);
    expect(() => assertProductionSecrets({ NODE_ENV: 'production' })).toThrow(/KIORLY_WEBHOOK_SECRET/); // unset == falls back to the dev default
    expect(() => assertProductionSecrets({ NODE_ENV: 'development' })).not.toThrow();
    const strong = Object.fromEntries(Object.keys(devEnv).map((k) => [k, `prod-${k}-${'x'.repeat(40)}`]));
    expect(insecureProductionSecrets({ NODE_ENV: 'production', ...strong }, devEnv)).toEqual([]);
    expect(insecureProductionSecrets({ NODE_ENV: 'production', ALLOW_INSECURE_DEFAULT_SECRETS: 'true' }, devEnv)).toEqual([]);
    expect(() => assertProductionSecrets({ NODE_ENV: 'production', ...devEnv })).not.toThrow(/kx_dev_secret_change_me/); // names, never values
  });
  it('trusted proxy hops default to 0 and ignore garbage', () => {
    expect(trustedProxyHops({})).toBe(0);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: '2' })).toBe(2);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: '-1' })).toBe(0);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: '99' })).toBe(0);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: 'x' })).toBe(0);
  });
});

import { cfg } from './config';
describe('sandbox payments gate (security)', () => {
  const save = { ...process.env };
  afterEach(() => { process.env = { ...save }; });
  it('the unauthenticated sandbox checkout is unavailable in production unless SANDBOX_PAYMENTS_ALLOWED=true', () => {
    process.env.NODE_ENV = 'production'; delete process.env.SANDBOX_PAYMENTS_ALLOWED; delete process.env.PAYMENT_MODE; delete process.env.PSP_MODE;
    expect(cfg().sandboxPaymentsAllowed).toBe(false);
    process.env.SANDBOX_PAYMENTS_ALLOWED = 'true';
    expect(cfg().sandboxPaymentsAllowed).toBe(true);
    process.env.NODE_ENV = 'development'; delete process.env.SANDBOX_PAYMENTS_ALLOWED;
    expect(cfg().sandboxPaymentsAllowed).toBe(true);
  });
});
