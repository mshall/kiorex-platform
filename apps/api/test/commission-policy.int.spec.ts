import { CommissionCollectionService } from '../src/commissions/commissions-public';
import { CommissionConfigService } from '../src/commissions/commission-config.service';
import { CommissionPolicyService } from '../src/commissions/commission-policy.service';
import { CommissionRateService } from '../src/commissions/commission-rate.service';
import { PAYOUT_ROUTE_GATE_PORT, type PayoutRouteGatePort } from '../src/common/payout-route-gate-port';
import { OutboxService } from '../src/outbox/outbox-public';
import { createCtx, TestCtx } from './harness';

/**
 * COM-3: the counsel sign-off per market (gates REAL commission modes and payout routes), the provider-facing disclosure texts (no shipped wording), and the extra numeric rate parameters.
 * Every number and every text below is a TEST placeholder entered through the console API, never a shipped value.
 */
describe('commission policy: counsel gate, disclosure, configurable rate parameters', () => {
  let c: TestCtx; let sa1: any; let sa2: any; let fin: any; let ops: any;
  const P = '/api/v1/admin/commissions/policy';
  const R = '/api/v1/admin/commissions/rates';
  const ORG = 'org_alpha';
  const NOW = new Date('2026-12-07T10:00:00Z');
  const S = { mode: 'INVOICE_AND_COLLECT', cycle: 'MONTHLY', cutoffDay: 5, graceDays: 1, retryDays: [2, 4], minCollectMinor: 0, invoiceDueDays: 10 };
  const counsel = (over: object = {}) => ({ status: 'APPROVED', reviewerName: 'Test Counsel', documentId: 'DOC-TEST-1', reviewedOn: '2026-12-01', conditions: '', collectionModes: ['INVOICE_AND_COLLECT'], payoutRoutes: ['PAYMOB'], ...over });
  const propose = (kind: string, payload: object, who = sa1, market = 'EG') => c.http().post(`${P}/${market}/propose`).set(who).send({ kind, payload, reason: 'test change' });
  const decide = (id: string, approve: boolean, who = sa2) => c.http().post(`${P}/versions/${id}/decide`).set(who).send({ approve });
  const apply = async (kind: string, payload: object, market = 'EG') => { const p = (await propose(kind, payload, sa1, market).expect(200)).body; await decide(p.id, true).expect(200); return p.id as string; };
  const state = async (market = 'EG', who = fin) => (await c.http().get(`${P}/${market}`).set(who).expect(200)).body;
  const real = (on: boolean) => jest.spyOn(c.get(CommissionPolicyService), 'isReal').mockReturnValue(on);
  let seq = 0;
  const wh = async (...a: Parameters<TestCtx['webhook']>) => { const r = await c.webhook(...a); expect([200, 202]).toContain(r.status); };
  const confirmed = async (org: string, amount: string) => {
    const n = ++seq;
    await wh('COMMISSION_CHARGE_CREATED', { chargeId: `chg_p${n}`, appointmentId: `apt_p${n}`, amount, currency: 'EGP', status: 'PENDING', tenantId: org, clinicId: `${org}_clinic`, decisionAmount: amount, disputeDeadline: '2026-11-20T00:00:00Z', feeBasisMinor: 100000 }, { aggregateId: `apt_p${n}`, eventId: `e_p_${n}_a` });
    await wh('COMMISSION_CHARGE_STATUS_CHANGED', { chargeId: `chg_p${n}`, appointmentId: `apt_p${n}`, amount, currency: 'EGP', status: 'CONFIRMED', tenantId: org, confirmedAt: '2026-11-10T00:00:00Z', disputeDeadline: '2026-11-20T00:00:00Z' }, { aggregateId: `apt_p${n}`, eventId: `e_p_${n}_b` });
  };
  const marketSettings = async (settings: object = S) => {
    const p = (await c.http().post('/api/v1/admin/commissions/config').set(sa1).send({ scope: 'MARKET', scopeRef: 'EG', settings }).expect(200)).body;
    await c.http().post(`/api/v1/admin/commissions/config/${p.id}/decide`).set(sa2).send({ approve: true }).expect(200);
  };

  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { jest.restoreAllMocks(); await c.close(); });
  beforeEach(async () => {
    jest.restoreAllMocks();
    await c.reset(); seq = 0;
    sa1 = await c.as('sa1', { roles: ['super_admin', 'ops_admin'] }); sa2 = await c.as('sa2', { roles: ['super_admin', 'ops_admin'] });
    fin = await c.as('fin1', { roles: ['finance', 'ops_admin'] }); ops = await c.as('ops1', { roles: ['ops_admin'] });
  });

  it('ships NO sign-off and NO wording: NOT_REVIEWED, every real-money gate blocked with a reason, texts empty, reason hidden, nothing stored', async () => {
    const s = await state();
    expect(s.counsel).toMatchObject({ source: 'DEFAULT', version: null, record: { status: 'NOT_REVIEWED', reviewerName: '', documentId: '', collectionModes: [], payoutRoutes: [] } });
    expect(s.disclosure).toMatchObject({ source: 'DEFAULT', wordingSet: false, disclosure: { rateDisclosure: { en: '', ar: '' }, termsSummary: { en: '', ar: '' }, showOverrideReason: false } });
    expect(s.gates).toHaveLength(8);
    expect(s.gates.every((g: any) => g.allowed === false && g.reason === 'COUNSEL_NOT_REVIEWED')).toBe(true);
    expect(s.realBlocked).toBe(8);
    expect(await c.prisma.growthConfigVersion.count({ where: { kind: { in: ['COMMISSION_COUNSEL_SIGNOFF', 'COMMISSION_DISCLOSURE'] }, scope: 'MARKET' } })).toBe(0);
  });

  it('permissions: super admin and finance read; ops_admin sees nothing; only a super admin proposes; finance cannot decide', async () => {
    await c.http().get(`${P}/EG`).set(ops).expect(403);
    await c.http().get(P).set(fin).expect(200);
    await propose('COMMISSION_COUNSEL_SIGNOFF', counsel(), fin).expect(403);
    await propose('COMMISSION_COUNSEL_SIGNOFF', counsel(), ops).expect(403);
    const p = (await propose('COMMISSION_COUNSEL_SIGNOFF', counsel()).expect(200)).body;
    await c.http().post(`${P}/versions/${p.id}/decide`).set(fin).send({ approve: true }).expect(403);
  });

  it('maker-checker: the proposer cannot approve or reject their own proposal; a different super admin can; the database repeats the rule', async () => {
    const p = (await propose('COMMISSION_COUNSEL_SIGNOFF', counsel()).expect(200)).body;
    const same = await decide(p.id, true, sa1);
    expect(same.status).toBeGreaterThanOrEqual(400); expect(JSON.stringify(same.body)).toContain('SELF_APPROVAL');
    expect((await decide(p.id, false, sa1)).status).toBeGreaterThanOrEqual(400);
    await expect(c.prisma.$executeRawUnsafe(`UPDATE "GrowthConfigVersion" SET "status"='ACTIVE', "approvedBy"='sa1' WHERE id='${p.id}'`)).rejects.toThrow();
    await decide(p.id, true, sa2).expect(200);
    expect((await state()).counsel).toMatchObject({ source: 'APPROVED', version: 1, record: { status: 'APPROVED', reviewerName: 'Test Counsel', documentId: 'DOC-TEST-1' } });
  });

  it('validation: an approval without reviewer, document or date, a record that approves modes while NOT_REVIEWED, markup and a non-market scope are refused', async () => {
    await propose('COMMISSION_COUNSEL_SIGNOFF', { status: 'APPROVED' }).expect((r) => { if (![400, 422].includes(r.status)) throw new Error(`expected a refusal, got ${r.status}`); });
    await propose('COMMISSION_COUNSEL_SIGNOFF', { status: 'NOT_REVIEWED', collectionModes: ['NET_FROM_PAYOUT'] }).expect((r) => { if (![400, 422].includes(r.status)) throw new Error(`expected a refusal, got ${r.status}`); });
    await propose('COMMISSION_COUNSEL_SIGNOFF', counsel({ status: 'APPROVED_WITH_CONDITIONS' })).expect((r) => { if (![400, 422].includes(r.status)) throw new Error(`expected a refusal, got ${r.status}`); });
    await propose('COMMISSION_COUNSEL_SIGNOFF', counsel({ conditions: '<b>x</b>' })).expect((r) => { if (![400, 422].includes(r.status)) throw new Error(`expected a refusal, got ${r.status}`); });
    await propose('COMMISSION_DISCLOSURE', { rateDisclosure: { en: '<script>x</script>' } }).expect((r) => { if (![400, 422].includes(r.status)) throw new Error(`expected a refusal, got ${r.status}`); });
    await propose('COMMISSION_COUNSEL_SIGNOFF', counsel(), sa1, 'XYZ').expect((r) => { if (![400, 422].includes(r.status)) throw new Error(`expected a refusal, got ${r.status}`); });
    await propose('SOMETHING_ELSE', {}).expect((r) => { if (![400, 422].includes(r.status)) throw new Error(`expected a refusal, got ${r.status}`); });
    await c.http().post(`${P}/EG/propose`).set(sa1).send({ kind: 'COMMISSION_COUNSEL_SIGNOFF', payload: counsel() }).expect((r) => { if (![400, 422].includes(r.status)) throw new Error(`expected a refusal, got ${r.status}`); }); // reason is mandatory
  });

  it('REAL mode is blocked without sign-off: the run is not created, the claims stay uncollected, the reason is recorded once, care is untouched; mock always runs', async () => {
    await marketSettings(); await confirmed(ORG, '100.00');
    real(true);
    const r = await c.get(CommissionCollectionService).runForOrg(ORG, NOW);
    expect(r).toMatchObject({ status: 'COUNSEL_BLOCKED' }); expect(r.detail).toContain('COUNSEL_NOT_REVIEWED');
    expect(await c.prisma.commissionRun.count()).toBe(0);
    expect(await c.prisma.commissionClaim.count({ where: { collectionStatus: 'UNCOLLECTED' } })).toBe(1);
    await c.get(CommissionCollectionService).runForOrg(ORG, NOW);
    expect(await c.prisma.commissionTimeline.count({ where: { orgRef: ORG, event: 'COUNSEL_BLOCKED' } })).toBe(1);
    real(false);
    expect((await c.get(CommissionCollectionService).runForOrg(ORG, NOW)).status).not.toBe('COUNSEL_BLOCKED');
    expect(await c.prisma.commissionRun.count()).toBe(1);
  });

  it('REAL mode: REJECTED blocks, an approval that lists another mode blocks, the listed mode runs; APPROVED_WITH_CONDITIONS runs and shows its conditions', async () => {
    await marketSettings(); await confirmed(ORG, '100.00');
    real(true);
    await apply('COMMISSION_COUNSEL_SIGNOFF', { status: 'REJECTED', reviewerName: 'Test Counsel', documentId: 'DOC-R', reviewedOn: '2026-12-01' });
    expect((await c.get(CommissionCollectionService).runForOrg(ORG, NOW)).detail).toContain('COUNSEL_REJECTED');
    await apply('COMMISSION_COUNSEL_SIGNOFF', counsel({ collectionModes: ['NET_FROM_PAYOUT'] }));
    expect((await c.get(CommissionCollectionService).runForOrg(ORG, NOW)).detail).toContain('NOT_IN_APPROVED_LIST');
    await apply('COMMISSION_COUNSEL_SIGNOFF', counsel({ status: 'APPROVED_WITH_CONDITIONS', conditions: 'conditions text from counsel' }));
    expect((await c.get(CommissionCollectionService).runForOrg(ORG, NOW)).status).not.toBe('COUNSEL_BLOCKED');
    const g = (await state()).gates.find((x: any) => x.kind === 'COLLECTION_MODE' && x.key === 'INVOICE_AND_COLLECT');
    expect(g).toMatchObject({ allowed: true, reason: 'APPROVED_WITH_CONDITIONS', conditions: 'conditions text from counsel' });
    const hist = (await state()).counsel.history;
    expect(hist.map((h: any) => [h.version, h.status])).toEqual([[3, 'ACTIVE'], [2, 'SUPERSEDED'], [1, 'SUPERSEDED']]); // append-only history
  });

  it('a requested saved-method mode that falls back to an invoice is gated on the mode it really starts with', async () => {
    await marketSettings({ ...S, mode: 'AUTO_CHARGE_SAVED_METHOD' }); await confirmed(ORG, '100.00');
    real(true);
    await apply('COMMISSION_COUNSEL_SIGNOFF', counsel({ collectionModes: ['AUTO_CHARGE_SAVED_METHOD'] })); // approves the token charge, not the invoice
    const r = await c.get(CommissionCollectionService).runForOrg(ORG, NOW); // no provider / saved method: starts as INVOICE_AND_COLLECT, which counsel did not approve
    expect(r).toMatchObject({ status: 'COUNSEL_BLOCKED' }); expect(r.detail).toContain('NOT_IN_APPROVED_LIST');
  });

  it('payout / settlement routes: blocked in real mode until counsel approves that route for the market; mock is always allowed; the Pay port uses the same answer', async () => {
    const port = c.get(PAYOUT_ROUTE_GATE_PORT as never) as PayoutRouteGatePort;
    await c.prisma.commissionOrgProvider.create({ data: { orgRef: ORG, market: 'EG', provider: 'paymob', chosenBy: 'sa1' } });
    real(false); expect(await port.blockedReason(ORG, 'paymob')).toBeNull();
    real(true); expect(await port.blockedReason(ORG, 'paymob')).toBe('COUNSEL_NOT_REVIEWED');
    await apply('COMMISSION_COUNSEL_SIGNOFF', counsel());
    expect(await port.blockedReason(ORG, 'paymob')).toBeNull();
    expect(await port.blockedReason(ORG, 'fawry')).toBe('NOT_IN_APPROVED_LIST');
    expect(await port.blockedReason(ORG, 'card-gateway')).toBe('NOT_IN_APPROVED_LIST');
  });

  it('the sign-off is per market: approving EG does not open SA', async () => {
    await apply('COMMISSION_COUNSEL_SIGNOFF', counsel());
    expect((await state('EG')).counsel.record.status).toBe('APPROVED');
    expect((await state('SA')).counsel.record.status).toBe('NOT_REVIEWED');
    real(true);
    expect((await c.get(CommissionPolicyService).gate('SA', 'COLLECTION_MODE', 'INVOICE_AND_COLLECT')).allowed).toBe(false);
    expect((await c.get(CommissionPolicyService).gate('EG', 'COLLECTION_MODE', 'INVOICE_AND_COLLECT')).allowed).toBe(true);
  });

  it('an effective-dated sign-off does not apply before its date', async () => {
    const at = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const p = (await c.http().post(`${P}/EG/propose`).set(sa1).send({ kind: 'COMMISSION_COUNSEL_SIGNOFF', payload: counsel(), reason: 'dated', effectiveFrom: at }).expect(200)).body;
    await decide(p.id, true).expect(200);
    expect((await state()).counsel.record.status).toBe('NOT_REVIEWED');
    expect((await c.get(CommissionPolicyService).counselFor('EG', new Date(Date.now() + 4 * 86_400_000))).record.status).toBe('APPROVED');
  });

  it('disclosure: wording is entered by the super admin; the organisation view carries it read only; the override reason is shown only when the setting says so; the view version moves', async () => {
    const rates = c.get(CommissionRateService);
    const setRate = async (p: object) => { const r = (await c.http().post(`${R}/defaults`).set(sa1).send(p).expect(200)).body; await c.http().post(`${R}/${r.id}/decide`).set(sa2).send({ approve: true }).expect(200); };
    await setRate({ product: 'CLINIC', spec: { feeType: 'PERCENT', percentBps: 1000 } });
    await confirmed(ORG, '100.00');
    const ov = (await c.http().post(`${R}/orgs/${ORG}`).set(sa1).send({ product: 'CLINIC', kind: 'RATE', spec: { feeType: 'FLAT', flatMinor: 4000 }, reason: 'negotiated contract' }).expect(200)).body;
    await c.http().post(`${R}/${ov.id}/decide`).set(sa2).send({ approve: true }).expect(200);
    const v0 = await rates.partnerView(ORG);
    expect(v0.disclosure).toMatchObject({ wordingSet: false, showOverrideReason: false, rateDisclosure: { en: '', ar: '' } });
    expect(v0.counsel).toMatchObject({ status: 'NOT_REVIEWED' });
    expect(v0.override?.reason).toBeNull(); expect(v0.history.every((h: any) => h.reason === null)).toBe(true); // hidden by default
    await new Promise((r) => setTimeout(r, 5));
    await apply('COMMISSION_DISCLOSURE', { rateDisclosure: { en: 'EN text typed by counsel', ar: 'نص كتبه المستشار' }, termsSummary: { en: 'EN terms', ar: '' }, showOverrideReason: true });
    const v1 = await rates.partnerView(ORG);
    expect(v1.disclosure).toMatchObject({ wordingSet: true, showOverrideReason: true, rateDisclosure: { en: 'EN text typed by counsel', ar: 'نص كتبه المستشار' }, termsSummary: { en: 'EN terms', ar: '' } });
    expect(v1.override?.reason).toBe('negotiated contract'); expect(v1.history.some((h: any) => h.reason === 'negotiated contract')).toBe(true);
    expect(Number(v1.version)).toBeGreaterThan(Number(v0.version));
    const s = await state(); expect(s.disclosure.missing).toEqual({ rateDisclosure: [], termsSummary: ['ar'] });
    expect(JSON.stringify(v1)).not.toMatch(/proposedBy|decidedBy|sa1|sa2/); // no actor identity ever travels
  });

  it('approving a disclosure change pushes every linked organisation its new read-only view over the partner channel', async () => {
    await confirmed(ORG, '100.00');
    const before = c.kiorly.commissionRates.length;
    await apply('COMMISSION_DISCLOSURE', { rateDisclosure: { en: 'text', ar: '' } });
    await c.get(OutboxService).processBatch(50);
    const pushed = c.kiorly.commissionRates.slice(before);
    expect(pushed.length).toBeGreaterThan(0);
    expect(pushed[pushed.length - 1]).toMatchObject({ orgRef: ORG, disclosure: { wordingSet: true, rateDisclosure: { en: 'text' } }, counsel: { status: 'NOT_REVIEWED' } });
  });

  it('every numeric parameter of the rate is configurable per organisation type and per organisation, and wins over the collection settings field by field', async () => {
    const full = { feeType: 'PERCENT', percentBps: 500, minMinor: 100, maxMinor: 5000, mode: 'INVOICE_AND_COLLECT', currency: 'EGP', rounding: 'UP', minCollectMinor: 700, graceDays: 4, retryDays: [3, 6], invoiceDueDays: 21, reminderDays: [-3, 0, 7], disputeWindowDays: 9, savedMethodChargeAllowed: false };
    const r = (await c.http().post(`${R}/defaults`).set(sa1).send({ product: 'CLINIC', spec: full }).expect(200)).body;
    await c.http().post(`${R}/${r.id}/decide`).set(sa2).send({ approve: true }).expect(200);
    await c.http().post(`${R}/defaults`).set(sa1).send({ product: 'LAB', spec: { feeType: 'FLAT', flatMinor: 1, graceDays: 99 } }).expect(400);
    await marketSettings({ ...S, graceDays: 1, invoiceDueDays: 10, minCollectMinor: 0 });
    await confirmed(ORG, '100.00'); // links the organisation to the CLINIC default
    const eff = await c.get(CommissionConfigService).effective(ORG, 'EG');
    expect(eff.settings).toMatchObject({ mode: 'INVOICE_AND_COLLECT', cycle: 'MONTHLY', cutoffDay: 5, graceDays: 4, retryDays: [3, 6], minCollectMinor: 700, invoiceDueDays: 21 });
    expect(eff.rate).toMatchObject({ currency: 'EGP', rounding: 'UP', reminderDays: [-3, 0, 7], disputeWindowDays: 9, savedMethodChargeAllowed: false });
    const ov = (await c.http().post(`${R}/orgs/${ORG}`).set(sa1).send({ product: 'CLINIC', kind: 'RATE', spec: { feeType: 'FLAT', flatMinor: 4000, graceDays: 2 }, reason: 'contract' }).expect(200)).body;
    await c.http().post(`${R}/${ov.id}/decide`).set(sa2).send({ approve: true }).expect(200);
    const eff2 = await c.get(CommissionConfigService).effective(ORG, 'EG');
    expect(eff2.settings).toMatchObject({ graceDays: 2, invoiceDueDays: 10, minCollectMinor: 0 }); // the override states only grace: everything else follows the collection settings
  });

  it('savedMethodChargeAllowed=false on the rate sends an AUTO_CHARGE organisation to an invoice with its own reason (mock mode)', async () => {
    await marketSettings({ ...S, mode: 'AUTO_CHARGE_SAVED_METHOD' });
    const r = (await c.http().post(`${R}/defaults`).set(sa1).send({ product: 'CLINIC', spec: { feeType: 'PERCENT', percentBps: 500, savedMethodChargeAllowed: false } }).expect(200)).body;
    await c.http().post(`${R}/${r.id}/decide`).set(sa2).send({ approve: true }).expect(200);
    await confirmed(ORG, '100.00');
    await c.http().put(`/api/v1/admin/commissions/orgs/${ORG}/provider`).set(sa1).send({ market: 'EG', provider: 'paymob' }).expect(200);
    await c.http().post(`/api/v1/admin/commissions/orgs/${ORG}/saved-method`).set(sa1).send({ provider: 'paymob', tokenRef: 'tok_ok_1', last4: '4242' }).expect(200);
    await c.get(CommissionCollectionService).runForOrg(ORG, NOW);
    expect(await c.prisma.commissionRun.findFirstOrThrow()).toMatchObject({ modeRequested: 'AUTO_CHARGE_SAVED_METHOD', mode: 'INVOICE_AND_COLLECT', fallbackReason: 'SAVED_METHOD_NOT_PERMITTED' });
    expect(await c.prisma.commissionAttempt.count({ where: { kind: 'CHARGE' } })).toBe(0);
  });

  it('a configured dispute window moves which claims enter the run; a configured currency selects the claims', async () => {
    await marketSettings();
    const mk = async (spec: object) => { const r = (await c.http().post(`${R}/defaults`).set(sa1).send({ product: 'CLINIC', spec }).expect(200)).body; await c.http().post(`${R}/${r.id}/decide`).set(sa2).send({ approve: true }).expect(200); };
    await mk({ feeType: 'PERCENT', percentBps: 500, currency: 'USD' });
    await confirmed(ORG, '100.00');
    expect((await c.get(CommissionCollectionService).runForOrg(ORG, NOW)).status).toBe('NOTHING_DUE'); // the claim is EGP, the rate collects USD
    await mk({ feeType: 'PERCENT', percentBps: 500, currency: 'EGP', disputeWindowDays: 60 }); // confirmed 10 Nov + 60 days is after the cut-off of 5 Dec
    expect((await c.get(CommissionCollectionService).runForOrg(ORG, NOW)).status).toBe('NOTHING_DUE');
    await mk({ feeType: 'PERCENT', percentBps: 500, currency: 'EGP', disputeWindowDays: 3 });
    expect((await c.get(CommissionCollectionService).runForOrg(ORG, NOW)).status).not.toBe('NOTHING_DUE');
  });

  it('the Integrations Control Center shows the counsel status and why each payment route is blocked in real mode', async () => {
    const o = (await c.http().get('/api/v1/admin/integrations-center').set(sa1).expect(200)).body;
    expect(o.counsel).toMatchObject({ market: 'EG', status: 'NOT_REVIEWED', realBlocked: 8, page: '/commission-policy' });
    const paymob = o.integrations.find((i: any) => i.key === 'PAYMOB');
    expect(paymob.counselGate).toMatchObject({ allowed: false, reason: 'COUNSEL_NOT_REVIEWED' });
    await apply('COMMISSION_COUNSEL_SIGNOFF', counsel());
    const o2 = (await c.http().get('/api/v1/admin/integrations-center').set(sa1).expect(200)).body;
    expect(o2.integrations.find((i: any) => i.key === 'PAYMOB').counselGate).toMatchObject({ allowed: true });
    expect(o2.integrations.find((i: any) => i.key === 'FAWRY').counselGate).toMatchObject({ allowed: false, reason: 'NOT_IN_APPROVED_LIST' });
  });
});
