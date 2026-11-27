import { leadsPublicCors, leadsPublicOrigins } from './leads-cors';

const run = (env: Record<string, string | undefined>, method: string, origin?: string) => {
  const headers: Record<string, string> = {}; let status = 0; let ended = false; let nexted = false;
  const res = { setHeader: (k: string, v: string) => { headers[k.toLowerCase()] = v; }, status(n: number) { status = n; return res; }, end() { ended = true; } };
  leadsPublicCors(env)({ method, headers: origin ? { origin } : {} }, res, () => { nexted = true; });
  return { headers, status, ended, nexted };
};
const ENV = { LEADS_PUBLIC_ORIGINS: 'https://site.example/, https://other.example', CORS_ORIGINS: 'https://admin.example' };

describe('public leads CORS', () => {
  it('allows the site origin from the registry-generated list and the platform allow-list, nothing else', () => {
    expect(leadsPublicOrigins(ENV)).toEqual(['https://site.example', 'https://other.example', 'https://admin.example']);
    const ok = run(ENV, 'POST', 'https://site.example'); expect(ok.headers['access-control-allow-origin']).toBe('https://site.example'); expect(ok.headers['access-control-allow-headers']).toContain('idempotency-key'); expect(ok.nexted).toBe(true);
    expect(ok.headers['access-control-allow-credentials']).toBeUndefined();
    const bad = run(ENV, 'POST', 'https://evil.example'); expect(bad.headers['access-control-allow-origin']).toBeUndefined(); expect(bad.nexted).toBe(true);
    expect(run(ENV, 'GET').headers['access-control-allow-origin']).toBeUndefined();
  });
  it('answers a preflight itself with 204, with the headers for an allowed origin and without them otherwise', () => {
    const ok = run(ENV, 'OPTIONS', 'https://site.example'); expect(ok.status).toBe(204); expect(ok.ended).toBe(true); expect(ok.nexted).toBe(false); expect(ok.headers['access-control-allow-methods']).toBe('GET, POST, OPTIONS');
    const bad = run(ENV, 'OPTIONS', 'https://evil.example'); expect(bad.status).toBe(204); expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('with nothing configured no origin is allowed', () => { expect(leadsPublicOrigins({})).toEqual([]); expect(run({}, 'POST', 'https://site.example').headers['access-control-allow-origin']).toBeUndefined(); });
});
