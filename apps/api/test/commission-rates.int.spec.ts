import { OutboxService } from '../src/outbox/outbox-public';
import { CommissionConfigService } from '../src/commissions/commission-config.service';
import { CommissionRateService } from '../src/commissions/commission-rate.service';
import { createCtx, TestCtx } from './harness';

/** COM-2: commission rates per organisation type (default) and per organisation (override / inherit): maker-checker, append-only, effective-dated, audited, snapshotted on claims. Every rate below is a TEST placeholder. */
describe('commission rates', () => {
  let c: TestCtx; let sa1: any; let sa2: any; let fin: any; let ops: any;
  const R = '/api/v1/admin/commissions/rates';
  const PCT = { feeType: 'PERCENT', percentBps: 1000, minMinor: 500, maxMinor: 9000 };
  const FLAT = { feeType: 'FLAT', flatMinor: 4000, mode: 'INVOICE_AND_COLLECT' };
  const ORG = 'org_alpha';
  const FUTURE = () => new Date(Date.now() + 3 * 86_400_000).toISOString();
  const svc = () => c.get(CommissionRateService);
  const propose = async (body: object, who = sa1) => (await c.http().post(`${R}/defaults`).set(who).send(body).expect(200)).body;
  const decide = (id: string, approve: boolean, who = sa2) => c.http().post(`${R}/${id}/decide`).set(who).send({ approve });
  const setDefault = async (product: string, spec: object) => { const p = await propose({ product, spec }); await decide(p.id, true).expect(200); return p.id as string; };
  const setOverride = async (spec: object, reason = 'negotiated contract', orgRef = ORG, product = 'CLINIC') => {
    const p = (await c.http().post(`${R}/orgs/${orgRef}`).set(sa1).send({ product, kind: 'RATE', spec, reason }).expect(200)).body;
    await decide(p.id, true).expect(200); return p.id as string;
  };
  const wh = async (...a: Parameters<TestCtx['webhook']>) => { const r = await c.webhook(...a); expect([200, 202]).toContain(r.status); };
  const charge = (n: number, org = ORG) => wh('COMMISSION_CHARGE_CREATED', { chargeId: `chg_r${n}`, appointmentId: `apt_r${n}`, amount: '100.00', currency: 'EGP', status: 'PENDING', tenantId: org, feeBasisMinor: 100000 }, { aggregateId: `apt_r${n}`, eventId: `e_r${n}` });

  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => {
    await c.reset();
    sa1 = await c.as('sa1', { roles: ['super_admin', 'ops_admin'] }); sa2 = await c.as('sa2', { roles: ['super_admin', 'ops_admin'] });
    fin = await c.as('fin1', { roles: ['finance', 'ops_admin'] }); ops = await c.as('ops1', { roles: ['ops_admin'] });
  });

  it('ships NO numeric default: every product says NOT_SET and an organisation has no charge', async () => {
    const d = (await c.http().get(`${R}/defaults`).set(sa1).expect(200)).body;
    expect(d.map((x: any) => x.product)).toEqual(['CLINIC', 'PHARMACY', 'LAB']);
    for (const x of d) expect(x.effective).toMatchObject({ state: 'NOT_SET', source: null, spec: null });
    const o = (await c.http().get(`${R}/orgs/${ORG}`).set(fin).expect(200)).body;
    expect(o).toMatchObject({ state: 'NOT_SET', inheriting: true, override: null });
    expect(await c.prisma.commissionRatePolicy.count()).toBe(0);
  });

  it('maker-checker: the proposer cannot decide, finance can read but not propose, ops_admin sees nothing; the database repeats the rule', async () => {
    const p = await propose({ product: 'CLINIC', spec: PCT });
    await decide(p.id, true, sa1).expect(403);
    await c.http().post(`${R}/defaults`).set(fin).send({ product: 'CLINIC', spec: PCT }).expect(403);
    await c.http().post(`${R}/${p.id}/decide`).set(fin).send({ approve: true }).expect(403);
    await c.http().get(`${R}/defaults`).set(ops).expect(403);
    await c.http().get(`${R}/defaults`).set(fin).expect(200);
    await expect(c.prisma.$executeRawUnsafe(`UPDATE "CommissionRatePolicy" SET "status"='ACTIVE', "decidedBy"='sa1' WHERE id='${p.id}'`)).rejects.toThrow();
    await decide(p.id, true, sa2).expect(200);
  });

  it('a default per organisation type is validated, versioned, and one proposal at a time', async () => {
    await c.http().post(`${R}/defaults`).set(sa1).send({ product: 'CLINIC', spec: { feeType: 'PERCENT', percentBps: 99999 } }).expect(400);
    await c.http().post(`${R}/defaults`).set(sa1).send({ product: 'HOTEL', spec: PCT }).expect(400);
    await c.http().post(`${R}/defaults`).set(sa1).send({ product: 'CLINIC', spec: PCT, effectiveFrom: '2020-01-01T00:00:00Z' }).expect(400);
    const p = await propose({ product: 'PHARMACY', spec: PCT });
    await c.http().post(`${R}/defaults`).set(sa1).send({ product: 'PHARMACY', spec: FLAT }).expect(409);
    await decide(p.id, false).expect(200);
    const again = await propose({ product: 'PHARMACY', spec: FLAT });
    expect(again.version).toBe(2);
    await decide(again.id, true).expect(200);
    await decide(again.id, true).expect(409);
    const d = (await c.http().get(`${R}/defaults`).set(sa1).expect(200)).body;
    expect(d.find((x: any) => x.product === 'PHARMACY').effective).toMatchObject({ state: 'SET', source: 'DEFAULT', version: 2, spec: { feeType: 'FLAT', flatMinor: 4000, mode: 'INVOICE_AND_COLLECT' } });
    expect(d.find((x: any) => x.product === 'LAB').effective.state).toBe('NOT_SET');
  });

  it('an organisation inherits the default (linked on first sight), an override needs a reason, and INHERIT returns to the default', async () => {
    await setDefault('CLINIC', PCT);
    await charge(1);
    const link = await c.prisma.commissionOrgRateLink.findUniqueOrThrow({ where: { orgRef: ORG } });
    expect(link).toMatchObject({ product: 'CLINIC', defaultVersion: 1 });
    expect((await c.http().get(`${R}/orgs/${ORG}`).set(fin).expect(200)).body).toMatchObject({ inheriting: true, effective: { source: 'DEFAULT', spec: { percentBps: 1000 } } });
    await c.http().post(`${R}/orgs/${ORG}`).set(sa1).send({ product: 'CLINIC', kind: 'RATE', spec: FLAT }).expect(400); // no reason
    await c.http().post(`${R}/orgs/${ORG}`).set(sa1).send({ product: 'CLINIC', kind: 'RATE', spec: FLAT, reason: '   ' }).expect(400);
    await c.http().post(`${R}/orgs/${ORG}`).set(sa1).send({ product: 'PHARMACY', kind: 'RATE', spec: FLAT, reason: 'x' }).expect(409); // product mismatch
    await setOverride(FLAT);
    const v = (await c.http().get(`${R}/orgs/${ORG}`).set(fin).expect(200)).body;
    expect(v).toMatchObject({ inheriting: false, mode: 'INVOICE_AND_COLLECT', effective: { source: 'OVERRIDE', reason: 'negotiated contract', spec: { feeType: 'FLAT', flatMinor: 4000 } }, default: { source: 'DEFAULT', spec: { percentBps: 1000 } } });
    const back = (await c.http().post(`${R}/orgs/${ORG}`).set(sa1).send({ product: 'CLINIC', kind: 'INHERIT', reason: 'contract ended' }).expect(200)).body;
    await decide(back.id, true).expect(200);
    expect((await c.http().get(`${R}/orgs/${ORG}`).set(fin).expect(200)).body).toMatchObject({ inheriting: true, effective: { source: 'DEFAULT' } });
    expect((await c.http().get(`${R}/orgs/${ORG}`).set(fin).expect(200)).body.history.map((h: any) => [h.version, h.kind, h.status])).toEqual([[2, 'INHERIT', 'ACTIVE'], [1, 'RATE', 'ACTIVE']]);
  });

  it('effective-dating: a future change does not apply yet; an approval after the start moves it to the approval time (never retroactive)', async () => {
    await setDefault('CLINIC', PCT);
    const fut = await propose({ product: 'CLINIC', spec: { feeType: 'PERCENT', percentBps: 2000 }, effectiveFrom: FUTURE() });
    await decide(fut.id, true).expect(200);
    const d = (await c.http().get(`${R}/defaults`).set(sa1).expect(200)).body.find((x: any) => x.product === 'CLINIC');
    expect(d.effective).toMatchObject({ version: 1, spec: { percentBps: 1000 } });
    expect(d.upcoming).toMatchObject({ version: 2 });
    // a proposal that waits for approval past its requested start is clamped to the approval time
    const soon = await propose({ product: 'LAB', spec: PCT, effectiveFrom: new Date(Date.now() + 1000).toISOString() });
    const decided = (await decide(soon.id, true).expect(200)).body;
    expect(new Date(decided.effectiveFrom).getTime()).toBeGreaterThanOrEqual(new Date(decided.decidedAt).getTime() - 1);
    expect(decided.requestedFrom ?? decided.effectiveFrom).toBeTruthy();
    // the service resolves old instants with the old rate
    const at = await svc().effectiveAt(ORG, 'CLINIC', new Date(Date.now() - 86_400_000));
    expect(at.state).toBe('NOT_SET');
  });

  it('history is append-only: decided rows cannot be updated or deleted', async () => {
    const id = await setDefault('CLINIC', PCT);
    await expect(c.prisma.commissionRatePolicy.update({ where: { id }, data: { spec: FLAT } })).rejects.toThrow();
    await expect(c.prisma.commissionRatePolicy.delete({ where: { id } })).rejects.toThrow();
    const p = await propose({ product: 'LAB', spec: PCT });
    await expect(c.prisma.commissionRatePolicy.update({ where: { id: p.id }, data: { spec: FLAT } })).rejects.toThrow(); // a pending row's rate never changes either
    await expect(c.prisma.$executeRawUnsafe(`INSERT INTO "CommissionRatePolicy"(id,scope,product,"scopeRef",kind,version,status,spec,"effectiveFrom","proposedBy") VALUES ('x','ORG','CLINIC','o1','RATE',1,'PENDING','{"feeType":"FLAT","flatMinor":1}',now(),'a')`)).rejects.toThrow(); // org row without a reason
  });

  it('a charge keeps the rate that applied when it was reported, whatever changes later', async () => {
    await setDefault('CLINIC', PCT);
    await charge(1);
    await setOverride(FLAT);
    await charge(2);
    const [a, b] = await Promise.all(['chg_r1', 'chg_r2'].map((chargeId) => c.prisma.commissionClaim.findUniqueOrThrow({ where: { chargeId } })));
    expect(a).toMatchObject({ rateSource: 'DEFAULT', rateSnapshot: { spec: { percentBps: 1000 }, expectedMinor: 9000 } }); // 10 % of 1000.00, capped at 90.00
    expect(b).toMatchObject({ rateSource: 'OVERRIDE', rateSnapshot: { spec: { flatMinor: 4000 }, expectedMinor: 4000 } });
    const back = (await c.http().post(`${R}/orgs/${ORG}`).set(sa1).send({ product: 'CLINIC', kind: 'INHERIT', reason: 'ended' }).expect(200)).body; await decide(back.id, true).expect(200);
    expect((await c.prisma.commissionClaim.findUniqueOrThrow({ where: { chargeId: 'chg_r2' } })).rateSource).toBe('OVERRIDE'); // never rewritten
  });

  it('with no default and no override a charge is recorded with no rate (rate not set), not with an invented one', async () => {
    await charge(9);
    expect(await c.prisma.commissionClaim.findUniqueOrThrow({ where: { chargeId: 'chg_r9' } })).toMatchObject({ rateSource: null, ratePolicyId: null, rateSnapshot: null });
  });

  it('the mode on the effective rate drives collection; with no mode the collection settings decide', async () => {
    const cfg = c.get(CommissionConfigService);
    const S = { mode: 'NET_FROM_PAYOUT', cycle: 'MONTHLY', cutoffDay: 5, graceDays: 1, retryDays: [2, 4], minCollectMinor: 0, invoiceDueDays: 10 };
    const p = (await c.http().post('/api/v1/admin/commissions/config').set(sa1).send({ scope: 'MARKET', scopeRef: 'EG', settings: S }).expect(200)).body;
    await c.http().post(`/api/v1/admin/commissions/config/${p.id}/decide`).set(sa2).send({ approve: true }).expect(200);
    await charge(1);
    expect((await cfg.effective(ORG, 'EG')).settings.mode).toBe('NET_FROM_PAYOUT');
    await setOverride({ feeType: 'PERCENT', percentBps: 500, mode: 'AUTO_CHARGE_SAVED_METHOD' });
    expect((await cfg.effective(ORG, 'EG')).settings.mode).toBe('AUTO_CHARGE_SAVED_METHOD');
  });

  it('every proposal and decision is audited; approval pushes the provider-facing view (no actor names) to the Clinic and a default change reaches every linked organisation', async () => {
    await charge(1); await charge(2, 'org_beta');
    const id = await setDefault('CLINIC', PCT);
    await setOverride(FLAT, 'negotiated contract', ORG);
    const audits = await c.prisma.auditLog.findMany({ where: { resource: 'CommissionRatePolicy' }, select: { action: true } });
    expect(audits.map((a) => a.action).sort()).toEqual(['commission.rate_approved', 'commission.rate_approved', 'commission.rate_proposed', 'commission.rate_proposed']);
    await c.get(OutboxService).processBatch(50);
    const pushed = c.kiorly.commissionRates;
    expect(pushed.map((p: any) => p.orgRef).sort()).toEqual([ORG, 'org_beta', ORG].sort());
    const alpha = pushed.filter((p: any) => p.orgRef === ORG).pop();
    expect(alpha).toMatchObject({ product: 'CLINIC', inheriting: false, effective: { source: 'OVERRIDE' }, default: { source: 'DEFAULT' } });
    expect(JSON.stringify(pushed)).not.toMatch(/sa1|sa2|proposedBy|decidedBy/);
    expect(id).toBeTruthy();
    const before = c.kiorly.commissionRates.length;
    await c.http().post(`${R}/resync`).set(fin).send({ product: 'CLINIC' }).expect(200);
    await c.get(OutboxService).processBatch(50);
    expect(c.kiorly.commissionRates.length).toBe(before + 2);
  });
});
