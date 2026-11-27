import { createCtx, TestCtx } from './harness';
import { SitePlansService } from '../src/site-plans/site-plans.service';
import { DEFAULT_CONTENT } from '../src/site-plans/site-plans.catalog';

const ADMIN = '/api/v1/admin/kiorly-plans';
const PUBLIC = '/api/v1/public/plans';
const ent = (o: Record<string, unknown>) => Object.entries(o).map(([key, value]) => ({ key, value }));
const price = (o: Record<string, unknown> = {}) => ({ id: 'p1', currency: 'EGP', interval: 'MONTHLY', unit: 'PER_TENANT', amount: '499', includedClinicians: 1, extraClinicianAmount: null, priceVersion: 1, cohortKey: null, ...o });
const catalogue = () => ({
  market: { code: 'EG', currency: 'EGP' },
  plans: [
    { key: 'PRO', nameEn: 'Pro', nameAr: 'برو', sortOrder: 20, entitlements: ent({ max_clinicians: 10, max_branches: 5, mobile_staff_app: true, ai_scribe: false, internal_secret_flag: true }), prices: [price({ id: 'p2', interval: 'ANNUAL', amount: '9990' }), price({ id: 'p3' }), price({ id: 'p4', cohortKey: 'founding', amount: '1' })] },
    { key: 'LITE', nameEn: 'Lite', nameAr: 'لايت', sortOrder: 10, entitlements: ent({ max_clinicians: 2, max_branches: 1, telehealth_video: true }), prices: [] },
  ],
});
const adminState = () => ({
  markets: [{ id: 'mk_EG', code: 'EG', defaultCurrency: 'EGP' }],
  plans: [{ id: 'pl_pro', key: 'PRO', nameEn: 'Pro', nameAr: 'برو', isPublic: true, sortOrder: 20, entitlements: [], prices: [] }],
});

