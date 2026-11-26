import { CommissionCollectionService, DEFAULTS_VERSION, installCommissionDefaults, SEEDED_DEFAULT } from '../src/commissions/commissions-public';
import { CommissionPolicyService } from '../src/commissions/commission-policy.service';
import { growthChecksum } from '../src/growth/growth-public';
import { createCtx, TestCtx } from './harness';

/** COM-4: recommended defaults are installed by the versioned seed; counsel sign-off stays NOT_REVIEWED; mock charges with the defaults while real mode stays COUNSEL_BLOCKED. */
describe('commission recommended defaults (SEEDED_DEFAULT)', () => {
  let c: TestCtx; let sa1: any; let sa2: any; let fin: any;
  const P = '/api/v1/admin/commissions/policy';
  const R = '/api/v1/admin/commissions/rates';
  const ORG = 'org_alpha';
  const NOW = new Date('2026-12-07T10:00:00Z');
  const install = () => installCommissionDefaults(c.prisma as never, growthChecksum);
  const real = (on: boolean) => jest.spyOn(c.get(CommissionPolicyService), 'isReal').mockReturnValue(on);
  const wh = async (...a: Parameters<TestCtx['webhook']>) => { const r = await c.webhook(...a); expect([200, 202]).toContain(r.status); };

  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { jest.restoreAllMocks(); await c.close(); });
  beforeEach(async () => {
    jest.restoreAllMocks(); await c.reset();
    sa1 = await c.as('sa1', { roles: ['super_admin', 'ops_admin'] }); sa2 = await c.as('sa2', { roles: ['super_admin', 'ops_admin'] }); fin = await c.as('fin1', { roles: ['finance', 'ops_admin'] });
  });

  it('installs one ACTIVE default per organisation type marked SEEDED_DEFAULT, visible in the Ops view and the audit log; idempotent', async () => {
    const first = await install();
    expect(first.rates).toEqual({ CLINIC: 'INSTALLED', PHARMACY: 'INSTALLED', LAB: 'INSTALLED' });
    const d = (await c.http().get(`${R}/defaults`).set(fin).expect(200)).body;
    expect(d.map((x: any) => x.product)).toEqual(['CLINIC', 'PHARMACY', 'LAB']);
    for (const x of d) {
      expect(x.effective).toMatchObject({ state: 'SET', source: 'DEFAULT', version: 1, provenance: SEEDED_DEFAULT, spec: { feeType: 'PERCENT', currency: 'EGP', mode: 'NET_FROM_PAYOUT' } });
      expect(x.effective.spec.percentBps).toBeGreaterThan(0); expect(x.effective.spec.minMinor).toBeLessThanOrEqual(x.effective.spec.maxMinor);
      expect(x.history[0]).toMatchObject({ provenance: SEEDED_DEFAULT, seedVersion: DEFAULTS_VERSION, status: 'ACTIVE' });
    }
    expect(await c.prisma.auditLog.count({ where: { action: 'commission.defaults_installed' } })).toBe(5); // 3 rates + market settings + disclosure draft
    const again = await install();
    expect(again.rates).toEqual({ CLINIC: 'KEPT_CURRENT', PHARMACY: 'KEPT_CURRENT', LAB: 'KEPT_CURRENT' });
    expect(await c.prisma.commissionRatePolicy.count()).toBe(3);
    expect(await c.prisma.commissionPolicy.count()).toBe(1);
    expect(await c.prisma.growthConfigVersion.count({ where: { kind: 'COMMISSION_DISCLOSURE' } })).toBe(1);
  });

  it('never overwrites or supersedes an operator row: a rate set through maker-checker, a pending proposal and an operator disclosure all survive a re-run', async () => {
    const p = (await c.http().post(`${R}/defaults`).set(sa1).send({ product: 'CLINIC', spec: { feeType: 'PERCENT', percentBps: 1000 } }).expect(200)).body;
    await c.http().post(`${R}/${p.id}/decide`).set(sa2).send({ approve: true }).expect(200);
    await c.http().post(`${R}/defaults`).set(sa1).send({ product: 'LAB', spec: { feeType: 'FLAT', flatMinor: 4000 } }).expect(200); // still pending
    const r = await install();
    expect(r.rates).toEqual({ CLINIC: 'KEPT_OPERATOR_ROW', PHARMACY: 'INSTALLED', LAB: 'KEPT_OPERATOR_ROW' });
    expect(await c.prisma.commissionRatePolicy.count({ where: { scopeRef: 'CLINIC' } })).toBe(1);
    expect(await c.prisma.commissionRatePolicy.count({ where: { scopeRef: 'LAB' } })).toBe(1);
    const clinic = (await c.http().get(`${R}/defaults`).set(sa1).expect(200)).body.find((x: any) => x.product === 'CLINIC');
    expect(clinic.effective).toMatchObject({ provenance: null, spec: { percentBps: 1000 } });
    // an operator who later changes a seeded default makes a normal version 2 and the seed never touches it
    const q = (await c.http().post(`${R}/defaults`).set(sa1).send({ product: 'PHARMACY', spec: { feeType: 'PERCENT', percentBps: 150 } }).expect(200)).body;
    await c.http().post(`${R}/${q.id}/decide`).set(sa2).send({ approve: true }).expect(200);
    await install();
    const ph = (await c.http().get(`${R}/defaults`).set(sa1).expect(200)).body.find((x: any) => x.product === 'PHARMACY');
    expect(ph.effective).toMatchObject({ version: 2, provenance: null, spec: { percentBps: 150 } });
    expect(ph.history.map((h: any) => [h.version, h.provenance])).toEqual([[2, null], [1, SEEDED_DEFAULT]]);
    // a disclosure an operator already proposed is kept
    await c.prisma.growthConfigVersion.deleteMany({ where: { kind: 'COMMISSION_DISCLOSURE' } });
    await c.http().post(`${P}/EG/propose`).set(sa1).send({ kind: 'COMMISSION_DISCLOSURE', payload: { rateDisclosure: { en: 'x', ar: 'y' } }, reason: 'operator wording' }).expect(200);
    expect((await install()).disclosure).toBe('KEPT_OPERATOR_ROW');
    expect(await c.prisma.growthConfigVersion.count({ where: { kind: 'COMMISSION_DISCLOSURE' } })).toBe(1);
  });

  it('the AR and EN disclosure are installed as DRAFTs pending counsel review: nothing reaches an organisation; override reason hidden; neutral wording', async () => {
    await install();
    const row = await c.prisma.growthConfigVersion.findFirstOrThrow({ where: { kind: 'COMMISSION_DISCLOSURE', scope: 'MARKET', scopeId: 'EG' } });
    expect(row).toMatchObject({ status: 'DRAFT', ticket: SEEDED_DEFAULT, createdBy: 'system:seeded-default', approvedBy: null });
    const p: any = row.payload;
    expect(p.showOverrideReason).toBe(false);
    for (const t of [p.rateDisclosure.en, p.termsSummary.en]) expect(t).toContain('Draft pending counsel review.');
    for (const t of [p.rateDisclosure.ar, p.termsSummary.ar]) expect(t).toContain('بانتظار مراجعة المستشار القانوني');
    expect(JSON.stringify(p).toLowerCase()).not.toMatch(/\btax\b|vat|guarantee|legally/);
    const s = (await c.http().get(`${P}/EG`).set(fin).expect(200)).body;
    expect(s.disclosure).toMatchObject({ source: 'DEFAULT', wordingSet: false, version: null });
    expect(s.disclosure.pending).toMatchObject({ status: 'DRAFT', provenance: SEEDED_DEFAULT });
    const view = await c.get(CommissionPolicyService).providerFacing('EG');
    expect(view.disclosure.wordingSet).toBe(false);
  });

  it('counsel sign-off stays NOT_REVIEWED after the seed: no record, every real-money gate blocked; mock charges with the defaults while real mode is COUNSEL_BLOCKED', async () => {
    await install();
    const s = (await c.http().get(`${P}/EG`).set(fin).expect(200)).body;
    expect(s.counsel).toMatchObject({ source: 'DEFAULT', version: null, record: { status: 'NOT_REVIEWED', collectionModes: [], payoutRoutes: [] } });
    expect(s.gates).toHaveLength(8); expect(s.realBlocked).toBe(8);
    expect(s.gates.every((g: any) => g.allowed === false && g.reason === 'COUNSEL_NOT_REVIEWED')).toBe(true);
    expect(await c.prisma.growthConfigVersion.count({ where: { kind: 'COMMISSION_COUNSEL_SIGNOFF' } })).toBe(0);

    await wh('COMMISSION_CHARGE_CREATED', { chargeId: 'chg_d1', appointmentId: 'apt_d1', amount: '100.00', currency: 'EGP', status: 'PENDING', tenantId: ORG, clinicId: `${ORG}_clinic`, decisionAmount: '100.00', disputeDeadline: '2026-11-20T00:00:00Z', feeBasisMinor: 100000 }, { aggregateId: 'apt_d1', eventId: 'e_d1_a' });
    await wh('COMMISSION_CHARGE_STATUS_CHANGED', { chargeId: 'chg_d1', appointmentId: 'apt_d1', amount: '100.00', currency: 'EGP', status: 'CONFIRMED', tenantId: ORG, confirmedAt: '2026-11-10T00:00:00Z', disputeDeadline: '2026-11-20T00:00:00Z' }, { aggregateId: 'apt_d1', eventId: 'e_d1_b' });
    const claim = await c.prisma.commissionClaim.findUniqueOrThrow({ where: { chargeId: 'chg_d1' } });
    expect(claim).toMatchObject({ rateSource: 'DEFAULT' }); expect((claim.rateSnapshot as any).expectedMinor).toBe(3000); // 3 % of 1000.00 = 30.00, inside the 10.00 .. 75.00 band

    real(true);
    const blocked = await c.get(CommissionCollectionService).runForOrg(ORG, NOW);
    expect(blocked).toMatchObject({ status: 'COUNSEL_BLOCKED' }); expect(blocked.detail).toContain('COUNSEL_NOT_REVIEWED');
    expect(await c.prisma.commissionRun.count()).toBe(0);
    expect(await c.prisma.commissionClaim.count({ where: { collectionStatus: 'UNCOLLECTED' } })).toBe(1);

    real(false); // mock mode: the defaults (market cycle, rate grace / minimum / mode) are enough for the run to start with no operator entry
    const run = await c.get(CommissionCollectionService).runForOrg(ORG, NOW);
    expect(run.status).not.toBe('COUNSEL_BLOCKED'); expect(run.status).not.toBe('NOT_CONFIGURED');
    const stored = await c.prisma.commissionRun.findFirstOrThrow({ where: { orgRef: ORG } });
    expect(stored).toMatchObject({ mode: 'NET_FROM_PAYOUT', currency: 'EGP' });
    expect((await c.prisma.commissionPolicy.findFirstOrThrow({ where: { scope: 'MARKET', scopeRef: 'EG' } })).provenance).toBe(SEEDED_DEFAULT);
  });

  it('the database keeps the provenance of a pending row and the history append-only', async () => {
    await install();
    await expect(c.prisma.$executeRawUnsafe(`UPDATE "CommissionRatePolicy" SET "provenance"=NULL WHERE "scopeRef"='CLINIC'`)).rejects.toThrow();
    await expect(c.prisma.$executeRawUnsafe(`DELETE FROM "CommissionRatePolicy" WHERE "scopeRef"='CLINIC'`)).rejects.toThrow();
  });
});
