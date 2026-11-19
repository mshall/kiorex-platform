import { createServer } from 'node:http';
import { verifyWebhook, verifySnapshot, evaluateFlag, FLAG_KEYS } from '@kiorex/contracts';
import { createCtx, productHeaders, TestCtx } from './harness';
import { FLAG_CATALOGUE } from '../src/control-plane/control-plane-public';
import { OutboxService } from '../src/outbox/outbox-public';

const SNAP = '/api/v1/control/v1/flags/snapshot';

describe('control plane (KXM-OP-07..11)', () => {
  let c: TestCtx;
  let a1: { Authorization: string }; let a2: { Authorization: string };
  beforeAll(async () => { c = await createCtx({ devMarketGate: false }); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => {
    await c.reset();
    a1 = await c.as('admin_1', { roles: ['ops_admin', 'super_admin'] });
    a2 = await c.as('admin_2', { roles: ['ops_admin', 'super_admin'] });
  });
  const set = (h: any, key: string, body: object) => c.http().put(`/api/v1/admin/flags/${key}/values`).set(h).send({ reason: 'test', ticket: 'T-1', ...body });
  const snap = (product: string, extra: Record<string, string> = {}) => c.http().get(`${SNAP}?product=${product}`).set({ ...productHeaders(product, SNAP), ...extra });

  it('registry is seeded from the full KX-08 §09 catalogue (all products) and matches @kiorex/contracts FLAG_KEYS', async () => {
    const keys = (await c.prisma.flagDefinition.findMany()).map((f) => f.key);
    for (const k of FLAG_KEYS) expect(keys).toContain(k);
    expect(keys.filter((k) => k.startsWith('clinic.specialty_templates.'))).toHaveLength(11);
    expect(keys).toContain('market.eg.live');
    const products = new Set((await c.prisma.flagDefinition.findMany()).map((f) => f.product));
    expect([...products].sort()).toEqual(['all', 'kiorex', 'kiorex-account', 'kiorly-clinic', 'kiorly-lab', 'kiorly-pharmacy']);
    expect(FLAG_CATALOGUE.length).toBe(keys.length);
    expect(await c.prisma.flagGateEvidence.count()).toBe(0); // seed never satisfies a gate
  });

  it('snapshot: HMAC product key, signed, ETag/304, product isolation, replay protection', async () => {
    const r = await snap('kiorex').expect(200);
    expect(r.body.product).toBe('kiorex');
    expect(r.headers.etag).toMatch(/^"v\d+:kiorex"$/);
    expect(verifySnapshot('ff_dev_secret_change_me', r.body)).toBe(true);
    expect(verifySnapshot('wrong', r.body)).toBe(false);
    const f = r.body.flags.find((x: any) => x.key === 'kiorex.ai_navigation');
    expect(f).toMatchObject({ launchLocked: true, gateSatisfied: false, class: 'LAUNCH_LOCKED' });
    expect(r.body.flags.some((x: any) => x.key === 'clinic.ai_scribe')).toBe(false);
    await snap('kiorex', { 'if-none-match': r.headers.etag }).expect(304);
    // unsigned / wrong secret / wrong product
    await c.http().get(`${SNAP}?product=kiorex`).expect(401);
    await c.http().get(`${SNAP}?product=kiorex`).set(productHeaders('kiorex', SNAP, 'nope')).expect(401);
    await c.http().get(`${SNAP}?product=kiorly-clinic`).set(productHeaders('kiorex', SNAP)).expect(403);
    const h = productHeaders('kiorex', SNAP);
    await c.http().get(`${SNAP}?product=kiorex`).set(h).expect(200);
    await c.http().get(`${SNAP}?product=kiorex`).set(h).expect(401); // same nonce
    // clinic snapshot includes cross-product dependencies so it can be evaluated locally
    const clinic = (await snap('kiorly-clinic').expect(200)).body;
    expect(clinic.flags.map((x: any) => x.key)).toEqual(expect.arrayContaining(['clinic.kiorex_listing', 'kiorex.marketplace', 'market.eg.live']));
  });

  it('any OFF wins across global/market/org; lower scope cannot re-enable; evaluation matches the contracts evaluator', async () => {
    await set(a1, 'kiorex.family_accounts', { scope: 'MARKET', scopeId: 'eg', value: 'OFF' }).expect(200);
    await set(a1, 'clinic.ai_scribe', { scope: 'ORG', scopeId: 'org_7', value: 'OFF' }).expect(200);
    const s = (await snap('kiorly-clinic').expect(200)).body;
    expect(evaluateFlag(s, 'clinic.ai_scribe', { orgId: 'org_7' }).enabled).toBe(false);
    expect(evaluateFlag(s, 'clinic.ai_scribe', { orgId: 'org_8' }).enabled).toBe(true);
    await set(a1, 'clinic.ai_scribe', { scope: 'GLOBAL', value: 'OFF' }).expect(200);
    await set(a1, 'clinic.ai_scribe', { scope: 'ORG', scopeId: 'org_8', value: 'ON' }).expect(200); // ON never re-enables
    expect((await c.flags.evaluate('clinic.ai_scribe', { orgId: 'org_8' })).effective).toBe(false);
    expect(evaluateFlag((await snap('kiorly-clinic')).body, 'clinic.ai_scribe', { orgId: 'org_8' }).enabled).toBe(false);
    expect((await c.flags.evaluate('kiorex.family_accounts', { market: 'EG' })).scope).toBe('MARKET');
    expect((await c.flags.evaluate('kiorex.family_accounts', { market: 'SA' })).effective).toBe(true);
    // scope not allowed for the flag
    expect((await set(a1, 'kiorex.family_accounts', { scope: 'ORG', scopeId: 'o', value: 'OFF' })).body.code).toBe('SCOPE_NOT_ALLOWED');
  });

  it('OP-08 reason + ticket required, expiry in the past rejected, optional expiry auto-reverts via sweep', async () => {
    await c.http().put('/api/v1/admin/flags/kiorex.reviews/values').set(a1).send({ scope: 'GLOBAL', value: 'OFF' }).expect(400);
    expect((await set(a1, 'kiorex.reviews', { scope: 'GLOBAL', value: 'OFF', expiresAt: new Date(Date.now() - 5000).toISOString() })).body.code).toBe('EXPIRY_IN_PAST');
    await set(a1, 'kiorex.reviews', { scope: 'GLOBAL', value: 'OFF', expiresAt: new Date(Date.now() + 3_600_000).toISOString() }).expect(200);
    expect((await c.flags.evaluate('kiorex.reviews')).effective).toBe(false);
    await c.prisma.flagValue.updateMany({ where: { flagKey: 'kiorex.reviews' }, data: { expiresAt: new Date(Date.now() - 1000) } });
    c.flags.invalidate();
    expect((await c.flags.evaluate('kiorex.reviews')).effective).toBe(true); // expired OFF ignored immediately
    const v0 = await c.flags.currentVersion();
    expect(await c.flags.sweep()).toMatchObject({ expired: 1 });
    expect(await c.flags.currentVersion()).toBeGreaterThan(v0);
    expect((await c.prisma.flagAudit.findFirstOrThrow({ where: { event: 'EXPIRY' } })).flagKey).toBe('kiorex.reviews');
  });

  it('scheduled toggle: OFF only becomes active at startsAt', async () => {
    await set(a1, 'kiorex.reviews', { scope: 'GLOBAL', value: 'OFF', startsAt: new Date(Date.now() + 3_600_000).toISOString() }).expect(200);
    expect((await c.flags.evaluate('kiorex.reviews')).effective).toBe(true);
    await c.prisma.flagValue.updateMany({ where: { flagKey: 'kiorex.reviews' }, data: { startsAt: new Date(Date.now() - 1000) } });
    c.flags.invalidate();
    expect((await c.flags.evaluate('kiorex.reviews')).effective).toBe(false);
  });

  it('OP-09 launch-locked: effective only with gate evidence; OFF "ON · awaiting gate" state; evidence validated; revocable', async () => {
    expect((await c.flags.evaluate('kiorex.telemedicine', { market: 'EG' })).reason).toBe('AWAITING_GATE');
    const row = (await c.http().get('/api/v1/admin/flags').set(a1).expect(200)).body.find((f: any) => f.key === 'kiorex.telemedicine');
    expect(row.state).toBe('ON_AWAITING_GATE');
    await c.http().put('/api/v1/admin/flags/kiorex.telemedicine/gate').set(a1).send({ gateId: 'G-1', approver: 'CMO', approvedOn: '2027-01-01', documentUrl: 'not a url' }).expect(400);
    await c.http().put('/api/v1/admin/flags/kiorex.reviews/gate').set(a1).send({ gateId: 'G-1', approver: 'CMO', approvedOn: '2027-01-01', documentUrl: 'https://docs.example/x' }).expect(400); // not launch-locked
    await c.http().put('/api/v1/admin/flags/kiorex.telemedicine/gate').set(a1).send({ gateId: 'G-1', approver: 'CMO', approvedOn: '2027-01-01', documentUrl: 'https://docs.example/gate' }).expect(200);
    expect((await c.flags.evaluate('kiorex.telemedicine', { market: 'EG' })).effective).toBe(true);
    const s = (await snap('kiorex')).body.flags.find((x: any) => x.key === 'kiorex.telemedicine');
    expect(s.gateSatisfied).toBe(true);
    await c.http().post('/api/v1/admin/flags/kiorex.telemedicine/gate/revoke').set(a1).send({ reason: 'evidence withdrawn' }).expect(200);
    expect((await c.flags.evaluate('kiorex.telemedicine', { market: 'EG' })).effective).toBe(false);
  });

  it('dependencies: child is effective only if its parents are (clinic.commission_settlement ← clinic.kiorex_listing ← kiorex.marketplace)', async () => {
    expect((await c.flags.evaluate('clinic.commission_settlement')).effective).toBe(true);
    await set(a1, 'kiorex.marketplace', { scope: 'GLOBAL', value: 'OFF' }).expect(200);
    const r = await c.flags.evaluate('clinic.commission_settlement');
    expect(r).toMatchObject({ effective: false, reason: 'DEPENDENCY_OFF' });
    expect(r.blockedBy).toBe('kiorex.marketplace');
    expect((await c.flags.evaluate('kiorex.reviews')).effective).toBe(false);
  });

  it('OP-10 two-person rule: money-path global/market OFF needs a different approver; ON and org-scope are single-admin', async () => {
    const r = await set(a1, 'kiorex.pay_deposits', { scope: 'GLOBAL', value: 'OFF' }).expect(200);
    expect(r.body.status).toBe('PENDING_APPROVAL');
    expect((await c.flags.evaluate('kiorex.pay_deposits')).effective).toBe(true);
    expect((await c.http().post(`/api/v1/admin/flags/requests/${r.body.requestId}/approve`).set(a1)).status).toBe(403); // same admin
    await c.http().post(`/api/v1/admin/flags/requests/${r.body.requestId}/approve`).set(a2).expect(200);
    expect((await c.flags.evaluate('kiorex.pay_deposits')).effective).toBe(false);
    const on = await set(a1, 'kiorex.pay_deposits', { scope: 'GLOBAL', value: 'ON' }).expect(200);
    expect(on.body.status).toBe('APPLIED');
    const m = await set(a1, 'kiorex.pay_deposits', { scope: 'MARKET', scopeId: 'EG', value: 'OFF' });
    expect(m.body.status).toBe('PENDING_APPROVAL');
    await c.http().post(`/api/v1/admin/flags/requests/${m.body.requestId}/reject`).set(a2).expect(200);
    expect((await c.flags.evaluate('kiorex.pay_deposits', { market: 'EG' })).effective).toBe(true);
    const org = await set(a1, 'clinic.kiorly_pay_deposits', { scope: 'ORG', scopeId: 'org_1', value: 'OFF' });
    expect(org.body.status).toBe('APPLIED');
    // non-super-admin cannot toggle
    await set(await c.as('ops', { roles: ['ops_admin'] }), 'kiorex.reviews', { scope: 'GLOBAL', value: 'OFF' }).expect(403);
  });

  it('OP-10 emergency single-admin kill applies immediately and creates a 24 h review that surfaces when overdue', async () => {
    const r = await set(a1, 'kiorex.pay_deposits', { scope: 'GLOBAL', value: 'OFF', emergency: true }).expect(200);
    expect(r.body.status).toBe('APPLIED');
    expect((await c.flags.evaluate('kiorex.pay_deposits')).effective).toBe(false);
    const req = await c.prisma.flagChangeRequest.findFirstOrThrow({ where: { emergency: true } });
    expect(req.reviewDueAt!.getTime() - Date.now()).toBeGreaterThan(23 * 3600_000);
    expect((await c.http().get('/api/v1/admin/flags/emergency-reviews/overdue').set(a1)).body).toHaveLength(0);
    await c.prisma.flagChangeRequest.update({ where: { id: req.id }, data: { reviewDueAt: new Date(Date.now() - 1000) } });
    expect((await c.http().get('/api/v1/admin/flags/emergency-reviews/overdue').set(a1)).body).toHaveLength(1);
    await c.http().post(`/api/v1/admin/flags/requests/${req.id}/review`).set(a2).expect(200);
    expect((await c.http().get('/api/v1/admin/flags/emergency-reviews/overdue').set(a1)).body).toHaveLength(0);
    expect((await c.prisma.flagAudit.findMany({ where: { emergency: true } })).length).toBeGreaterThan(0);
  });

  it('OP-11 audit trail with CSV export; every change records actor, scope, old→new, reason, ticket', async () => {
    await set(a1, 'kiorex.reviews', { scope: 'GLOBAL', value: 'OFF', reason: 'abuse wave', ticket: 'OPS-42' }).expect(200);
    const rows = (await c.http().get('/api/v1/admin/flags/audit?flagKey=kiorex.reviews').set(a1).expect(200)).body;
    expect(rows[0]).toMatchObject({ actor: 'admin_1', scope: 'GLOBAL', oldValue: 'ON', newValue: 'OFF', reason: 'abuse wave', ticket: 'OPS-42' });
    const csv = await c.http().get('/api/v1/admin/flags/audit?format=csv').set(a1).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text.split('\n')[0]).toContain('flagKey');
    expect(csv.text).toContain('OPS-42');
  });

  it('OP-07 admin list: effective value per scope, source, class, dependencies, last change', async () => {
    await set(a1, 'kiorex.reviews', { scope: 'GLOBAL', value: 'OFF' });
    const list = (await c.http().get('/api/v1/admin/flags?market=EG').set(a1).expect(200)).body;
    const f = list.find((x: any) => x.key === 'kiorex.reviews');
    expect(f).toMatchObject({ product: 'kiorex', class: 'MODULE', dependsOn: ['kiorex.marketplace'], state: 'OFF' });
    expect(f.source).toMatchObject({ scope: 'GLOBAL', reason: 'test', ticket: 'T-1', setBy: 'admin_1' });
    expect(f.lastChange.actor).toBe('admin_1');
    expect(list.length).toBe(FLAG_CATALOGUE.length);
    await c.http().get('/api/v1/admin/flags').set(await c.as('p')).expect(403);
  });

  it('OP-11 propagation status per product + flag.changed push (HMAC webhook) to registered products', async () => {
    const received: any[] = [];
    const srv = createServer((req, res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { received.push({ headers: req.headers, body: b }); res.writeHead(200); res.end('{}'); }); });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as any).port;
    try {
      await c.http().put('/api/v1/admin/flags/products/kiorly-clinic').set(a1).send({ webhookUrl: `http://127.0.0.1:${port}/api/v1/feature-flags/kiorex/changed` }).expect(200);
      await set(a1, 'clinic.ai_scribe', { scope: 'GLOBAL', value: 'OFF' }).expect(200);
      await c.get(OutboxService).processBatch();
      expect(received).toHaveLength(1);
      const h = received[0].headers;
      expect(verifyWebhook({ secret: 'ff_dev_secret_change_me', body: received[0].body, timestamp: h['x-kiorly-timestamp'], signature: h['x-kiorly-signature'] }).ok).toBe(true);
      expect(JSON.parse(received[0].body)).toMatchObject({ type: 'flag.changed', aggregateType: 'Flag', data: { product: 'kiorly-clinic', keys: ['clinic.ai_scribe'], key: 'clinic.ai_scribe' } });
      let p = (await c.http().get('/api/v1/admin/flags/propagation').set(a1).expect(200)).body;
      const clinic = p.products.find((x: any) => x.product === 'kiorly-clinic');
      expect(clinic.status).toBe('NEVER_FETCHED');
      expect(clinic.lastPush.version).toBe(p.currentVersion);
      await snap('kiorly-clinic').expect(200);
      p = (await c.http().get('/api/v1/admin/flags/propagation').set(a1)).body;
      const after = p.products.find((x: any) => x.product === 'kiorly-clinic');
      expect(after).toMatchObject({ status: 'IN_SYNC', versionsBehind: 0, snapshotVersion: p.currentVersion });
      expect(after.ageSeconds).toBeLessThan(5);
      await set(a1, 'clinic.ai_scribe', { scope: 'GLOBAL', value: 'ON' });
      p = (await c.http().get('/api/v1/admin/flags/propagation').set(a1)).body;
      expect(p.products.find((x: any) => x.product === 'kiorly-clinic').versionsBehind).toBe(1);
    } finally { srv.close(); }
  });

  it('failed push is retried by the outbox (kept in lag until delivered)', async () => {
    await c.http().put('/api/v1/admin/flags/products/kiorly-clinic').set(a1).send({ webhookUrl: 'http://127.0.0.1:9/never' }).expect(200);
    await set(a1, 'clinic.ai_scribe', { scope: 'GLOBAL', value: 'OFF' });
    const r = await c.get(OutboxService).processBatch();
    expect(r.failed).toBe(1);
    expect((await c.prisma.outboxEvent.findFirstOrThrow({ where: { type: 'flag.changed' } })).status).toBe('FAILED');
    expect((await c.prisma.productRegistration.findUniqueOrThrow({ where: { product: 'kiorly-clinic' } })).lastPushError).toBeTruthy();
  });

  it('public effective-flags endpoint for web/mobile', async () => {
    await set(a1, 'kiorex.reviews', { scope: 'GLOBAL', value: 'OFF' });
    const r = await c.http().get('/api/v1/flags/effective?market=EG').expect(200);
    expect(r.body.flags['kiorex.reviews']).toMatchObject({ enabled: false, scope: 'GLOBAL' });
    expect(r.body.flags['kiorex.ai_navigation']).toMatchObject({ enabled: false, reason: 'AWAITING_GATE' });
    expect(r.body.flags['kiorex.marketplace'].enabled).toBe(true);
  });
});