describe('Kiorly site plans: public API and Kiorly admin (Clinic owns plans and prices)', () => {
  let c: TestCtx;
  let svc: SitePlansService;
  beforeAll(async () => { c = await createCtx(); svc = c.app.get(SitePlansService); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => { await c.reset(); svc.invalidate(); c.kiorly.plansPublic = catalogue(); c.kiorly.plansAdmin = adminState(); });
  const sup = async () => ({ Authorization: `Bearer ${await c.token({ sub: 'super_1', roles: ['super_admin'], email: 'founder@example.com' })}` });
  const ops = async () => ({ Authorization: `Bearer ${await c.token({ sub: 'ops_1', roles: ['ops_admin'] })}` });
  const fin = async () => ({ Authorization: `Bearer ${await c.token({ sub: 'fin_1', roles: ['finance'] })}` });

  it('public: no token needed, whitelisted fields only, cohort prices and internal keys dropped, cacheable', async () => {
    const r = await c.http().get(PUBLIC).expect(200);
    expect(r.headers['cache-control']).toMatch(/public, max-age=60/);
    expect(r.body.contract).toBe('kiorly.public-plans.v1');
    expect(r.body.market).toEqual({ code: 'EG', currency: 'EGP' });
    expect(r.body.modules.map((m: any) => m.id)).toEqual(['clinic', 'pharmacy', 'lab']);
    const clinic = r.body.modules[0];
    expect(clinic.plans.map((p: any) => p.id)).toEqual(['lite', 'pro']); // ordered by the Clinic's sortOrder
    const pro = clinic.plans[1];
    expect(pro.prices.map((p: any) => `${p.interval}:${p.amount}`)).toEqual(['MONTHLY:499', 'ANNUAL:9990']); // the founding-cohort price (1) is not public
    expect(pro.limits.en).toEqual(['Up to 10 clinicians', 'Up to 5 branches']);
    expect(pro.features.en).toEqual(['Staff mobile app']);
    expect(JSON.stringify(r.body)).not.toMatch(/internal_secret_flag|cohort|founding|"id":"p\d"/);
    const lite = clinic.plans[0];
    expect(lite.priceStatus).toBe('TO_BE_ANNOUNCED');
    expect(lite.prices).toEqual([]);
  });

  it('public: Pharmacy and Lab carry text but never a price', async () => {
    const r = (await c.http().get(PUBLIC).expect(200)).body;
    for (const id of ['pharmacy', 'lab']) {
      const m = r.modules.find((x: any) => x.id === id);
      expect(m.plans.length).toBe(3);
      for (const p of m.plans) { expect(p.priceStatus).toBe('TO_BE_ANNOUNCED'); expect(p.prices).toEqual([]); expect(p.name.en && p.name.ar).toBeTruthy(); }
    }
  });

  it('public: an unreachable Clinic marks only the Clinic module unavailable; a stale copy is served meanwhile; a bad market is refused', async () => {
    await c.http().get(PUBLIC).expect(200); // warms the cache
    c.kiorly.plansMode = 'down';
    svc['clinicCache'].forEach((v) => { v.at -= 120_000; }); // older than the fresh window, within the stale window
    const stale = (await c.http().get(PUBLIC).expect(200)).body;
    expect(stale.modules[0].status).toBe('OK');
    svc.invalidate();
    const none = (await c.http().get(PUBLIC).expect(200)).body;
    expect(none.modules[0]).toMatchObject({ id: 'clinic', status: 'UNAVAILABLE', plans: [] });
    expect(none.modules[1].status).toBe('OK');
    expect(none.market).toBeNull();
    await c.http().get(`${PUBLIC}?market=EGYPT`).expect(400);
    await c.http().get(`${PUBLIC}?market=1%27`).expect(400);
  });

  it('public: a market the Clinic does not know has no Clinic plans (not an error)', async () => {
    const r = (await c.http().get(`${PUBLIC}?market=SA`).expect(200)).body;
    expect(r.modules[0]).toMatchObject({ id: 'clinic', status: 'OK', plans: [] });
  });

  it('public: the fresh window caches (one Clinic call), a save from the admin shows at once', async () => {
    await c.http().get(PUBLIC).expect(200); await c.http().get(PUBLIC).expect(200);
    expect(c.kiorly.publicPlanHits).toBe(1);
    const cur = (await c.http().get(ADMIN).set(await sup()).expect(200)).body.content;
    const cfg = JSON.parse(JSON.stringify(cur.config)); cfg.pharmacy.plans[0].name = { en: 'Starter', ar: 'بداية' };
    await c.http().put(`${ADMIN}/content`).set(await sup()).send({ version: cur.version, config: cfg }).expect(200);
    const after = (await c.http().get(PUBLIC).expect(200)).body;
    expect(after.modules.find((m: any) => m.id === 'pharmacy').plans[0].name).toEqual({ en: 'Starter', ar: 'بداية' });
  });

  it('public: CORS is route-scoped to the site origin and read-only', async () => {
    process.env.LEADS_PUBLIC_ORIGINS = 'https://site.example.org';
    const ok = await c.http().get(PUBLIC).set('Origin', 'https://site.example.org').expect(200);
    expect(ok.headers['access-control-allow-origin']).toBe('https://site.example.org');
    expect(ok.headers['access-control-allow-credentials']).toBeUndefined();
    const no = await c.http().get(PUBLIC).set('Origin', 'https://evil.example.org').expect(200);
    expect(no.headers['access-control-allow-origin']).toBeUndefined();
    const pre = await c.http().options(PUBLIC).set('Origin', 'https://site.example.org').set('Access-Control-Request-Method', 'GET').expect(204);
    expect(pre.headers['access-control-allow-methods']).toBe('GET, OPTIONS');
    for (const m of ['post', 'put', 'patch', 'delete']) await (c.http() as any)[m](PUBLIC).send({}).expect((r: any) => { if (r.status < 400) throw new Error(`status ${r.status}`); });
    delete process.env.LEADS_PUBLIC_ORIGINS;
  });

  it('admin roles: ops and super admin read, only super admin changes, nothing reaches the Clinic for anyone else', async () => {
    await c.http().get(ADMIN).expect(401);
    await c.http().get(ADMIN).set(await fin()).expect(403);
    expect((await c.http().get(ADMIN).set(await ops()).expect(200)).body.canChange).toBe(false);
    const s = (await c.http().get(ADMIN).set(await sup()).expect(200)).body;
    expect(s.canChange).toBe(true);
    expect(s.clinic.available).toBe(true);
    expect(s.clinic.plans).toHaveLength(1);
    expect(s.content).toMatchObject({ version: 0, isDefault: true });
    for (const [method, path, body] of [['patch', '/clinic/pl_pro', { nameEn: 'X' }], ['post', '/clinic/pl_pro/prices', { marketId: 'mk_EG', currency: 'EGP', interval: 'MONTHLY', unit: 'PER_TENANT', amount: 1 }], ['put', '/content', { version: 0, config: DEFAULT_CONTENT }]] as const) {
      await (c.http() as any)[method](`${ADMIN}${path}`).set(await ops()).send(body).expect(403);
      await (c.http() as any)[method](`${ADMIN}${path}`).set(await fin()).send(body).expect(403);
    }
    expect(c.kiorly.planWrites).toHaveLength(0);
    expect(await c.prisma.sitePlanSetting.count()).toBe(0);
  });

  it('admin: a price is published through the Clinic with the verified actor, whitelisted fields, an audit row, and the site shows it', async () => {
    c.kiorly.plansPublic = catalogue();
    const r = await c.http().post(`${ADMIN}/clinic/pl_pro/prices`).set(await sup()).send({ marketId: 'mk_EG', currency: 'EGP', interval: 'MONTHLY', unit: 'PER_TENANT', amount: '777', validFrom: '2030-01-01T00:00:00.000Z', actor: { id: 'evil' }, planId: 'other', priceVersion: 99 }).expect(200);
    expect(r.body.amount).toBe('777');
    const w = c.kiorly.planWrites[0]!;
    expect(w.path).toBe('/plans/pl_pro/prices');
    expect(w.body.actor).toEqual({ id: 'super_1', email: 'founder@example.com' });
    expect(Object.keys(w.body).sort()).toEqual(['actor', 'amount', 'currency', 'interval', 'marketId', 'unit', 'validFrom']);
    const row = await c.prisma.auditLog.findFirst({ where: { action: 'kiorly.plans.clinic_price' } });
    expect(row).toMatchObject({ actor: 'super_1', resource: 'KiorlyPlans', resourceId: 'pl_pro' });
    expect((row!.metadata as any)).toMatchObject({ outcome: 'OK', amount: '777', currency: 'EGP' });
    // preview does not publish and is audited under its own name
    const pv = await c.http().post(`${ADMIN}/clinic/pl_pro/prices`).set(await sup()).send({ marketId: 'mk_EG', currency: 'EGP', interval: 'MONTHLY', unit: 'PER_TENANT', amount: '800', preview: true }).expect(200);
    expect(pv.body.preview).toBe(true);
    expect(await c.prisma.auditLog.count({ where: { action: 'kiorly.plans.clinic_price_preview' } })).toBe(1);
  });

  it('admin: Clinic refusals pass through with their code and are audited as refused; an unreachable Clinic is a clear 503', async () => {
    expect((await c.http().post(`${ADMIN}/clinic/pl_pro/prices`).set(await sup()).send({ marketId: 'mk_NOPE', currency: 'EGP', interval: 'MONTHLY', unit: 'PER_TENANT', amount: 5 }).expect(400)).body.code).toBe('UNKNOWN_MARKET');
    expect((await c.http().patch(`${ADMIN}/clinic/pl_nope`).set(await sup()).send({ nameEn: 'X' }).expect(404)).body.code).toBe('PLAN_NOT_FOUND');
    expect((await c.prisma.auditLog.findMany({ where: { action: 'kiorly.plans.clinic_price' } })).map((a) => (a.metadata as any).outcome)).toEqual(['REFUSED']);
    c.kiorly.plansMode = 'down';
    expect((await c.http().patch(`${ADMIN}/clinic/pl_pro`).set(await sup()).send({ nameEn: 'X' }).expect(503)).body.code).toBe('CLINIC_UNAVAILABLE');
    const o = (await c.http().get(ADMIN).set(await sup()).expect(200)).body; // the overview still loads (Pharmacy and Lab text is local)
    expect(o.clinic.available).toBe(false);
    expect(o.content.version).toBe(0);
  });

  it('admin: plan metadata change forwards only whitelisted fields; hostile ids and empty bodies are refused before any call', async () => {
    await c.http().patch(`${ADMIN}/clinic/pl_pro`).set(await sup()).send({ nameEn: 'Pro Plus', isPublic: false, key: 'ENTERPRISE', actor: { id: 'x' } }).expect(200);
    expect(Object.keys(c.kiorly.planWrites[0]!.body).sort()).toEqual(['actor', 'isPublic', 'nameEn']);
    c.kiorly.calls = [];
    await c.http().patch(`${ADMIN}/clinic/pl_pro`).set(await sup()).send({ key: 'ENTERPRISE' }).expect(400);
    await c.http().patch(`${ADMIN}/clinic/${'a'.repeat(65)}`).set(await sup()).send({ nameEn: 'x' }).expect(400);
    await c.http().patch(`${ADMIN}/clinic/..%2F..%2Fx`).set(await sup()).send({ nameEn: 'x' }).expect((r) => { if (![400, 404].includes(r.status)) throw new Error(`status ${r.status}`); });
    expect(c.kiorly.calls.filter((x) => x.path.startsWith('/plans'))).toHaveLength(0);
  });

  it('content: versioned save with optimistic concurrency, audited; invalid text and price-like keys are refused', async () => {
    const cur = (await c.http().get(ADMIN).set(await sup()).expect(200)).body.content;
    const cfg = JSON.parse(JSON.stringify(cur.config)); cfg.lab.plans[1].visible = false; cfg.lab.plans[0].summary = { en: 'New text', ar: 'نص جديد' };
    const saved = (await c.http().put(`${ADMIN}/content`).set(await sup()).send({ version: 0, config: cfg }).expect(200)).body;
    expect(saved).toMatchObject({ version: 1, isDefault: false, updatedBy: 'super_1' });
    expect((await c.http().get(PUBLIC).expect(200)).body.modules.find((m: any) => m.id === 'lab').plans.map((p: any) => p.id)).toEqual(['lite', 'chain']);
    expect((await c.http().put(`${ADMIN}/content`).set(await sup()).send({ version: 0, config: cfg }).expect(409)).body.code).toBe('PLAN_CONTENT_STALE');
    const bad = JSON.parse(JSON.stringify(cfg)); bad.pharmacy.plans[0].price = 10;
    expect((await c.http().put(`${ADMIN}/content`).set(await sup()).send({ version: 1, config: bad }).expect(400)).body.code).toBe('INVALID_PLAN_CONTENT');
    const markup = JSON.parse(JSON.stringify(cfg)); markup.pharmacy.plans[0].name.en = '<script>x</script>';
    await c.http().put(`${ADMIN}/content`).set(await sup()).send({ version: 1, config: markup }).expect(400);
    const uneven = JSON.parse(JSON.stringify(cfg)); uneven.pharmacy.plans[0].features.ar.pop();
    await c.http().put(`${ADMIN}/content`).set(await sup()).send({ version: 1, config: uneven }).expect(400);
    await c.http().put(`${ADMIN}/content`).set(await sup()).send({ config: cfg }).expect(400);
    const rows = await c.prisma.auditLog.findMany({ where: { action: 'kiorly.plans.content' }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((a) => (a.metadata as any).outcome)).toEqual(['OK', 'REFUSED']); // a stale save is a refused attempt; a body that fails validation never reaches the store and is not a change attempt
  });

  it('content: a stored document that no longer validates is ignored and the shipped defaults serve (the site must not break)', async () => {
    await c.prisma.sitePlanSetting.create({ data: { key: 'content', value: { pharmacy: 'broken' }, version: 3 } });
    svc.invalidate();
    const r = (await c.http().get(PUBLIC).expect(200)).body;
    expect(r.modules.find((m: any) => m.id === 'pharmacy').plans.length).toBe(3);
    expect((await c.http().get(ADMIN).set(await sup()).expect(200)).body.content).toMatchObject({ version: 3, isDefault: true });
  });
});
