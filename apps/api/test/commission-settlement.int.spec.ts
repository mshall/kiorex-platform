import { CommissionCollectionService, CommissionQueryService } from '../src/commissions/commissions-public';
import { CommissionRateService } from '../src/commissions/commission-rate.service';
import { createCtx, TestCtx } from './harness';

/**
 * COM-3 founder direction (26 Nov 2026, business policy, not a legal clearance): two-way visibility of commissions, and cash-visit commission accrued then netted in the next bank-transfer settlement.
 * All amounts are TEST placeholders.
 */
describe('commission settlement statement, cash visits, two-way parity', () => {
  let c: TestCtx; let sa1: any; let sa2: any; let fin: any; let ops: any;
  const ORG = 'org_alpha'; const A = '/api/v1/admin/commissions';
  const NOW = new Date('2026-12-07T10:00:00Z');
  const S = { mode: 'NET_FROM_PAYOUT', cycle: 'MONTHLY', cutoffDay: 5, graceDays: 1, retryDays: [2, 4], minCollectMinor: 0, invoiceDueDays: 10 };
  const wh = async (...a: Parameters<TestCtx['webhook']>) => { const r = await c.webhook(...a); expect([200, 202]).toContain(r.status); };
  let n = 0;
  const charge = async (amount: string, tender?: string, dispute?: string) => {
    const i = ++n;
    await wh('COMMISSION_CHARGE_CREATED', { chargeId: `chg_s${i}`, appointmentId: `apt_s${i}`, amount, currency: 'EGP', status: 'PENDING', tenantId: ORG, clinicId: ORG, decisionAmount: amount, disputeDeadline: '2026-11-20T00:00:00Z', feeBasisMinor: 100000, ...(tender ? { tender } : {}) }, { aggregateId: `apt_s${i}`, eventId: `e_s_${i}_a` });
    await wh('COMMISSION_CHARGE_STATUS_CHANGED', { chargeId: `chg_s${i}`, appointmentId: `apt_s${i}`, amount, currency: 'EGP', status: 'CONFIRMED', tenantId: ORG, confirmedAt: '2026-11-10T00:00:00Z', disputeDeadline: '2026-11-20T00:00:00Z', ...(dispute ? { disputeStatus: dispute } : {}) }, { aggregateId: `apt_s${i}`, eventId: `e_s_${i}_b` });
    return `chg_s${i}`;
  };
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => {
    await c.reset(); n = 0;
    sa1 = await c.as('sa1', { roles: ['super_admin', 'ops_admin'] }); sa2 = await c.as('sa2', { roles: ['super_admin', 'ops_admin'] });
    fin = await c.as('fin1', { roles: ['finance', 'ops_admin'] }); ops = await c.as('ops1', { roles: ['ops_admin'] });
    const p = (await c.http().post(`${A}/config`).set(sa1).send({ scope: 'MARKET', scopeRef: 'EG', settings: S }).expect(200)).body;
    await c.http().post(`${A}/config/${p.id}/decide`).set(sa2).send({ approve: true }).expect(200);
  });
  const range = { from: '2026-11-01T00:00:00Z', to: '2027-01-01T00:00:00Z' };

  it('a cash-visit commission is accrued, shown with its tender, and netted in the next bank-transfer payout; Kiorex never pays cash', async () => {
    await charge('40.00', 'CASH'); await charge('60.00', 'ONLINE');
    const before = (await c.http().get(`${A}/settlement-statement/${ORG}`).query(range).set(fin).expect(200)).body;
    expect(before).toMatchObject({ payoutMethod: 'BANK_TRANSFER', cashVisitCommissionAccruedMinor: 4000, cashVisitCommissionNettedMinor: 0, cashVisitCommissionOpenMinor: 4000, cashVisitCharges: 1, commission: { totalMinor: 10000, openMinor: 10000 }, reconciliation: 'NO_PAYOUT' });
    expect(before.deductions.feesMinor).toBeNull();
    await c.get(CommissionCollectionService).runForOrg(ORG, NOW); // NET_FROM_PAYOUT: awaits the provider's next payout
    const run = await c.prisma.commissionRun.findFirstOrThrow();
    expect(run).toMatchObject({ mode: 'NET_FROM_PAYOUT', claimsMinor: 10000 });
    // the next bank-transfer settlement: gross 300.00, commission 100.00 kept, 200.00 transferred
    await c.prisma.$transaction(async (tx) => {
      await tx.payout.create({ data: { id: 'po_s1', payoutRef: 'po_s1_ref', clinicId: ORG, amountMinor: 20000, commissionDeductedMinor: 10000, currency: 'EGP', periodKey: '2026-W50', paymentRefs: [] } });
      await tx.commissionAttempt.create({ data: { id: 'cat_s1', runId: run.id, orgRef: ORG, attemptNo: 1, kind: 'DEDUCT', provider: null, amountMinor: 10000, status: 'SUCCEEDED', retryable: false, scheduledFor: NOW, idempotencyKey: 'ded:s1', payoutRef: 'po_s1_ref' } });
      await tx.commissionClaim.updateMany({ where: { orgRef: ORG }, data: { collectedMinor: 0 } });
    });
    await c.prisma.pspSettlementLine.create({ data: { psp: 'paymob', pspRef: 'bank_ref_1', kind: 'PAYOUT', amountMinor: 20000, date: new Date('2026-12-08'), matched: true, payoutRef: 'po_s1_ref' } });
    const s = (await c.http().get(`${A}/settlement-statement/${ORG}`).query({ from: '2026-11-01T00:00:00Z', to: '2099-01-01T00:00:00Z' }).set(sa1).expect(200)).body;
    expect(s).toMatchObject({ onlineCollectionsMinor: 30000, deductions: { commissionMinor: 10000, refundsMinor: 0, chargebacksMinor: 0 }, netPayableMinor: 20000, paidByBankTransferMinor: 20000, reconciliation: 'MATCHED' });
    expect(s.payouts[0]).toMatchObject({ payoutRef: 'po_s1_ref', bankReference: 'po_s1_ref', reconciliation: 'MATCHED' });
  });

  it('an unmatched payout and an open dispute are visible as UNMATCHED and DISPUTED', async () => {
    await charge('40.00', 'CASH');
    await c.prisma.payout.create({ data: { id: 'po_s2', payoutRef: 'po_s2_ref', clinicId: ORG, amountMinor: 1000, commissionDeductedMinor: 0, currency: 'EGP', periodKey: '2026-W51', paymentRefs: [] } });
    const q = { from: '2026-11-01T00:00:00Z', to: '2099-01-01T00:00:00Z' };
    expect((await c.http().get(`${A}/settlement-statement/${ORG}`).query(q).set(fin).expect(200)).body.reconciliation).toBe('UNMATCHED');
    await c.prisma.commissionClaim.updateMany({ where: { orgRef: ORG }, data: { disputeStatus: 'OPEN' } });
    expect((await c.http().get(`${A}/settlement-statement/${ORG}`).query(q).set(fin).expect(200)).body).toMatchObject({ reconciliation: 'DISPUTED', commission: { disputedOpen: 1 } });
  });

  it('roles and export: super admin and finance read and export (CSV), ops_admin does not; a bad period is refused', async () => {
    await charge('40.00', 'CASH');
    await c.http().get(`${A}/settlement-statement/${ORG}`).set(ops).expect(403);
    await c.http().get(`${A}/settlement-statement/${ORG}`).query({ from: '2027-01-01', to: '2026-01-01' }).set(fin).expect(400);
    const r = await c.http().get(`${A}/settlement-statement/${ORG}/export`).query(range).set(fin).expect(200);
    expect(r.text).toContain('cashVisitCommissionAccrued,40.00'); expect(r.text).toContain('reconciliation');
    await c.http().get(`${A}/settlement-statement/${ORG}/export`).set(ops).expect(403);
  });

  it('two-way parity: what Kiorex pushes to the provider for a run, a claim and the rate in force equals what the Kiorex console shows', async () => {
    const rs = await c.http().post('/api/v1/admin/commissions/rates/defaults').set(sa1).send({ product: 'CLINIC', spec: { feeType: 'PERCENT', percentBps: 1000 } }).expect(200);
    await c.http().post(`/api/v1/admin/commissions/rates/${rs.body.id}/decide`).set(sa2).send({ approve: true }).expect(200);
    await charge('40.00', 'CASH', 'APPROVED'); await charge('60.00');
    await c.get(CommissionCollectionService).runForOrg(ORG, NOW);
    const runRow = await c.prisma.commissionRun.findFirstOrThrow();
    const provider = (await c.get(CommissionCollectionService).snapshot(runRow.id))!;
    const ops1 = await c.get(CommissionQueryService).run(runRow.id);
    for (const k of ['runId', 'orgRef', 'periodKey', 'status', 'mode', 'modeRequested', 'fallbackReason', 'provider', 'currency', 'claimsCount', 'claimsMinor', 'collectedMinor', 'deductedMinor', 'invoicedMinor', 'paidMinor'] as const) expect((provider as any)[k]).toEqual((ops1.run as any)[k === 'runId' ? 'id' : k]);
    expect(provider.claims.map((x: any) => x.chargeId).sort()).toEqual(ops1.claims.map((x) => x.chargeId).sort());
    for (const pc of provider.claims as any[]) {
      const oc = ops1.claims.find((x) => x.chargeId === pc.chargeId)!;
      expect(pc).toMatchObject({ amountMinor: oc.amountMinor, collectedMinor: oc.collectedMinor, collectionStatus: oc.collectionStatus, chargeStatus: oc.chargeStatus, disputeStatus: oc.disputeStatus, tender: oc.tender, rateSource: oc.rateSource });
      expect(pc.rateSnapshot).toEqual(oc.rateSnapshot);
    }
    expect(provider.claims.find((x: any) => x.tender === 'CASH')).toMatchObject({ disputeStatus: 'APPROVED' });
    expect((provider as any).timeline.map((t: any) => t.event)).toEqual(ops1.timeline.map((t) => t.event));
    const view = await c.get(CommissionRateService).partnerView(ORG); const ov = await c.get(CommissionRateService).orgView(ORG);
    expect(view.effective).toMatchObject({ source: ov.effective.source, version: ov.effective.version, spec: ov.effective.spec });
  });
});
