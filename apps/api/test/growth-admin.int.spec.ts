import { createCtx, TestCtx } from './harness';
import { GrowthConfigService, GROWTH_DEFAULT_PAYLOADS } from '../src/growth/growth-public';
import { DAY } from './growth-helpers';

type Auth = { Authorization: string };
const J = (o: unknown) => JSON.stringify(o);
const policy = (o: Record<string, unknown> = {}) => ({ ...(GROWTH_DEFAULT_PAYLOADS.ATTRIBUTION_POLICY as object), ...o }) as Record<string, unknown>;
const consent = (o: Record<string, unknown> = {}) => ({ ...(GROWTH_DEFAULT_PAYLOADS.CONSENT_DEFAULTS as object), maxMarketingPerWeek: 30, ...o }) as Record<string, unknown>;
const marketGrowth = (o: Record<string, unknown> = {}) => ({ market: 'EG', currency: 'EGP', phoneCode: '+20', locales: ['ar', 'en'], canonicalSegment: 'eg', bookingLinkBaseUrl: 'https://kiorly.link', qrEnabled: true, marketingLicenceConfirmed: false, integrations: { whatsapp: true }, ...o });

/** GRW-P1-K: the Growth admin API over HTTP with real tokens: config lifecycle, maker-checker bypass attempts, market isolation, schema validation, role matrix, secrets, audit. */
describe('Growth admin API (package K)', () => {
  let c: TestCtx; let A: Auth; let B: Auth; let C3: Auth; let ops: Auth; let fin: Auth; let sup: Auth; let patient: Auth;
  const svc = () => c.get(GrowthConfigService);
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => {
    await c.reset(); svc().invalidate();
    A = await c.as('adm_a', { roles: ['ops_admin', 'super_admin'] }); B = await c.as('adm_b', { roles: ['ops_admin', 'super_admin'] }); C3 = await c.as('adm_c', { roles: ['ops_admin', 'super_admin'] });
    ops = await c.as('ops_1', { roles: ['ops_admin'] }); fin = await c.as('fin_1', { roles: ['ops_admin', 'finance'] }); sup = await c.as('sup_1', { roles: ['ops_admin', 'support'] }); patient = await c.as('p_1');
  });
  const api = (m: 'get' | 'post' | 'patch', path: string, who: Auth, body?: unknown) => { const r = c.http()[m](`/api/v1/ops/growth${path}`).set(who); return body === undefined ? r : r.send(body as object); };
  const draft = async (who: Auth, o: Record<string, unknown> = {}, expectStatus = 201) => (await api('post', '/config', who, { kind: 'CONSENT_DEFAULTS', scope: 'GLOBAL', payload: consent({ maxMarketingPerDay: 2 }), ticket: 'T-1', reason: 'raise cap', ...o }).expect(expectStatus)).body;
  const submit = async (who: Auth, id: string) => (await api('post', `/config/${id}/submit`, who).expect(200)).body;
  const approve = (who: Auth, id: string) => api('post', `/config/${id}/approve`, who);
  const live = async (o: Record<string, unknown> = {}) => { const d = await draft(A, o); await submit(A, d.id); return (await approve(B, d.id).expect(200)).body; };

  describe('lifecycle over HTTP', () => {
    it('draft, validate, submit, second admin approves, activates at the stated instant; the audit trail has every step; the diff names the field', async () => {
      const eff = new Date(Date.now() + 8 * DAY);
      const d = await draft(A, { kind: 'ATTRIBUTION_POLICY', payload: policy({ providerTouchWindowDays: 45 }), effectiveFrom: eff.toISOString(), announcement: 'Providers: the provider window grows from 30 to 45 days.' });
      expect(d).toMatchObject({ status: 'DRAFT', createdBy: 'adm_a', version: 1 });
      expect((await api('get', `/config/${d.id}/validate`, A).expect(200)).body).toMatchObject({ valid: true, errors: [] });
      await submit(A, d.id);
      const ap = (await approve(B, d.id).expect(200)).body;
      expect(ap).toMatchObject({ status: 'APPROVED', approvedBy: 'adm_b' }); // scheduled, not yet in force
      expect((await api('get', '/config/in-force?kind=ATTRIBUTION_POLICY&market=EG', A).expect(200)).body).toMatchObject({ source: 'PROPOSED_DEFAULT', payload: { providerTouchWindowDays: 30 }, scheduled: [{ id: d.id }] });
      const early = await api('post', `/config/${d.id}/activate`, B); expect(early.status).toBe(422); expect(early.body.code).toBe('GROWTH_CONFIG_EFFECTIVE_TOO_SOON');
      const before = await svc().resolve('ATTRIBUTION_POLICY', { market: 'EG', at: new Date(eff.getTime() - 1) });
      expect((before.payload as { providerTouchWindowDays: number }).providerTouchWindowDays).toBe(30);
      await svc().activateDue(new Date(eff.getTime() + 1));
      const after = await svc().resolve('ATTRIBUTION_POLICY', { market: 'EG', at: new Date(eff.getTime() + 1) });
      expect(after).toMatchObject({ source: 'ACTIVE', versionId: d.id, payload: { providerTouchWindowDays: 45 } });
      expect((await api('get', `/config/${d.id}/diff`, ops).expect(200)).body.changes).toEqual([{ path: '/providerTouchWindowDays', kind: 'changed', before: 30, after: 45 }]);
      const one = (await api('get', `/config/${d.id}`, ops).expect(200)).body;
      expect(one.audit.map((a: { action: string }) => a.action)).toEqual(['growth.config.create', 'growth.config.submit', 'growth.config.approve', 'growth.config.activate']);
      expect(J(one.audit)).not.toMatch(/providerTouchWindowDays/); // checksums only
    });
    it('a money-policy change without the 7 day lead or without an announcement cannot be submitted or approved early', async () => {
      const soon = await draft(A, { kind: 'ATTRIBUTION_POLICY', payload: policy({ providerTouchWindowDays: 40 }), effectiveFrom: new Date(Date.now() + 2 * DAY).toISOString(), announcement: 'Providers: this changes soon.' });
      expect((await api('post', `/config/${soon.id}/submit`, A)).body.code).toBe('GROWTH_CONFIG_EFFECTIVE_TOO_SOON');
      expect((await api('get', `/config/${soon.id}/validate`, A).expect(200)).body.valid).toBe(false);
      const noText = await draft(A, { kind: 'ATTRIBUTION_POLICY', payload: policy({ providerTouchWindowDays: 40 }), effectiveFrom: new Date(Date.now() + 9 * DAY).toISOString() });
      expect((await api('post', `/config/${noText.id}/submit`, A)).body.code).toBe('GROWTH_CONFIG_INVALID');
    });
    it('rollback is a NEW version with the old payload that needs the same approval; the replaced version becomes ROLLED_BACK and nothing old is edited', async () => {
      const v1 = await live(); const v2 = await live({ payload: consent({ maxMarketingPerDay: 3 }) });
      expect((await api('get', '/config/in-force?kind=CONSENT_DEFAULTS', A)).body).toMatchObject({ version: 2, payload: { maxMarketingPerDay: 3 } });
      const rb = (await api('post', '/config/rollback', A, { kind: 'CONSENT_DEFAULTS', scope: 'GLOBAL', toVersion: 1, reason: 'cap too high' }).expect(200)).body;
      expect(rb).toMatchObject({ version: 3, status: 'PENDING_APPROVAL', supersedesId: v1.id, createdBy: 'adm_a' });
      expect((await approve(A, rb.id)).body.code).toBe('GROWTH_CONFIG_SELF_APPROVAL');
      await approve(B, rb.id).expect(200);
      expect((await api('get', '/config/in-force?kind=CONSENT_DEFAULTS', A)).body).toMatchObject({ version: 3, payload: { maxMarketingPerDay: 2 } });
      const rows = (await api('get', '/config?kind=CONSENT_DEFAULTS', A).expect(200)).body as Array<{ version: number; status: string; checksum: string }>;
      expect(rows.map((r) => [r.version, r.status])).toEqual([[3, 'ACTIVE'], [2, 'ROLLED_BACK'], [1, 'SUPERSEDED']]);
      expect(rows.find((r) => r.version === 2)!.checksum).toBe(v2.checksum);
    });
  });

  describe('maker-checker bypass attempts', () => {
    it('the author cannot approve or reject; body fields cannot name an author or approver; a non-super-admin cannot do either side', async () => {
      const d = await draft(A, { createdBy: 'adm_z', approvedBy: 'adm_b', status: 'ACTIVE' });
      expect(d).toMatchObject({ createdBy: 'adm_a', approvedBy: null, status: 'DRAFT' });
      await submit(A, d.id);
      let r = await api('post', `/config/${d.id}/approve`, A, { approvedBy: 'adm_b' }); expect([r.status, r.body.code]).toEqual([403, 'GROWTH_CONFIG_SELF_APPROVAL']);
      r = await api('post', `/config/${d.id}/reject`, A, { reason: 'my own' }); expect([r.status, r.body.code]).toEqual([403, 'GROWTH_CONFIG_SELF_APPROVAL']);
      for (const who of [ops, fin, sup, patient]) { expect((await approve(who, d.id)).status).toBe(403); expect((await api('post', '/config', who, { kind: 'SEO', scope: 'GLOBAL', payload: GROWTH_DEFAULT_PAYLOADS.SEO })).status).toBe(403); }
      expect((await c.prisma.growthConfigVersion.findUniqueOrThrow({ where: { id: d.id } })).status).toBe('PENDING_APPROVAL');
    });
    it('another admin cannot edit or submit your draft; nobody edits after submit; a draft cannot be approved or activated', async () => {
      const d = await draft(A);
      expect((await api('patch', `/config/${d.id}`, B, { reason: 'x' })).body.code).toBe('FORBIDDEN_NOT_AUTHOR');
      expect((await api('post', `/config/${d.id}/submit`, B)).body.code).toBe('FORBIDDEN_NOT_AUTHOR');
      expect((await approve(B, d.id)).body.code).toBe('GROWTH_CONFIG_TRANSITION_FORBIDDEN');
      expect((await api('post', `/config/${d.id}/activate`, B)).body.code).toBe('GROWTH_CONFIG_TRANSITION_FORBIDDEN');
      await api('patch', `/config/${d.id}`, A, { reason: 'ok' }).expect(200);
      await submit(A, d.id);
      expect((await api('patch', `/config/${d.id}`, A, { payload: consent({ maxMarketingPerDay: 9 }) })).body.code).toBe('GROWTH_CONFIG_TRANSITION_FORBIDDEN');
    });
    it('two different checkers approving at once: exactly one wins', async () => {
      const d = await draft(A); await submit(A, d.id);
      const rs = await Promise.all([approve(B, d.id), approve(C3, d.id)]);
      expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await c.prisma.growthConfigVersion.count({ where: { kind: 'CONSENT_DEFAULTS', status: 'ACTIVE' } })).toBe(1);
    });
    it('the database refuses what the API refuses: self approver, payload edits after submit, approver outside the approval step, approved without approver, deleting history', async () => {
      const d = await draft(A); await submit(A, d.id);
      await expect(c.prisma.growthConfigVersion.update({ where: { id: d.id }, data: { approvedBy: 'adm_a' } })).rejects.toThrow(/maker_checker/);
      await expect(c.prisma.growthConfigVersion.update({ where: { id: d.id }, data: { payload: consent({ maxMarketingPerDay: 10 }) as never } })).rejects.toThrow(/immutable/);
      await expect(c.prisma.growthConfigVersion.update({ where: { id: d.id }, data: { status: 'APPROVED' } })).rejects.toThrow(/approver_required/);
      const dr = await draft(A, { payload: consent({ maxMarketingPerDay: 3 }) });
      await expect(c.prisma.growthConfigVersion.update({ where: { id: dr.id }, data: { approvedBy: 'adm_b' } })).resolves.toBeDefined(); // a DRAFT may carry no approver by API, but the trigger only guards non-drafts
      await approve(B, d.id).expect(200);
      await expect(c.prisma.growthConfigVersion.delete({ where: { id: d.id } })).rejects.toThrow(/immutable/);
      await expect(c.prisma.growthConfigVersion.update({ where: { id: d.id }, data: { approvedBy: 'adm_c' } })).rejects.toThrow(/approval step|maker_checker|immutable/);
    });
  });

  describe('per-market isolation', () => {
    it('a MARKET version applies to its market only, GLOBAL answers elsewhere, and every read and list is scoped', async () => {
      const g = await live({ payload: consent({ maxMarketingPerDay: 2 }) });
      const ae = await draft(A, { scope: 'MARKET', scopeId: 'AE', payload: consent({ maxMarketingPerDay: 5, maxMarketingPerWeek: 20 }) }); await submit(A, ae.id); await approve(B, ae.id).expect(200);
      const get = async (m: string) => (await api('get', `/config/in-force?kind=CONSENT_DEFAULTS&market=${m}`, A).expect(200)).body;
      expect(await get('AE')).toMatchObject({ scope: 'MARKET', scopeId: 'AE', payload: { maxMarketingPerDay: 5 } });
      expect(await get('EG')).toMatchObject({ scope: 'GLOBAL', versionId: g.id, payload: { maxMarketingPerDay: 2 } });
      expect(((await api('get', '/config?kind=CONSENT_DEFAULTS&scope=MARKET&scopeId=AE', A)).body as unknown[]).length).toBe(1);
      expect(((await api('get', '/config?kind=CONSENT_DEFAULTS&scope=MARKET&scopeId=SA', A)).body as unknown[]).length).toBe(0);
      expect((await api('get', '/config/propagation?kind=CONSENT_DEFAULTS&scope=MARKET&scopeId=AE', A).expect(200)).body).toMatchObject({ scope: 'MARKET', scopeId: 'AE' });
      // versions are numbered per (kind, scope, scopeId): AE has its own v1 and the global v1 is untouched
      expect(ae.version).toBe(1); expect(g.version).toBe(1);
      // a MARKET-scoped growth config must name its own market in the payload
      const bad = await api('post', '/config', A, { kind: 'MARKET_GROWTH', scope: 'MARKET', scopeId: 'AE', payload: marketGrowth({ market: 'EG' }) }); expect([bad.status, bad.body.code]).toEqual([422, 'GROWTH_CONFIG_INVALID']);
      expect((await api('post', '/config', A, { kind: 'MARKET_GROWTH', scope: 'MARKET', scopeId: 'egypt', payload: marketGrowth() })).status).toBe(400);
      expect((await api('get', '/overview?market=AE', A).expect(200)).body.market).toBe('AE');
    });
    it('an approved AE version does not move the EG decision policy', async () => {
      const ae = await draft(A, { kind: 'ATTRIBUTION_POLICY', scope: 'MARKET', scopeId: 'AE', payload: policy({ providerTouchWindowDays: 45 }), effectiveFrom: new Date(Date.now() + 8 * DAY).toISOString(), announcement: 'Providers in AE: window grows to 45 days.' });
      await submit(A, ae.id); await approve(B, ae.id).expect(200); await svc().activateDue(new Date(Date.now() + 9 * DAY));
      const at = new Date(Date.now() + 9 * DAY);
      expect((await svc().resolve('ATTRIBUTION_POLICY', { market: 'AE', at })).payload).toMatchObject({ providerTouchWindowDays: 45 });
      expect((await svc().resolve('ATTRIBUTION_POLICY', { market: 'EG', at })).payload).toMatchObject({ providerTouchWindowDays: 30 });
    });
  });

  describe('schema validation and guardrails', () => {
    it('unknown keys, missing keys, wrong types, unknown kinds and kinds without a Phase 1 schema are all refused with nothing stored', async () => {
      const bad = async (body: Record<string, unknown>) => { const r = await api('post', '/config', A, { scope: 'GLOBAL', ...body }); return [r.status, r.body.code, (r.body.errors ?? []).length > 0]; };
      expect(await bad({ kind: 'CONSENT_DEFAULTS', payload: { ...consent(), surprise: 1 } })).toEqual([422, 'GROWTH_CONFIG_INVALID', true]);
      expect(await bad({ kind: 'CONSENT_DEFAULTS', payload: { regimeId: 'x' } })).toEqual([422, 'GROWTH_CONFIG_INVALID', true]);
      expect(await bad({ kind: 'SEO', payload: { ...(GROWTH_DEFAULT_PAYLOADS.SEO as object), minLiveProviders: 'three' } })).toEqual([422, 'GROWTH_CONFIG_INVALID', true]);
      expect((await bad({ kind: 'NOPE', payload: {} }))[0]).toBe(400);
      expect((await bad({ kind: 'COMMS_CAPS', payload: {} }))[0]).toBe(400);
      expect(await c.prisma.growthConfigVersion.count({ where: { ticket: null } })).toBe(0);
      expect(await c.prisma.growthConfigVersion.count({ where: { createdBy: 'adm_a' } })).toBe(0);
    });
    it('guardrails: an attribution window cannot jump x3, FIRST_TOUCH is refused for commission, slow consent withdrawal is refused', async () => {
      const eff = new Date(Date.now() + 8 * DAY).toISOString(); const announcement = 'Providers: the window changes.';
      let r = await api('post', '/config', A, { kind: 'ATTRIBUTION_POLICY', scope: 'GLOBAL', payload: policy({ providerTouchWindowDays: 90 }), effectiveFrom: eff, announcement }); expect([r.status, r.body.code]).toEqual([422, 'GROWTH_CONFIG_INVALID']); expect(J(r.body.errors)).toMatch(/providerTouchWindowDays/);
      r = await api('post', '/config', A, { kind: 'ATTRIBUTION_POLICY', scope: 'GLOBAL', payload: policy({ precedence: 'FIRST_TOUCH' }), effectiveFrom: eff, announcement }); expect(r.status).toBe(422);
      r = await api('post', '/config', A, { kind: 'CONSENT_DEFAULTS', scope: 'GLOBAL', payload: consent({ withdrawalPropagationSeconds: 900 }) }); expect(r.status).toBe(422);
    });
    it('budget: only one version per configuration may wait for approval, and the daily version budget caps churn (429)', async () => {
      const a = await draft(A); await submit(A, a.id);
      const b = await draft(A, { payload: consent({ maxMarketingPerDay: 3 }) });
      expect((await api('post', `/config/${b.id}/submit`, A)).body.code).toBe('GROWTH_CONFIG_TRANSITION_FORBIDDEN');
      await approve(B, a.id).expect(200); await submit(A, b.id);
      const prev = process.env.GROWTH_CONFIG_DAILY_VERSION_BUDGET; process.env.GROWTH_CONFIG_DAILY_VERSION_BUDGET = '2';
      try { const r = await api('post', '/config', A, { kind: 'CONSENT_DEFAULTS', scope: 'GLOBAL', payload: consent({ maxMarketingPerDay: 4 }) }); expect([r.status, r.body.code]).toEqual([429, 'GROWTH_RATE_LIMITED']); } finally { if (prev === undefined) delete process.env.GROWTH_CONFIG_DAILY_VERSION_BUDGET; else process.env.GROWTH_CONFIG_DAILY_VERSION_BUDGET = prev; }
      // another market is a separate budget
      await api('post', '/config', A, { kind: 'CONSENT_DEFAULTS', scope: 'MARKET', scopeId: 'AE', payload: consent() }).expect(201);
    });
    it('a raw secret never enters configuration: ref fields are names, credential-shaped values are refused anywhere', async () => {
      const mg = (o: Record<string, unknown>) => api('post', '/config', A, { kind: 'MARKET_GROWTH', scope: 'GLOBAL', payload: marketGrowth(o) });
      const ok = await mg({ whatsappPhoneNumberIdRef: 'prod/whatsapp_phone_number_id' }); expect(ok.status).toBe(201);
      for (const v of ['EAAGm0PX4ZCpsBA1234567890', 'sk_live_51H8abcdefghijklmnop', 'AKIAIOSFODNN7EXAMPLE']) { const r = await mg({ whatsappPhoneNumberIdRef: v }); expect([r.status, r.body.code]).toEqual([422, 'GROWTH_CONFIG_INVALID']); }
      expect(J(await c.prisma.growthConfigVersion.findMany())).not.toMatch(/EAAGm0PX4Z|sk_live_|AKIAIOSFODNN7/);
    });
    it('SEO metadata templates ride in the SEO payload: valid templates are stored, unknown placeholders, markup and stray keys are refused', async () => {
      const seo = (o: Record<string, unknown>) => api('post', '/config', A, { kind: 'SEO', scope: 'GLOBAL', payload: { ...(GROWTH_DEFAULT_PAYLOADS.SEO as object), ...o } });
      const ok = await seo({ templates: { en: { doctor: { title: '{name} | {specialty} in {city} | {brand}', description: 'Book {name} in {city}.' } } }, paginatedIndexable: false });
      expect(ok.status).toBe(201); expect((await api('get', `/config/${ok.body.id}/validate`, A)).body.valid).toBe(true);
      for (const bad of [{ templates: { en: { doctor: { title: '{nme} typo' } } } }, { templates: { fr: { doctor: { title: 'x' } } } }, { templates: { en: { doctor: { title: '<b>{name}</b>' } } } }, { reviewMarkupMinCount: 0 }, { stray: 1 }]) { const r = await seo(bad); expect([r.status, r.body.code]).toEqual([422, 'GROWTH_CONFIG_INVALID']); }
      const kinds = (await api('get', '/config/kinds', ops).expect(200)).body as Array<{ kind: string; schema: { properties: Record<string, unknown> } }>;
      expect(Object.keys(kinds.find((k) => k.kind === 'SEO')!.schema.properties)).toEqual(expect.arrayContaining(['minLiveProviders', 'templates', 'paginatedIndexable']));
    });
    it('the kinds endpoint serves the contract schemas and the PROPOSED_DEFAULT payloads for the five Phase 1 kinds and the six Phase 2 kinds (contracts 1.12.0) and the local kinds LTV_POLICY (GRW-P3-C) and LOYALTY_RULES (GRW-P4-D), local schemas until the contracts are published', async () => {
      const k = (await api('get', '/config/kinds', ops).expect(200)).body as Array<{ kind: string; schema: { additionalProperties: boolean }; defaults: unknown; moneyPolicy: boolean }>;
      expect(k.map((x) => x.kind).sort()).toEqual(['ASSISTANT_POLICY', 'ATTRIBUTION_POLICY', 'CAMPAIGN_POLICY', 'CONSENT_DEFAULTS', 'INTEGRATION', 'LIFECYCLE_POLICY', 'LOYALTY_RULES', 'LTV_POLICY', 'MARKET_GROWTH', 'REFERRAL_RULES', 'REWARD_RULES', 'SEO', 'SPONSORED_PROMOTION_POLICY', 'WIDGET_POLICY']);
      expect(k.every((x) => x.schema.additionalProperties === false)).toBe(true);
      expect(k.find((x) => x.kind === 'ATTRIBUTION_POLICY')!.moneyPolicy).toBe(true);
    });
  });

  describe('propagation monitoring and the config-read cache', () => {
    it('readers report the version they serve; a stale reader shows as not converged; another instance refreshes without a redeploy', async () => {
      const prevTtl = process.env.GROWTH_CONFIG_CACHE_TTL_MS; process.env.GROWTH_CONFIG_CACHE_TTL_MS = '250';
      try {
        const v1 = await live({ payload: consent({ maxMarketingPerDay: 2 }) });
        const other = new GrowthConfigService(c.prisma as never); // a second API instance: its own cache and reader row
        (other.readers as unknown as { instanceId: string }).instanceId = 'api@other:2';
        expect((await other.resolve('CONSENT_DEFAULTS', { market: 'EG' })).versionId).toBe(v1.id);
        const v2d = await draft(A, { payload: consent({ maxMarketingPerDay: 3 }) }); await submit(A, v2d.id); const v2 = (await approve(B, v2d.id).expect(200)).body;
        // this instance invalidated its cache at the transition; the other one still serves v1 until its TTL runs out
        expect((await svc().resolve('CONSENT_DEFAULTS', { market: 'EG' })).versionId).toBe(v2.id);
        expect((await other.resolve('CONSENT_DEFAULTS', { market: 'EG' })).versionId).toBe(v1.id);
        const mid = (await api('get', '/config/propagation?kind=CONSENT_DEFAULTS', A).expect(200)).body;
        expect(mid).toMatchObject({ inForceVersion: 2, converged: false, stale: 1, cacheTtlMs: 250 });
        expect(mid.readers.map((r: { instanceId: string; version: number }) => [r.instanceId.startsWith('api@other') ? 'other' : 'self', r.version]).sort()).toEqual([['other', 1], ['self', 2]]);
        await new Promise((r) => setTimeout(r, 330));
        expect((await other.resolve('CONSENT_DEFAULTS', { market: 'EG' })).versionId).toBe(v2.id); // refreshed, nobody redeployed
        const done = (await api('get', '/config/propagation?kind=CONSENT_DEFAULTS', A).expect(200)).body;
        expect(done).toMatchObject({ converged: true, stale: 0, liveReaders: 2 });
      } finally { if (prevTtl === undefined) delete process.env.GROWTH_CONFIG_CACHE_TTL_MS; else process.env.GROWTH_CONFIG_CACHE_TTL_MS = prevTtl; svc().invalidate(); }
    });
    it('the cache never serves past the instant a scheduled version takes over', async () => {
      const prevTtl = process.env.GROWTH_CONFIG_CACHE_TTL_MS; process.env.GROWTH_CONFIG_CACHE_TTL_MS = '60000';
      try {
        const d = await draft(A, { payload: consent({ maxMarketingPerDay: 4 }), effectiveFrom: new Date(Date.now() + 700).toISOString() }); await submit(A, d.id); await approve(B, d.id).expect(200);
        const first = await svc().resolve('CONSENT_DEFAULTS', { market: 'EG' });
        expect(first.source).toBe('PROPOSED_DEFAULT');
        await new Promise((r) => setTimeout(r, 900));
        expect((await svc().resolve('CONSENT_DEFAULTS', { market: 'EG' })).versionId).toBe(d.id);
      } finally { if (prevTtl === undefined) delete process.env.GROWTH_CONFIG_CACHE_TTL_MS; else process.env.GROWTH_CONFIG_CACHE_TTL_MS = prevTtl; svc().invalidate(); }
    });
  });

  describe('role matrix over HTTP', () => {
    it('patients and unauthenticated callers reach nothing; ops admin reads; finance sees money; support reviews fraud; only super admin manages', async () => {
      for (const p of ['/overview', '/config', '/audit', '/finance', '/integrations', '/access']) { expect((await api('get', p, patient)).status).toBe(403); expect((await c.http().get(`/api/v1/ops/growth${p}`)).status).toBe(401); }
      for (const p of ['/overview', '/channels', '/seo/status', '/widgets', '/templates', '/integrations', '/fraud/signals', '/audit', '/markets', '/analytics', '/config']) expect((await api('get', p, ops)).status).toBe(200);
      expect((await api('get', '/finance', ops)).status).toBe(403); expect((await api('get', '/finance', sup)).status).toBe(403);
      expect((await api('get', '/finance', fin)).status).toBe(200); expect((await api('get', '/finance', A)).status).toBe(200);
      expect((await api('get', '/access', fin)).body.capabilities).toMatchObject({ read: true, readFinance: true, writeConfig: false, approveConfig: false, reviewFraud: false });
      expect((await api('get', '/access', A)).body.capabilities).toMatchObject({ writeConfig: true, approveConfig: true, manage: true, reviewFraud: true });
    });
    it('channel, widget and fraud actions are audited, role-bound and idempotent-safe', async () => {
      const src = await c.prisma.growthAcquisitionSource.create({ data: { sourceKind: 'CAMPAIGN', sourceRef: 'spring', label: 'Spring' } });
      expect((await api('patch', `/channels/${src.id}`, ops, { active: false })).status).toBe(403);
      expect((await api('patch', `/channels/${src.id}`, A, { active: false, label: 'Spring (paused)' }).expect(200)).body).toMatchObject({ active: false, label: 'Spring (paused)' });
      await c.prisma.widgetRegistration.create({ data: { orgRef: 'org_w', origins: ['https://clinic.example.com'] } });
      expect((await api('patch', '/widgets/org_w', sup, { status: 'DISABLED' })).status).toBe(403);
      await api('patch', '/widgets/org_w', A, { status: 'DISABLED' }).expect(200);
      expect((await api('patch', '/widgets/org_w', A, { status: 'BROKEN' })).status).toBe(400);
      const sig = await c.prisma.growthFraudSignal.create({ data: { ruleId: 'CLICK_WITHOUT_RENDER', subjectHash: 'abcdef0123456789abcdef', score: 20 } });
      expect((await api('post', `/fraud/signals/${sig.id}/review`, ops, { status: 'DISMISSED' })).status).toBe(403);
      expect((await api('post', `/fraud/signals/${sig.id}/review`, sup, { status: 'CONFIRMED', note: 'looks scripted' }).expect(200)).body).toMatchObject({ reviewStatus: 'CONFIRMED' });
      expect((await api('post', `/fraud/signals/${sig.id}/review`, A, { status: 'DISMISSED' })).status).toBe(409);
      const q = (await api('get', '/fraud/signals?status=CONFIRMED', ops).expect(200)).body;
      expect(q.counts).toEqual({ OPEN: 0, CONFIRMED: 1, DISMISSED: 0 }); expect(q.items[0]).toMatchObject({ reviewedBy: 'sup_1', subject: 'abcdef0123' });
      const audit = (await api('get', '/audit', ops).expect(200)).body.items as Array<{ action: string; actor: string }>;
      expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['growth.channel.update', 'growth.widget.status', 'growth.fraud.review']));
      const w = (await api('get', '/widgets', ops).expect(200)).body;
      expect(w.registrations[0]).toMatchObject({ orgRef: 'org_w', status: 'DISABLED', origins: ['https://clinic.example.com'] }); expect(w.audit.length).toBeGreaterThan(0);
    });
  });

  describe('secrets are never returned', () => {
    it('integration status shows modes and secret reference NAMES only, never a value, a prefix or a length', async () => {
      const keys = ['SMS_API_KEY', 'SMS_WEBHOOK_SECRET', 'EMAIL_API_KEY', 'WHATSAPP_API_KEY', 'WHATSAPP_WEBHOOK_SECRET', 'PAYMENT_API_KEY', 'PAYMENT_WEBHOOK_SECRET'] as const;
      const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]])); const sentinels = keys.map((k, i) => `SENTINEL-${i}-s3cr3t-value-${k.toLowerCase()}`);
      keys.forEach((k, i) => { process.env[k] = sentinels[i]; });
      try {
        const res = await api('get', '/integrations', ops).expect(200);
        const text = J(res.body);
        for (const s of sentinels) { expect(text).not.toContain(s); expect(text).not.toContain(s.slice(0, 12)); }
        expect(text).not.toMatch(/s3cr3t/);
        const sms = res.body.providers.find((p: { kind: string }) => p.kind === 'SMS');
        expect(sms.secretRefs).toEqual([{ name: 'SMS_API_KEY', set: true }, { name: 'SMS_WEBHOOK_SECRET', set: true }]);
        expect(sms.mode).toBe('mock'); // mock by default: no go-live without MODE=real
        expect(Object.keys(sms).sort()).toEqual(['apiUrlSet', 'kind', 'mode', 'problems', 'provider', 'ready', 'secretRefs', 'selected', 'senderIdSet']);
        // the same holds for every other growth read model
        for (const p of ['/overview', '/markets', '/config', '/widgets', '/seo/status', '/audit', '/templates']) expect(J((await api('get', p, A).expect(200)).body)).not.toContain('SENTINEL-');
      } finally { keys.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }); }
    });
    it('real mode with a missing key reports the VARIABLE NAME as the problem, not any value', async () => {
      const prev = { m: process.env.SMS_MODE, u: process.env.SMS_API_URL, k: process.env.SMS_API_KEY };
      process.env.SMS_MODE = 'real'; process.env.SMS_API_URL = 'https://sms.example.com'; delete process.env.SMS_API_KEY;
      try {
        const sms = (await api('get', '/integrations', ops).expect(200)).body.providers.find((p: { kind: string }) => p.kind === 'SMS');
        expect(sms).toMatchObject({ mode: 'real', ready: false, secretRefs: [{ name: 'SMS_API_KEY', set: false }, { name: 'SMS_WEBHOOK_SECRET', set: false }] });
        expect(sms.problems).toContain('SMS_API_KEY is required when SMS_MODE=real');
      } finally { for (const [k, v] of Object.entries({ SMS_MODE: prev.m, SMS_API_URL: prev.u, SMS_API_KEY: prev.k })) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
    });
  });

  describe('read models', () => {
    it('overview reports configuration health and funnel counts; templates carry their consent class; markets list the live market with its config versions', async () => {
      await live();
      await c.prisma.growthEvent.create({ data: { name: 'PageViewed' } });
      const o = (await api('get', '/overview?days=7', ops).expect(200)).body;
      expect(o).toMatchObject({ source: 'internal', market: 'EG', days: 7 });
      expect(o.funnel.find((f: { name: string }) => f.name === 'PageViewed').count).toBe(1);
      expect(o.config.find((x: { kind: string }) => x.kind === 'CONSENT_DEFAULTS')).toMatchObject({ source: 'ACTIVE', version: 1 });
      expect(o.config.find((x: { kind: string }) => x.kind === 'SEO')).toMatchObject({ source: 'PROPOSED_DEFAULT' });
      const t = (await api('get', '/templates', ops).expect(200)).body as Array<{ kind: string; consentClass: string; purpose: string; metaApproval: string }>;
      expect(t.find((x) => x.kind === 'BOOKING_CONFIRMED')).toMatchObject({ purpose: 'TRANSACTIONAL', consentClass: 'NONE_REQUIRED', metaApproval: 'NEEDS_HUMAN' });
      expect(t.find((x) => x.kind === 'REMINDER_24H')).toMatchObject({ purpose: 'REMINDER', consentClass: 'REMINDERS_CONSENT' });
      // GRW-P2-E ships the marketing templates (re-engagement, referral nudge, family onboarding), all behind the launch-locked marketing flag: each needs its own consent class and a Meta/counsel approval that is still NEEDS_HUMAN
      const mk = t.filter((x) => x.purpose === 'MARKETING'); expect(mk.map((x) => x.kind).sort()).toEqual(['FAMILY_ONBOARDING', 'REENGAGE_DORMANT', 'REFERRAL_NUDGE']);
      for (const x of mk) expect(x).toMatchObject({ consentClass: 'MARKETING_CONSENT_PER_CHANNEL', metaApproval: 'NEEDS_HUMAN' });
      const m = (await api('get', '/markets', ops).expect(200)).body as Array<{ code: string; live: boolean; marketing: { flags: Array<{ key: string; effective: boolean }> } }>;
      expect(m.find((x) => x.code === 'EG')).toMatchObject({ live: true });
      expect(m[0]!.marketing.flags.find((f) => f.key === 'growth.marketing_messaging')!.effective).toBe(false); // launch-locked, no gate evidence
    });
    it('audit log: growth events only, filters by action prefix and actor, pages with a cursor, rejects bad dates', async () => {
      await live();
      await c.prisma.auditLog.create({ data: { actor: 'x', action: 'flag.changed', resource: 'Flag', resourceId: 'k' } });
      const all = (await api('get', '/audit?take=100', ops).expect(200)).body;
      expect(all.items.every((i: { action: string }) => i.action.startsWith('growth.'))).toBe(true);
      expect(all.items.length).toBeGreaterThanOrEqual(4);
      expect((await api('get', '/audit?action=growth.config.approve', ops)).body.items.map((i: { action: string }) => i.action)).toEqual(['growth.config.approve']);
      expect((await api('get', '/audit?actor=adm_b', ops)).body.items.every((i: { actor: string }) => i.actor === 'adm_b')).toBe(true);
      const p1 = (await api('get', '/audit?take=1', ops)).body; expect(p1.items).toHaveLength(1); expect(p1.nextBefore).toBeTruthy();
      const p2 = (await api('get', `/audit?take=1&before=${encodeURIComponent(p1.nextBefore)}`, ops)).body; expect(p2.items[0].id).not.toBe(p1.items[0].id);
      expect((await api('get', '/audit?from=yesterday', ops)).status).toBe(400);
    });
    it('SEO status exposes thresholds from the SEO config in force, page and slug counts; slugs show their history', async () => {
      await c.prisma.growthLandingPage.create({ data: { pageType: 'SPECIALTY_CITY', locale: 'en', paramsKey: 'a', params: {}, indexable: false, guardResult: { reasons: ['LIVE_PROVIDERS_BELOW_3'] } } });
      await c.prisma.growthSlug.create({ data: { entityType: 'DOCTOR', entityId: 'd1', slug: 'dr-new-name' } });
      await c.prisma.growthSlugHistory.create({ data: { entityType: 'DOCTOR', entityId: 'd1', slug: 'dr-old-name', replacedBy: 'dr-new-name' } });
      const s = (await api('get', '/seo/status', ops).expect(200)).body;
      expect(s.thresholds).toEqual({ minLiveProviders: 3, minUniqueBlocks: 3, maxSiblingSimilarityPercent: 70 });
      expect(s.pages).toMatchObject({ total: 1, indexable: 0, thin: 1, thinReasons: [{ reason: 'LIVE_PROVIDERS_BELOW_3', count: 1 }] });
      expect(s.robots).toMatchObject({ mode: 'DISALLOW_ALL' }); expect(s.slugs).toEqual({ current: 1, history: 1 });
      expect((await api('get', '/seo/slug-history?q=new', ops).expect(200)).body[0]).toMatchObject({ slug: 'dr-new-name', history: [{ slug: 'dr-old-name', replacedBy: 'dr-new-name' }] });
      expect((await api('get', '/seo/redirect-history', ops).expect(200)).body[0]).toMatchObject({ from: 'dr-old-name', to: 'dr-new-name', status: 301 });
      expect((await api('get', '/landing-pages?indexable=false', ops).expect(200)).body).toMatchObject({ total: 1, items: [{ reasons: ['LIVE_PROVIDERS_BELOW_3'] }] });
    });
  });
});
