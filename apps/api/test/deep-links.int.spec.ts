import { createCtx, TestCtx } from './harness';

/** GRW-P1-H: bootstrap, app-link association files and the web fallback pages. */
describe('deep links and bootstrap', () => {
  let c: TestCtx;
  const saved: Record<string, string | undefined> = {};
  const env = (k: string, v: string | undefined) => { if (!(k in saved)) saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => { await c.reset(); c.flags.invalidate(); });
  afterEach(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

  async function addMarket(cc: string) {
    const eg = await c.prisma.flagDefinition.findUniqueOrThrow({ where: { key: 'market.eg.live' } });
    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = eg as any;
    await c.prisma.flagDefinition.create({ data: { ...rest, key: `market.${cc.toLowerCase()}.live` } });
    await c.flags.recordGate('test', `market.${cc.toLowerCase()}.live`, { gateId: 'DEV-TEST-FIXTURE-NOT-A-REAL-GATE', approver: 'x', approvedOn: new Date(), documentUrl: 'https://dev.invalid/x' }).catch(() => {});
    c.flags.invalidate();
  }

  describe('GET /api/v1/bootstrap', () => {
    it('one live market: no selector, regional endpoint from the binding, capabilities, public cache header', async () => {
      env('REGIONAL_API_ENDPOINTS', JSON.stringify({ EG: 'https://api.region-eg.example.com/api/v1' }));
      env('MIN_APP_VERSION', '1.2.0');
      const r = await c.http().get('/api/v1/bootstrap').expect(200);
      expect(r.headers['cache-control']).toBe('public, max-age=60');
      expect(r.body).toMatchObject({
        defaultMarket: 'EG', resolvedMarket: 'EG', liveMarkets: ['EG'], showMarketSelector: false, locales: ['ar', 'en'], minAppVersion: '1.2.0',
        apiEndpoint: 'https://api.region-eg.example.com/api/v1', capabilities: { deepLinks: true, marketplace: true }, features: { referral: false }, // GRW-P2-B3: launch-locked, so false until the gate evidence exists
      });
      expect(r.body.markets).toEqual([{ code: 'EG', currency: 'EGP', phoneCode: '+20', name: { ar: 'مصر', en: 'Egypt' }, apiEndpoint: 'https://api.region-eg.example.com/api/v1' }]);
    });

    it('without a binding the endpoint is the configured public base, never a hard-coded host', async () => {
      env('REGIONAL_API_ENDPOINTS', undefined); env('PUBLIC_BASE_URL', 'https://api.example.org');
      const r = await c.http().get('/api/v1/bootstrap').expect(200);
      expect(r.body.apiEndpoint).toBe('https://api.example.org/api/v1');
    });

    it('the market comes from the cc hint only when live; client IP and geo headers are ignored', async () => {
      const r1 = await c.http().get('/api/v1/bootstrap?cc=sa').set('X-Forwarded-For', '203.0.113.9').set('CloudFront-Viewer-Country', 'SA').expect(200);
      expect(r1.body.resolvedMarket).toBe('EG'); // SA is not live: falls back, never an error
      await c.http().get('/api/v1/bootstrap?cc=https://evil.example').expect(200).expect((r) => expect(r.body.resolvedMarket).toBe('EG'));
      await addMarket('SA');
      env('REGIONAL_API_ENDPOINTS', JSON.stringify({ EG: 'https://eg.example.com/api/v1', SA: 'https://sa.example.com/api/v1' }));
      const r2 = await c.http().get('/api/v1/bootstrap').set('CloudFront-Viewer-Country', 'EG').expect(200);
      expect(r2.body).toMatchObject({ liveMarkets: ['EG', 'SA'], showMarketSelector: true, resolvedMarket: 'EG', apiEndpoint: 'https://eg.example.com/api/v1' });
      const r3 = await c.http().get('/api/v1/bootstrap?cc=sa').set('CloudFront-Viewer-Country', 'EG').expect(200);
      expect(r3.body).toMatchObject({ resolvedMarket: 'SA', apiEndpoint: 'https://sa.example.com/api/v1' });
    });

    it('capabilities follow the flags: growth.deep_links OFF reports deepLinks=false', async () => {
      const admin = await c.as('adm1', { roles: ['super_admin', 'ops_admin'] });
      await c.http().put('/api/v1/admin/flags/growth.deep_links/values').set(admin).send({ scope: 'GLOBAL', value: 'OFF', reason: 'test', ticket: 'T-1', emergency: true }).expect(200);
      c.flags.invalidate();
      const r = await c.http().get('/api/v1/bootstrap').expect(200);
      expect(r.body.capabilities.deepLinks).toBe(false);
    });

    it('no live market: still answers 200 with an empty live list and no selector', async () => {
      await c.flags.revokeGate('test', 'market.eg.live', 'test'); c.flags.invalidate();
      const r = await c.http().get('/api/v1/bootstrap').expect(200);
      expect(r.body).toMatchObject({ liveMarkets: [], showMarketSelector: false, markets: [] });
    });
  });

  describe('/.well-known association files', () => {
    const FP = Array.from({ length: 32 }, (_, i) => (i + 10).toString(16).padStart(2, '0').toUpperCase()).join(':');
    it('placeholders in dev (flagged), application/json, no redirect', async () => {
      env('APPLE_TEAM_ID', undefined); env('ANDROID_SHA256_CERT_FINGERPRINTS', undefined);
      const a = await c.http().get('/.well-known/apple-app-site-association').redirects(0).expect(200);
      expect(a.headers['content-type']).toMatch(/^application\/json/);
      expect(a.headers['x-kiorex-app-links']).toBe('placeholder');
      expect(a.body.applinks.details[0].appIDs).toEqual(['TODO_NEEDS_HUMAN_APPLE_TEAM_ID.com.kiorex.app']);
      const l = await c.http().get('/.well-known/assetlinks.json').redirects(0).expect(200);
      expect(l.headers['content-type']).toMatch(/^application\/json/);
      expect(l.body[0].target).toMatchObject({ package_name: 'com.kiorex.app', sha256_cert_fingerprints: ['TODO_NEEDS_HUMAN_SHA256_CERT_FINGERPRINT'] });
    });
    it('configured values replace the placeholders', async () => {
      env('APPLE_TEAM_ID', 'ABCDE12345'); env('ANDROID_SHA256_CERT_FINGERPRINTS', FP);
      const a = await c.http().get('/.well-known/apple-app-site-association').expect(200);
      expect(a.body.applinks.details[0].appIDs).toEqual(['ABCDE12345.com.kiorex.app']);
      expect(a.headers['x-kiorex-app-links']).toBeUndefined();
      const l = await c.http().get('/.well-known/assetlinks.json').expect(200);
      expect(l.body[0].target.sha256_cert_fingerprints).toEqual([FP]);
    });
    it('the files stay served when growth.deep_links is OFF (flag catalogue: files stay served)', async () => {
      const admin = await c.as('adm1', { roles: ['super_admin', 'ops_admin'] });
      await c.http().put('/api/v1/admin/flags/growth.deep_links/values').set(admin).send({ scope: 'GLOBAL', value: 'OFF', reason: 'test', ticket: 'T-1', emergency: true }).expect(200);
      c.flags.invalidate();
      await c.http().get('/.well-known/assetlinks.json').expect(200);
    });
  });

  describe('fallback pages', () => {
    beforeEach(() => { env('WEB_BASE_URL', 'http://localhost:5180'); env('IOS_APP_STORE_URL', 'https://apps.apple.com/app/id1'); env('ANDROID_PLAY_STORE_URL', 'https://play.google.com/store/apps/details?id=com.kiorex.app'); });

    it('/r/:code renders the page with strict headers and no touch or referrer before consent', async () => {
      const r = await c.http().get('/r/AB12CD34?l=en&cc=eg').expect(200);
      expect(r.headers['content-type']).toMatch(/text\/html/);
      expect(r.headers['referrer-policy']).toBe('no-referrer');
      expect(r.headers['cache-control']).toBe('no-store');
      expect(r.headers['content-security-policy']).toMatch(/script-src 'nonce-[\w-]+'/);
      expect(r.text).toContain('kiorex://r/AB12CD34?cc=eg');
      expect(r.text).toContain('http://localhost:5180/?ref=AB12CD34');
      expect(r.text).not.toMatch(/href="[^"]*referrer=/);
    });
    it('/q/:code accepts lower case provider codes; web fallback points at the link host only', async () => {
      env('PROVIDER_LINK_BASE_URL', 'http://localhost:5174');
      const r = await c.http().get('/q/7xk2m9qp').expect(200);
      expect(r.text).toContain('kiorex://q/7XK2M9QP');
      expect(r.text).toContain('http://localhost:5174/q/7XK2M9QP');
    });
    it('/a/:id and /appointment/:id carry no attribution block', async () => {
      for (const p of ['/a/apt_123', '/appointment/apt_123']) {
        const r = await c.http().get(p).expect(200);
        expect(r.text).toContain('kiorex://appointment/apt_123');
        expect(r.text).not.toContain('id="allow"');
      }
    });
    it('invalid and malicious parameters are 404 and never echoed', async () => {
      for (const p of ['/r/abc', '/r/AB12CD34XYZ999999', '/r/%3Cscript%3E', '/q/7XK2M9QI', '/q/7XK2M9QP1', '/a/..', '/a/%2e%2e', '/appointment/a%2fb', '/r/https%3A%2F%2Fevil.example']) {
        const r = await c.http().get(p).expect(404);
        expect(JSON.stringify(r.body)).not.toMatch(/evil|script|AB12/);
      }
    });
    it('URL-valued query parameters are never followed or reflected', async () => {
      const r = await c.http().get('/r/AB12CD34?to=https://evil.example&url=//evil.example&redirect=https://evil.example&next=javascript:alert(1)&cc=https://evil.example&l=https://evil.example').expect(200);
      expect(r.text).not.toContain('evil.example');
      expect(r.headers.location).toBeUndefined();
    });
    it('growth.deep_links OFF: the link opens the website (302 to a configured origin), nothing hidden', async () => {
      const admin = await c.as('adm1', { roles: ['super_admin', 'ops_admin'] });
      await c.http().put('/api/v1/admin/flags/growth.deep_links/values').set(admin).send({ scope: 'GLOBAL', value: 'OFF', reason: 'test', ticket: 'T-1', emergency: true }).expect(200);
      c.flags.invalidate();
      const r = await c.http().get('/r/AB12CD34').redirects(0).expect(302);
      expect(r.headers.location).toBe('http://localhost:5180/?ref=AB12CD34');
    });
    it('store URLs outside the official hosts are dropped', async () => {
      env('IOS_APP_STORE_URL', 'https://evil.example/app'); env('ANDROID_PLAY_STORE_URL', 'http://play.google.com/x');
      const r = await c.http().get('/r/AB12CD34').expect(200);
      expect(r.text).not.toContain('evil.example');
      expect(r.text).not.toContain('id="android"');
    });
  });
});
