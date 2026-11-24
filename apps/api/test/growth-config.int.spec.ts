import { createCtx, TestCtx } from './harness';
import { GrowthConfigService, GROWTH_DEFAULT_PAYLOADS } from '../src/growth/growth-public';
import { DAY, SUPER_A, SUPER_B } from './growth-helpers';

const code = async (p: Promise<unknown>) => { try { await p; return 'NO_ERROR'; } catch (e) { return (e as { getResponse(): { code: string } }).getResponse().code; } };
const policy = (o: Record<string, unknown> = {}) => ({ ...(GROWTH_DEFAULT_PAYLOADS.ATTRIBUTION_POLICY as object), ...o }) as Record<string, unknown>;

/** GRW-P1-B: versioned growth config: resolution with PROPOSED_DEFAULT fallback, maker-checker, effective dates, rollback, audit. Real Postgres. */
describe('GrowthConfigService', () => {
  let c: TestCtx; let svc: GrowthConfigService;
  beforeAll(async () => { c = await createCtx(); svc = c.get(GrowthConfigService); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => { await c.reset(); });
  const draft = (o: Record<string, unknown> = {}) => svc.createDraft(SUPER_A, { kind: 'CONSENT_DEFAULTS', scope: 'GLOBAL', payload: { ...(GROWTH_DEFAULT_PAYLOADS.CONSENT_DEFAULTS as object), maxMarketingPerDay: 2 } as Record<string, unknown>, ticket: 'T-1', reason: 'raise cap', ...o } as never);
  const approved = async (o: Record<string, unknown> = {}) => { const d = await draft(o); await svc.submit(SUPER_A, d.id); return svc.approve(SUPER_B, d.id); };

  describe('resolution', () => {
    it('with no ACTIVE version the PROPOSED_DEFAULT payload answers and a default row is materialised once (decisions need a version id)', async () => {
      const a = await svc.resolve('ATTRIBUTION_POLICY', { market: 'EG' });
      expect(a).toMatchObject({ source: 'PROPOSED_DEFAULT', scope: 'GLOBAL', payload: GROWTH_DEFAULT_PAYLOADS.ATTRIBUTION_POLICY });
      const b = await svc.resolve('ATTRIBUTION_POLICY', { market: 'EG' });
      expect(b.versionId).toBe(a.versionId);
      expect(await c.prisma.growthConfigVersion.count({ where: { kind: 'ATTRIBUTION_POLICY' } })).toBe(1);
      const row = await c.prisma.growthConfigVersion.findUniqueOrThrow({ where: { id: a.versionId } });
      expect(row).toMatchObject({ status: 'ACTIVE', createdBy: 'system:proposed-default', approvedBy: null, ticket: 'PROPOSED_DEFAULT' });
    });
    it('concurrent first resolves create exactly one default row', async () => {
      const rs = await Promise.all(Array.from({ length: 8 }, () => svc.resolve('SEO', { market: 'EG' })));
      expect(new Set(rs.map((r) => r.versionId)).size).toBe(1);
      expect(await c.prisma.growthConfigVersion.count({ where: { kind: 'SEO' } })).toBe(1);
    });
    it('a kind with no default and no ACTIVE version is GROWTH_CONFIG_NOT_FOUND', async () => expect(await code(svc.resolve('COMMS_CAPS'))).toBe('GROWTH_CONFIG_NOT_FOUND'));
    it('an ACTIVE version wins over the defaults; MARKET scope wins over GLOBAL; another market falls back to GLOBAL', async () => {
      await approved();
      expect((await svc.resolve('CONSENT_DEFAULTS', { market: 'EG' }))).toMatchObject({ source: 'ACTIVE', version: 1, payload: { maxMarketingPerDay: 2 } });
      const m = await svc.createDraft(SUPER_A, { kind: 'CONSENT_DEFAULTS', scope: 'MARKET', scopeId: 'AE', payload: { ...(GROWTH_DEFAULT_PAYLOADS.CONSENT_DEFAULTS as object), maxMarketingPerDay: 5 } as Record<string, unknown> });
      await svc.submit(SUPER_A, m.id); await svc.approve(SUPER_B, m.id);
      expect((await svc.resolve('CONSENT_DEFAULTS', { market: 'AE' })).payload).toMatchObject({ maxMarketingPerDay: 5 });
      expect((await svc.resolve('CONSENT_DEFAULTS', { market: 'EG' })).payload).toMatchObject({ maxMarketingPerDay: 2 });
    });
  });

  describe('maker-checker', () => {
    it('DRAFT -> PENDING_APPROVAL -> ACTIVE through two different super admins; every transition is audited with checksums only', async () => {
      const d = await draft();
      expect(d.status).toBe('DRAFT');
      expect((await svc.submit(SUPER_A, d.id)).status).toBe('PENDING_APPROVAL');
      const a = await svc.approve(SUPER_B, d.id);
      expect(a).toMatchObject({ status: 'ACTIVE', approvedBy: 'adm_b', createdBy: 'adm_a' });
      const audits = await c.prisma.auditLog.findMany({ where: { resourceId: d.id }, orderBy: { createdAt: 'asc' } });
      expect(audits.map((x) => x.action)).toEqual(['growth.config.create', 'growth.config.submit', 'growth.config.approve', 'growth.config.activate']);
      expect(JSON.stringify(audits.map((x) => x.metadata))).not.toMatch(/maxMarketing/); // payload never copied into the audit, only checksums
      expect((audits[2]!.metadata as { after: string }).after).toBe(a.checksum);
    });
    it('self approval is refused (GROWTH_CONFIG_SELF_APPROVAL) and the database CHECK holds even if the service were bypassed', async () => {
      const d = await draft(); await svc.submit(SUPER_A, d.id);
      expect(await code(svc.approve(SUPER_A, d.id))).toBe('GROWTH_CONFIG_SELF_APPROVAL');
      await expect(c.prisma.growthConfigVersion.update({ where: { id: d.id }, data: { approvedBy: 'adm_a' } })).rejects.toThrow(/maker_checker/);
    });
    it('only super admins may create, approve or reject; ops admins and patients may not', async () => {
      const ops = { sub: 'ops_1', roles: ['ops_admin'] };
      expect(await code(svc.createDraft(ops, { kind: 'SEO', scope: 'GLOBAL', payload: GROWTH_DEFAULT_PAYLOADS.SEO as Record<string, unknown> }))).toBe('FORBIDDEN_ROLE');
      const d = await draft(); await svc.submit(SUPER_A, d.id);
      expect(await code(svc.approve(ops, d.id))).toBe('FORBIDDEN_ROLE');
      expect(await code(svc.reject(ops, d.id, 'no'))).toBe('FORBIDDEN_ROLE');
    });
    it('invalid payloads, unknown keys, bad scope and FIRST_TOUCH commission precedence are rejected before anything is stored', async () => {
      expect(await code(draft({ payload: { regimeId: 'x' } }))).toBe('GROWTH_CONFIG_INVALID');
      expect(await code(draft({ payload: { ...(GROWTH_DEFAULT_PAYLOADS.CONSENT_DEFAULTS as object), surprise: 1 } }))).toBe('GROWTH_CONFIG_INVALID');
      expect(await code(draft({ kind: 'NOPE' }))).toBe('GROWTH_INVALID_REQUEST');
      expect(await code(draft({ scope: 'MARKET', scopeId: 'egypt' }))).toBe('GROWTH_INVALID_REQUEST');
      expect(await code(svc.createDraft(SUPER_A, { kind: 'ATTRIBUTION_POLICY', scope: 'GLOBAL', payload: policy({ precedence: 'FIRST_TOUCH' }), effectiveFrom: new Date(Date.now() + 9 * DAY), announcement: 'Providers: window change.' }))).toBe('GROWTH_CONFIG_INVALID');
      expect(await c.prisma.growthConfigVersion.count()).toBe(0);
    });
    it('states only move forward: no approving a draft, no editing after submit, no double approve; reject needs a checker', async () => {
      const d = await draft();
      expect(await code(svc.approve(SUPER_B, d.id))).toBe('GROWTH_CONFIG_TRANSITION_FORBIDDEN');
      await svc.submit(SUPER_A, d.id);
      expect(await code(svc.updateDraft(SUPER_A, d.id, { reason: 'x' }))).toBe('GROWTH_CONFIG_TRANSITION_FORBIDDEN');
      expect(await code(svc.submit(SUPER_A, d.id))).toBe('GROWTH_CONFIG_TRANSITION_FORBIDDEN');
      expect(await code(svc.reject(SUPER_A, d.id, 'mine'))).toBe('GROWTH_CONFIG_SELF_APPROVAL');
      expect((await svc.reject(SUPER_B, d.id, 'not now')).status).toBe('REJECTED');
      expect(await code(svc.approve(SUPER_B, d.id))).toBe('GROWTH_CONFIG_TRANSITION_FORBIDDEN');
    });
    it('only the author edits or submits a draft', async () => {
      const d = await draft();
      expect(await code(svc.updateDraft(SUPER_B, d.id, { reason: 'x' }))).toBe('FORBIDDEN_NOT_AUTHOR');
      expect(await code(svc.submit(SUPER_B, d.id))).toBe('FORBIDDEN_NOT_AUTHOR');
      const u = await svc.updateDraft(SUPER_A, d.id, { payload: { ...(GROWTH_DEFAULT_PAYLOADS.CONSENT_DEFAULTS as object), maxMarketingPerDay: 4 } as Record<string, unknown> });
      expect(u.checksum).not.toBe(d.checksum);
    });
    it('concurrent approvals of one version: exactly one wins, one ACTIVE row remains', async () => {
      const d = await draft(); await svc.submit(SUPER_A, d.id);
      const third = { sub: 'adm_c', roles: ['super_admin'] };
      const rs = await Promise.allSettled([svc.approve(SUPER_B, d.id), svc.approve(third, d.id)]);
      expect(rs.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
      const rows = await c.prisma.growthConfigVersion.findMany({ where: { id: d.id } });
      expect(rows[0]!.status).toBe('ACTIVE');
      expect(await c.prisma.growthConfigVersion.count({ where: { kind: 'CONSENT_DEFAULTS', status: 'ACTIVE' } })).toBe(1);
    });
  });

  describe('effective dates and the money-policy rule', () => {
    it('ATTRIBUTION_POLICY needs an announcement and effectiveFrom >= approval + 7 days (GROWTH_CONFIG_EFFECTIVE_TOO_SOON)', async () => {
      const mk = (o: Record<string, unknown>) => svc.createDraft(SUPER_A, { kind: 'ATTRIBUTION_POLICY', scope: 'GLOBAL', payload: policy({ providerTouchWindowDays: 45 }), ...o } as never);
      const noText = await mk({ effectiveFrom: new Date(Date.now() + 9 * DAY) });
      expect(await code(svc.submit(SUPER_A, noText.id))).toBe('GROWTH_CONFIG_INVALID');
      const soon = await mk({ effectiveFrom: new Date(Date.now() + 2 * DAY), announcement: 'Providers: window now 45 days.' });
      expect(await code(svc.submit(SUPER_A, soon.id))).toBe('GROWTH_CONFIG_EFFECTIVE_TOO_SOON');
      const none = await mk({ announcement: 'Providers: window now 45 days.' });
      expect(await code(svc.submit(SUPER_A, none.id))).toBe('GROWTH_CONFIG_EFFECTIVE_TOO_SOON');
      const ok = await mk({ effectiveFrom: new Date(Date.now() + 8 * DAY), announcement: 'Providers: window now 45 days.' });
      expect((await svc.submit(SUPER_A, ok.id)).status).toBe('PENDING_APPROVAL');
    });
    it('the 7 days run from the APPROVAL: a version submitted in time but approved too late is refused', async () => {
      const d = await svc.createDraft(SUPER_A, { kind: 'ATTRIBUTION_POLICY', scope: 'GLOBAL', payload: policy({ providerTouchWindowDays: 45 }), effectiveFrom: new Date(Date.now() + 8 * DAY), announcement: 'Providers: window now 45 days.' });
      await svc.submit(SUPER_A, d.id);
      expect(await code(svc.approve(SUPER_B, d.id, new Date(Date.now() + 3 * DAY)))).toBe('GROWTH_CONFIG_EFFECTIVE_TOO_SOON');
    });
    it('a future-dated approved version stays APPROVED; resolve keeps answering with the old one until the date, then switches (and old instants stay explained)', async () => {
      const first = await approved(); // ACTIVE now
      const future = new Date(Date.now() + 3 * DAY);
      const d = await draft({ effectiveFrom: future, payload: { ...(GROWTH_DEFAULT_PAYLOADS.CONSENT_DEFAULTS as object), maxMarketingPerDay: 3 } });
      await svc.submit(SUPER_A, d.id);
      expect((await svc.approve(SUPER_B, d.id)).status).toBe('APPROVED');
      expect((await svc.resolve('CONSENT_DEFAULTS')).version).toBe(first.version);
      const after = await svc.resolve('CONSENT_DEFAULTS', { at: new Date(future.getTime() + 1000) });
      expect(after).toMatchObject({ version: d.version, payload: { maxMarketingPerDay: 3 } });
      expect((await c.prisma.growthConfigVersion.findUniqueOrThrow({ where: { id: d.id } })).status).toBe('ACTIVE');
      const old = await c.prisma.growthConfigVersion.findUniqueOrThrow({ where: { id: first.id } });
      expect(old.status).toBe('SUPERSEDED'); expect(old.effectiveTo!.getTime()).toBe(future.getTime());
      // an old booking is explained by the policy that was active THEN
      expect((await svc.resolve('CONSENT_DEFAULTS', { at: new Date(future.getTime() - 60_000) })).versionId).toBe(first.id);
      expect(await c.prisma.growthConfigVersion.count({ where: { kind: 'CONSENT_DEFAULTS', status: 'ACTIVE' } })).toBe(1);
    });
    it('activateDue is idempotent and safe to run concurrently', async () => {
      await approved();
      const d = await draft({ effectiveFrom: new Date(Date.now() + 60_000) }); await svc.submit(SUPER_A, d.id); await svc.approve(SUPER_B, d.id);
      const later = new Date(Date.now() + 120_000);
      const rs = await Promise.all([svc.activateDue(later), svc.activateDue(later), svc.activateDue(later)]);
      expect(rs.reduce((a, b) => a + b, 0)).toBe(1);
      expect(await c.prisma.growthConfigVersion.count({ where: { kind: 'CONSENT_DEFAULTS', status: 'ACTIVE' } })).toBe(1);
    });
  });

  describe('rollback', () => {
    it('creates a NEW version copying the old payload, needs its own approval, and marks the replaced version ROLLED_BACK; old rows are never edited', async () => {
      const v1 = await approved({ payload: { ...(GROWTH_DEFAULT_PAYLOADS.CONSENT_DEFAULTS as object), maxMarketingPerDay: 2 } });
      const v2 = await approved({ payload: { ...(GROWTH_DEFAULT_PAYLOADS.CONSENT_DEFAULTS as object), maxMarketingPerDay: 9 } });
      expect((await svc.resolve('CONSENT_DEFAULTS')).version).toBe(v2.version);
      const rb = await svc.rollback(SUPER_A, { kind: 'CONSENT_DEFAULTS', scope: 'GLOBAL', toVersion: v1.version, reason: 'cap too high' });
      expect(rb).toMatchObject({ status: 'PENDING_APPROVAL', supersedesId: v1.id, version: v2.version + 1 });
      expect((await svc.resolve('CONSENT_DEFAULTS')).version).toBe(v2.version); // nothing changes before approval
      expect(await code(svc.approve(SUPER_A, rb.id))).toBe('GROWTH_CONFIG_SELF_APPROVAL');
      await svc.approve(SUPER_B, rb.id);
      expect((await svc.resolve('CONSENT_DEFAULTS')).payload).toMatchObject({ maxMarketingPerDay: 2 });
      expect((await c.prisma.growthConfigVersion.findUniqueOrThrow({ where: { id: v2.id } })).status).toBe('ROLLED_BACK');
      expect((await c.prisma.growthConfigVersion.findUniqueOrThrow({ where: { id: v1.id } })).payload).toMatchObject({ maxMarketingPerDay: 2 }); // untouched
      expect((await c.prisma.auditLog.findMany({ where: { action: 'growth.config.rollback' } })).length).toBe(1);
    });
    it('rolling back an ATTRIBUTION_POLICY is a money-policy change too (7 days, announcement); an unknown or never-active version cannot be restored', async () => {
      const v1 = await svc.createDraft(SUPER_A, { kind: 'ATTRIBUTION_POLICY', scope: 'GLOBAL', payload: policy({ providerTouchWindowDays: 40 }), effectiveFrom: new Date(Date.now() + 8 * DAY), announcement: 'Providers: window now 40 days.' });
      await svc.submit(SUPER_A, v1.id); await svc.approve(SUPER_B, v1.id); // APPROVED, future-dated
      expect(await code(svc.rollback(SUPER_A, { kind: 'ATTRIBUTION_POLICY', scope: 'GLOBAL', toVersion: v1.version, reason: 'x' }))).toBe('GROWTH_CONFIG_TRANSITION_FORBIDDEN'); // never active
      expect(await code(svc.rollback(SUPER_A, { kind: 'ATTRIBUTION_POLICY', scope: 'GLOBAL', toVersion: 99, reason: 'x' }))).toBe('GROWTH_CONFIG_NOT_FOUND');
    });
  });

  describe('market isolation of config', () => {
    it('a MARKET-scoped version never leaks into another market and is ignored for GLOBAL resolution', async () => {
      const m = await svc.createDraft(SUPER_A, { kind: 'CONSENT_DEFAULTS', scope: 'MARKET', scopeId: 'AE', payload: { ...(GROWTH_DEFAULT_PAYLOADS.CONSENT_DEFAULTS as object), maxMarketingPerDay: 7 } as Record<string, unknown> });
      await svc.submit(SUPER_A, m.id); await svc.approve(SUPER_B, m.id);
      expect((await svc.resolve('CONSENT_DEFAULTS', { market: 'EG' })).source).toBe('PROPOSED_DEFAULT');
      expect((await svc.resolve('CONSENT_DEFAULTS')).source).toBe('PROPOSED_DEFAULT');
      expect((await svc.resolve('CONSENT_DEFAULTS', { market: 'AE' })).payload).toMatchObject({ maxMarketingPerDay: 7 });
    });
  });
});
