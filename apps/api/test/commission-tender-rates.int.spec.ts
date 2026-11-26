import { CommissionQueryService } from '../src/commissions/commissions-public';
import { createCtx, TestCtx } from './harness';

/** LG-COM-20 addendum: commission treatment per tender kind (ONLINE, CASH, CASH_TRANSFER) inside the rate policy. Every number is a TEST placeholder, never a shipped rate. */
describe('commission rate treatment per tender kind', () => {
  let c: TestCtx; let sa1: any; let sa2: any;
  const R = '/api/v1/admin/commissions/rates'; const ORG = 'org_tender';
  const BASE = { feeType: 'PERCENT', percentBps: 1000, minMinor: 500, maxMinor: 9000 };
  const propose = async (body: object) => (await c.http().post(`${R}/defaults`).set(sa1).send(body).expect(200)).body;
  const decide = (id: string, approve = true) => c.http().post(`${R}/${id}/decide`).set(sa2).send({ approve });
  const setDefault = async (spec: object) => { const p = await propose({ product: 'CLINIC', spec }); await decide(p.id).expect(200); return p.id as string; };
  const setOverride = async (spec: object) => { const p = (await c.http().post(`${R}/orgs/${ORG}`).set(sa1).send({ product: 'CLINIC', kind: 'RATE', spec, reason: 'negotiated contract' }).expect(200)).body; await decide(p.id).expect(200); return p.id as string; };
  const wh = async (...a: Parameters<TestCtx['webhook']>) => { const r = await c.webhook(...a); expect([200, 202]).toContain(r.status); };
  let n = 0;
  const charge = async (amount: string, extra: Record<string, unknown> = {}) => {
    const i = ++n;
    await wh('COMMISSION_CHARGE_CREATED', { chargeId: `chg_t${i}`, appointmentId: `apt_t${i}`, amount, currency: 'EGP', status: 'PENDING', tenantId: ORG, clinicId: ORG, feeBasisMinor: 100000, ...extra }, { aggregateId: `apt_t${i}`, eventId: `e_t_${i}` });
    return c.prisma.commissionClaim.findUniqueOrThrow({ where: { chargeId: `chg_t${i}` } });
  };
  const snap = (x: { rateSnapshot: unknown }) => x.rateSnapshot as { tenderKind: string | null; treatment: string; expectedMinor: number | null; policyId: string; spec: Record<string, unknown> };
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => {
    await c.reset(); n = 0;
    sa1 = await c.as('sa1', { roles: ['super_admin', 'ops_admin'] }); sa2 = await c.as('sa2', { roles: ['super_admin', 'ops_admin'] });
  });

  it('validation: only known kinds and fields, a rate needs its feeType, a floor may not exceed a cap; maker-checker still applies', async () => {
    const bad = async (tenders: object) => (await c.http().post(`${R}/defaults`).set(sa1).send({ product: 'CLINIC', spec: { ...BASE, tenders } }).expect(400)).body;
    expect(JSON.stringify(await bad({ BARTER: { percentBps: 1 } }))).toContain('unknown tender kind');
    expect(JSON.stringify(await bad({ CASH: { percentBps: 100 } }))).toContain('needs its feeType');
    expect(JSON.stringify(await bad({ CASH_TRANSFER: { feeType: 'PERCENT', percentBps: 100, minMinor: 900, maxMinor: 100 } }))).toContain('must not exceed');
    const p = await propose({ product: 'CLINIC', spec: { ...BASE, tenders: { CASH_TRANSFER: { feeType: 'PERCENT', percentBps: 500 } } } });
    await c.http().post(`${R}/${p.id}/decide`).set(sa1).send({ approve: true }).expect(403); // the maker cannot decide
    await decide(p.id).expect(200);
  });

  it('a per-tender rate prices the claim of that kind; an unset kind inherits the base rate (floor and cap too)', async () => {
    await setDefault({ ...BASE, tenders: { CASH_TRANSFER: { feeType: 'PERCENT', percentBps: 500, minMinor: null }, ONLINE: { maxMinor: 2000 } } });
    const transfer = await charge('50.00', { tender: 'CASH', tenderMethod: 'CASH_TRANSFER', tenderDetail: 'INSTAPAY' });
    expect(snap(transfer)).toMatchObject({ tenderKind: 'CASH_TRANSFER', treatment: 'TENDER', expectedMinor: 5000 }); // 5 % of 1000.00, the base floor 5.00 is lifted
    expect(snap(transfer).spec).toMatchObject({ feeType: 'PERCENT', percentBps: 500, minMinor: null, maxMinor: 9000 }); // the cap is inherited
    const online = await charge('20.00', { tender: 'ONLINE' });
    expect(snap(online)).toMatchObject({ tenderKind: 'ONLINE', treatment: 'TENDER', expectedMinor: 2000 }); // base 10 % = 100.00, capped at 20.00 for ONLINE
    const cash = await charge('90.00', { tender: 'CASH' }); // CASH has no entry: base rate (the same as an older client)
    expect(snap(cash)).toMatchObject({ tenderKind: 'CASH', treatment: 'BASE', expectedMinor: 9000 });
    const unknown = await charge('90.00'); // tender not reported: base, never guessed
    expect(snap(unknown)).toMatchObject({ tenderKind: null, treatment: 'BASE', expectedMinor: 9000 });
    expect(snap(cash).policyId).toBe(snap(transfer).policyId); // the same policy row, the kind says which treatment
  });

  it('the seeded-style default with no tenders keeps CASH_TRANSFER equal to the base rate and to CASH; backward compatible with a spec that never had tenders', async () => {
    await setDefault(BASE);
    const a = await charge('90.00', { tender: 'CASH', tenderMethod: 'CASH_TRANSFER' });
    const b = await charge('90.00', { tender: 'CASH' });
    expect(snap(a).expectedMinor).toBe(snap(b).expectedMinor); expect(snap(a).treatment).toBe('BASE');
    expect(snap(a).spec).not.toHaveProperty('tenders');
    const d = (await c.http().get(`${R}/defaults`).set(sa1).expect(200)).body.find((x: any) => x.product === 'CLINIC');
    expect(d.effective.spec).not.toHaveProperty('tenders');
  });

  it('a per-organisation override beats the organisation-type default, tender entry included; INHERIT returns to the default treatment', async () => {
    await setDefault({ ...BASE, tenders: { CASH_TRANSFER: { feeType: 'FLAT', flatMinor: 3000 } } });
    expect(snap(await charge('30.00', { tender: 'CASH', tenderMethod: 'CASH_TRANSFER' })).expectedMinor).toBe(3000);
    await setOverride({ ...BASE, percentBps: 800, tenders: { CASH_TRANSFER: { feeType: 'FLAT', flatMinor: 1500 } } });
    const own = await charge('15.00', { tender: 'CASH', tenderMethod: 'CASH_TRANSFER' });
    expect(snap(own)).toMatchObject({ expectedMinor: 1500, treatment: 'TENDER' });
    const ownCash = await charge('80.00', { tender: 'CASH' }); // the override's base 8 %, not the default's
    expect(snap(ownCash).expectedMinor).toBe(8000);
    // an override without tenders does not borrow the default's entry: its own base applies to every kind
    const inh = (await c.http().post(`${R}/orgs/${ORG}`).set(sa1).send({ product: 'CLINIC', kind: 'INHERIT', reason: 'back to default' }).expect(200)).body; await decide(inh.id).expect(200);
    const back = await charge('30.00', { tender: 'CASH', tenderMethod: 'CASH_TRANSFER' });
    expect(snap(back)).toMatchObject({ expectedMinor: 3000, treatment: 'TENDER' });
    const view = (await c.http().get(`${R}/orgs/${ORG}`).set(sa1).expect(200)).body;
    expect(view.effective.spec.tenders.CASH_TRANSFER).toMatchObject({ feeType: 'FLAT', flatMinor: 3000 });
  });

  it('reconciliation CLAIM_NE_RATE compares the charge with the treatment of its own tender kind; the CSV names the kind and the treatment', async () => {
    await setDefault({ ...BASE, tenders: { CASH_TRANSFER: { feeType: 'PERCENT', percentBps: 500, minMinor: null } } });
    await charge('50.00', { tender: 'CASH', tenderMethod: 'CASH_TRANSFER' }); // charged as the treatment says: no finding
    await charge('100.00', { tender: 'CASH', tenderMethod: 'CASH_TRANSFER' }); // charged the base 10 % although the treatment is 5 %: a finding
    const rows = await c.prisma.commissionClaim.findMany({ orderBy: { chargeId: 'asc' } });
    const { reconcileClaimRates } = await import('../src/commissions/commission-rate');
    const findings = reconcileClaimRates(rows.map((r) => ({ id: r.id, orgRef: r.orgRef, amountMinor: r.amountMinor, chargeStatus: r.chargeStatus, feeBasisMinor: r.feeBasisMinor, rateSnapshot: r.rateSnapshot })));
    expect(findings).toHaveLength(1); expect(findings[0]).toMatchObject({ code: 'CLAIM_NE_RATE', expectedMinor: 5000, actualMinor: 10000 });
    const fin = await c.as('fin1', { roles: ['finance', 'ops_admin'] });
    const csv = (await c.http().get('/api/v1/admin/commissions/export/claims').set(fin).expect(200)).text;
    expect(csv).toContain('rateTenderKind,rateTreatment'); expect(csv).toContain('CASH,CASH_TRANSFER,,CASH_TRANSFER,TENDER');
    void CommissionQueryService;
  });
});
