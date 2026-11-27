import { createCtx, TestCtx } from './harness';

const B = '/api/v1/admin/kiorly-markets';
const mk = (o: Record<string, unknown> = {}) => ({ id: 'mk_SA', code: 'SA', nameEn: 'Saudi Arabia', nameAr: '', status: 'DRAFT', operationalStatus: 'ACTIVE', operability: 'draft', readiness: { taxPack: { ok: true }, crossBorder: { required: false, approved: true }, hostCellKnown: true, commercialConfigured: false, blockers: [], canLaunch: true }, ...o });

describe('Kiorly admin: market launch through the Clinic signed route (ADR-060)', () => {
  let c: TestCtx;
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => { await c.reset(); });
  const sup = async () => ({ Authorization: `Bearer ${await c.token({ sub: 'super_1', roles: ['super_admin'], email: 'founder@example.com' })}` });
  const ops = async () => ({ Authorization: `Bearer ${await c.token({ sub: 'ops_1', roles: ['ops_admin'] })}` });
  const fin = async () => ({ Authorization: `Bearer ${await c.token({ sub: 'fin_1', roles: ['finance'] })}` });
  const patient = async () => ({ Authorization: `Bearer ${await c.token({ sub: 'sub_x', roles: ['patient'] })}` });

  it('lists the Clinic markets with the read-only Kiorex state of the same country; super admin may change, ops may not', async () => {
    c.kiorly.markets = [mk({ id: 'mk_EG', code: 'EG', status: 'LIVE', operability: 'active' }), mk()];
    const a = (await c.http().get(B).set(await sup()).expect(200)).body;
    expect(a.canChange).toBe(true);
    expect(a.items).toHaveLength(2);
    const eg = a.items.find((m: any) => m.code === 'EG');
    expect(eg.kiorex).toMatchObject({ known: true, live: true, flag: 'market.eg.live' });
    expect(a.items.find((m: any) => m.code === 'SA').kiorex).toMatchObject({ known: false, live: false, state: 'NOT_CONFIGURED' });
    const o = (await c.http().get(B).set(await ops()).expect(200)).body;
    expect(o.canChange).toBe(false);
  });

  it('role refusals: patient 403, finance 403, ops can read but every change is 403 and never reaches the Clinic', async () => {
    c.kiorly.markets = [mk()];
    await c.http().get(B).set(await patient()).expect(403);
    await c.http().get(B).set(await fin()).expect(403);
    await c.http().get(B).expect(401);
    for (const [method, path, body] of [['post', '', { code: 'SA', reason: 'x y z' }], ['post', '/mk_SA/launch', { reason: 'go now' }], ['post', '/mk_SA/pause', { reason: 'pause it', days: 3 }], ['post', '/mk_SA/disable', { reason: 'close it' }], ['post', '/mk_SA/enable', { reason: 'open it' }], ['put', '/mk_SA/tax-pack', { invoiceVatPercent: 14, saasVatPercent: 14, defaultVisitFee: 1, reason: 'x y z' }], ['put', '/mk_SA/legal-config', { reason: 'x y z' }], ['patch', '/mk_SA/second-approver', { requireSecondApprover: true, reason: 'x y z' }], ['post', '/mk_SA/change-requests/r1/approve', {}], ['post', '/mk_SA/change-requests/r1/reject', {}]] as const) {
      await (c.http() as any)[method](`${B}${path}`).set(await ops()).send(body).expect(403);
      await (c.http() as any)[method](`${B}${path}`).set(await fin()).send(body).expect(403);
      await (c.http() as any)[method](`${B}${path}`).set(await patient()).send(body).expect(403);
    }
    expect(c.kiorly.marketWrites).toHaveLength(0);
    await c.http().get(`${B}/mk_SA`).set(await ops()).expect(200);
    await c.http().get(`${B}/mk_SA/audit`).set(await ops()).expect(200);
  });

  it('Go live: the Clinic receives the actor from the verified token (never from the body), only whitelisted fields, and an audit row is written here too', async () => {
    c.kiorly.markets = [mk()];
    const r = await c.http().post(`${B}/mk_SA/launch`).set(await sup()).send({ reason: 'Counsel approved', approvalRef: 'DOC-5', approvalLink: 'https://docs.example.org/5', actor: { id: 'evil-admin' }, status: 'LIVE', code: 'EG', days: 99 }).expect(200);
    expect(r.body.status).toBe('LIVE');
    const w = c.kiorly.marketWrites[0]!;
    expect(w.path).toBe('/markets/mk_SA/launch');
    expect(w.body.actor).toEqual({ id: 'super_1', email: 'founder@example.com' });
    expect(Object.keys(w.body).sort()).toEqual(['actor', 'approvalLink', 'approvalRef', 'days', 'reason']);
    expect(w.body).not.toHaveProperty('status');
    const row = await c.prisma.auditLog.findFirst({ where: { action: 'kiorly.market.launch' } });
    expect(row).toMatchObject({ actor: 'super_1', resource: 'KiorlyMarket', resourceId: 'mk_SA' });
    expect((row!.metadata as any).outcome).toBe('OK');
    // the same click twice: the Clinic answers 409 and the console sees its own code
    const again = await c.http().post(`${B}/mk_SA/launch`).set(await sup()).send({ reason: 'Counsel approved' }).expect(409);
    expect(again.body.code).toBe('MARKET_ALREADY_LIVE');
    expect((await c.prisma.auditLog.findMany({ where: { action: 'kiorly.market.launch' } })).map((a) => (a.metadata as any).outcome).sort()).toEqual(['OK', 'REFUSED']);
  });

  it('Clinic refusals pass through with their own code (tax pack, missing reason), and nothing is invented on this side', async () => {
    c.kiorly.markets = [mk({ readiness: { ...mk().readiness, canLaunch: false } })];
    expect((await c.http().post(`${B}/mk_SA/launch`).set(await sup()).send({ reason: 'Go ahead now' }).expect(400)).body.code).toBe('TAX_PACK_MISSING');
    expect((await c.http().post(`${B}/mk_SA/launch`).set(await sup()).send({}).expect(400)).body.code).toBe('REASON_REQUIRED');
    expect((await c.http().post(`${B}/mk_NOPE/launch`).set(await sup()).send({ reason: 'x y z' }).expect(404)).body.code).toBe('MARKET_NOT_FOUND');
  });

  it('an unreachable Clinic is a clear 503, a missing scope is surfaced, hostile ids and bodies are refused before any call', async () => {
    c.kiorly.markets = [mk()];
    c.kiorly.marketsMode = '5xx';
    const down = await c.http().get(B).set(await sup()).expect(503);
    expect(down.body.code).toBe('CLINIC_UNAVAILABLE');
    expect((await c.http().post(`${B}/mk_SA/launch`).set(await sup()).send({ reason: 'go now' }).expect(503)).body.code).toBe('CLINIC_UNAVAILABLE');
    c.kiorly.marketsMode = 'scope';
    expect((await c.http().get(B).set(await sup()).expect(403)).body.code).toBe('MARKET_ADMIN_SCOPE_REQUIRED');
    c.kiorly.marketsMode = undefined;
    c.kiorly.calls = [];
    await c.http().get(`${B}/..%2F..%2Fx`).set(await sup()).expect((r) => { if (![400, 404].includes(r.status)) throw new Error(`status ${r.status}`); });
    await c.http().post(`${B}/${'a'.repeat(65)}/launch`).set(await sup()).send({ reason: 'go now' }).expect(400);
    await c.http().post(`${B}/mk_SA/launch`).set(await sup()).send({ reason: 'x'.repeat(1201) }).expect(400);
    await c.http().post(`${B}/mk_SA/launch`).set(await sup()).send('not json').set('content-type', 'application/json').expect(400);
    await c.http().put(`${B}/mk_SA/tax-pack`).set(await sup()).send({ invoiceVatPercent: 'a lot' }).expect(400);
    await c.http().patch(`${B}/mk_SA/second-approver`).set(await sup()).send({ requireSecondApprover: 'yes' }).expect(400);
    expect(c.kiorly.calls.filter((x) => x.path.startsWith('/markets'))).toHaveLength(0);
  });

  it('create, tax pack, audit and requests are forwarded; the audit trail is read-only through here', async () => {
    const created = (await c.http().post(B).set(await sup()).send({ code: 'SA', nameEn: 'Saudi Arabia', reason: 'Initiate' }).expect(201)).body;
    expect(created.status).toBe('DRAFT');
    expect(c.kiorly.marketWrites[0]!.body).toMatchObject({ code: 'SA', actor: { id: 'super_1' } });
    expect((await c.http().post(B).set(await sup()).send({ code: 'SA', nameEn: 'Saudi Arabia' }).expect(409)).body.code).toBe('MARKET_EXISTS');
    await c.http().put(`${B}/${created.id}/tax-pack`).set(await sup()).send({ invoiceVatPercent: 15, saasVatPercent: 15, defaultVisitFee: 200, reason: 'Tax pack' }).expect(200);
    expect(c.kiorly.marketWrites.at(-1)!.path).toBe(`/markets/${created.id}/tax-pack`);
    await c.http().post(`${B}/${created.id}/launch`).set(await sup()).send({ reason: 'Go live now' }).expect(200);
    const audit = (await c.http().get(`${B}/${created.id}/audit?limit=5`).set(await ops()).expect(200)).body;
    expect(audit.items[0]).toMatchObject({ action: 'LAUNCH', actorId: 'kiorly-admin:super_1' });
    for (const m of ['post', 'put', 'patch', 'delete']) await (c.http() as any)[m](`${B}/${created.id}/audit`).set(await sup()).send({}).expect(404);
    expect((await c.http().get(`${B}/${created.id}/change-requests?status=BOGUS`).set(await ops())).status).toBe(400);
    expect((await c.http().get(`${B}/country-defaults`).set(await ops()).expect(200)).body[0].code).toBe('SA');
  });

  it('a large market list and a long audit trail come through whole', async () => {
    c.kiorly.markets = Array.from({ length: 300 }, (_, n) => mk({ id: `mk_${n}`, code: `C${n}` }));
    expect((await c.http().get(B).set(await sup()).expect(200)).body.items).toHaveLength(300);
    c.kiorly.marketAudit.set('mk_0', Array.from({ length: 200 }, (_, n) => ({ id: `a${n}`, action: 'X' })));
    expect((await c.http().get(`${B}/mk_0/audit?limit=100000`).set(await sup()).expect(200)).body.items).toHaveLength(200);
  });
});
