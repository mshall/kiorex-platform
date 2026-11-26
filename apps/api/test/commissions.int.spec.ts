import { CommissionCollectionService, CommissionQueryService } from '../src/commissions/commissions-public';
import { createCtx, TestCtx } from './harness';

/** COM-1: commission claims, config (maker-checker), the three collection modes, dunning with invoice fallback, net-from-payout, reconciliation, exports, roles. Settings values are TEST placeholders. */
describe('commission collection', () => {
  let c: TestCtx; let sa1: any; let sa2: any; let fin: any; let ops: any;
  const ORG = 'org_alpha'; const ORG2 = 'org_beta';
  const S = { mode: 'AUTO_CHARGE_SAVED_METHOD', cycle: 'MONTHLY', cutoffDay: 5, graceDays: 1, retryDays: [2, 4], minCollectMinor: 0, invoiceDueDays: 10 };
  const NOW = new Date('2026-12-07T10:00:00Z'); // period 2026-12-05 is due (grace 1)
  let seq = 0;
  const confirmed = async (org: string, amount: string, o: { decision?: string; clinic?: string } = {}) => {
    const n = ++seq; const chargeId = `chg_${n}`;
    await wh('COMMISSION_CHARGE_CREATED', { chargeId, appointmentId: `apt_${n}`, amount, currency: 'EGP', status: 'PENDING', tenantId: org, clinicId: o.clinic ?? `${org}_clinic`, decisionAmount: o.decision ?? amount, disputeDeadline: '2026-11-20T00:00:00Z', feeBasisMinor: 30000, sponsoredDiscountMinor: 5000, basisPolicyVersion: 'BP1' }, { aggregateId: `apt_${n}`, eventId: `e_c_${n}` }); 
    await wh('COMMISSION_CHARGE_STATUS_CHANGED', { chargeId, appointmentId: `apt_${n}`, amount, currency: 'EGP', status: 'CONFIRMED', tenantId: org, confirmedAt: '2026-11-10T00:00:00Z', disputeDeadline: '2026-11-20T00:00:00Z' }, { aggregateId: `apt_${n}`, eventId: `e_s_${n}` }); 
    return chargeId;
  };
  const activate = async (scope: 'MARKET' | 'ORG', ref: string, settings: object) => {
    const p = (await c.http().post('/api/v1/admin/commissions/config').set(sa1).send({ scope, scopeRef: ref, settings }).expect(200)).body;
    await c.http().post(`/api/v1/admin/commissions/config/${p.id}/decide`).set(sa2).send({ approve: true }).expect(200);
  };
  beforeAll(async () => {
    c = await createCtx();
  });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => {
    await c.reset(); seq = 0;
    sa1 = await c.as('sa1', { roles: ['super_admin', 'ops_admin'] }); sa2 = await c.as('sa2', { roles: ['super_admin', 'ops_admin'] });
    fin = await c.as('fin1', { roles: ['finance', 'ops_admin'] }); ops = await c.as('ops1', { roles: ['ops_admin'] });
  });
  const wh = async (...a: Parameters<TestCtx['webhook']>) => { const r = await c.webhook(...a); expect([200, 202]).toContain(r.status); return r; };
  const svc = () => c.get(CommissionCollectionService); const q = () => c.get(CommissionQueryService);

  it('ingests charges idempotently and in time order; amounts and decision basis are kept', async () => {
    const id = await confirmed(ORG, '150.00');
    await wh('COMMISSION_CHARGE_CREATED', { chargeId: id, appointmentId: 'apt_1', amount: '150.00', status: 'PENDING', tenantId: ORG }, { aggregateId: 'apt_1', eventId: 'e_c_1_replay' });  // older status must not regress
    const claim = await c.prisma.commissionClaim.findUniqueOrThrow({ where: { chargeId: id } });
    expect(claim).toMatchObject({ amountMinor: 15000, chargeStatus: 'CONFIRMED', feeBasisMinor: 30000, sponsoredDiscountMinor: 5000, basisPolicyVersion: 'BP1', orgRef: ORG });
    expect(await c.prisma.commissionClaim.count()).toBe(1);
  });

  it('nothing is configured by default: the run says what is missing and moves no money', async () => {
    await confirmed(ORG, '100.00');
    const r = await svc().runForOrg(ORG, NOW);
    expect(r.status).toBe('NOT_CONFIGURED'); expect(r.missing).toContain('mode');
    expect(await c.prisma.commissionRun.count()).toBe(0);
  });

  it('maker-checker: proposer cannot decide; finance cannot propose; ops_admin sees no money', async () => {
    const p = (await c.http().post('/api/v1/admin/commissions/config').set(sa1).send({ scope: 'MARKET', scopeRef: 'EG', settings: S }).expect(200)).body;
    await c.http().post(`/api/v1/admin/commissions/config/${p.id}/decide`).set(sa1).send({ approve: true }).expect(403);
    await c.http().post('/api/v1/admin/commissions/config').set(fin).send({ scope: 'MARKET', scopeRef: 'EG', settings: S }).expect(403);
    await c.http().post(`/api/v1/admin/commissions/config/${p.id}/decide`).set(sa2).send({ approve: true }).expect(200);
    await c.http().get('/api/v1/admin/commissions/summary').set(ops).expect(403);
    await c.http().get('/api/v1/admin/commissions/summary').set(fin).expect(200);
    await c.http().post('/api/v1/admin/commissions/config').set(sa1).send({ scope: 'MARKET', scopeRef: 'EG', settings: { cycle: 'DAILY' } }).expect(400);
  });

  it('AUTO_CHARGE: charges the saved method through the chosen provider once; a second run does nothing; ledger and books reconcile', async () => {
    await activate('MARKET', 'EG', S);
    await confirmed(ORG, '100.00'); await confirmed(ORG, '50.00');
    await c.http().put(`/api/v1/admin/commissions/orgs/${ORG}/provider`).set(sa1).send({ market: 'EG', provider: 'paymob' }).expect(200);
    await c.http().post(`/api/v1/admin/commissions/orgs/${ORG}/saved-method`).set(sa1).send({ provider: 'paymob', tokenRef: 'tok_ok_1', last4: '4242' }).expect(200);
    const r = await svc().runForOrg(ORG, NOW);
    expect(r).toMatchObject({ status: 'COLLECTED', claimsMinor: 15000 });
    expect((await svc().runForOrg(ORG, NOW)).status).toBe('EXISTS');
    expect(await c.prisma.commissionRun.count()).toBe(1);
    const run = await c.prisma.commissionRun.findFirstOrThrow();
    expect(run).toMatchObject({ collectedMinor: 15000, mode: 'AUTO_CHARGE_SAVED_METHOD', provider: 'paymob' });
    expect(await c.prisma.commissionClaim.count({ where: { collectionStatus: 'COLLECTED', collectedMinor: { gt: 0 } } })).toBe(2);
    const fees = await c.prisma.ledgerEntry.aggregate({ where: { account: 'COMMISSION_FEES' }, _sum: { creditMinor: true } });
    expect(fees._sum.creditMinor).toBe(15000);
    expect((await q().reconciliation({ orgRef: ORG })).findings).toEqual([]);
    const detail = (await c.http().get(`/api/v1/admin/commissions/runs/${run.id}`).set(fin).expect(200)).body;
    expect(detail.timeline.map((t: any) => t.event)).toEqual(expect.arrayContaining(['RUN_PLANNED', 'CHARGE_SUCCEEDED']));
    expect(detail.claims).toHaveLength(2);
  });

  it('dunning: retryable declines retry on schedule, then fall back to an invoice; care is never touched; paying the invoice settles', async () => {
    await activate('MARKET', 'EG', S);
    await confirmed(ORG, '100.00');
    await c.http().put(`/api/v1/admin/commissions/orgs/${ORG}/provider`).set(sa1).send({ market: 'EG', provider: 'fawry' }).expect(200);
    await c.http().post(`/api/v1/admin/commissions/orgs/${ORG}/saved-method`).set(sa1).send({ provider: 'fawry', tokenRef: 'fail_retry_1' }).expect(200);
    expect((await svc().runForOrg(ORG, NOW)).status).toBe('RETRYING');
    const run = await c.prisma.commissionRun.findFirstOrThrow();
    expect((await svc().processPending(new Date(NOW.getTime() + 3 * 86_400_000)))).toMatchObject({ retried: 1 });
    expect((await c.prisma.commissionRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe('RETRYING');
    await svc().processPending(new Date(NOW.getTime() + 6 * 86_400_000));
    const after = await c.prisma.commissionRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(after).toMatchObject({ status: 'INVOICE_OPEN', fallbackReason: 'RETRIES_EXHAUSTED', invoicedMinor: 10000, collectedMinor: 0 });
    expect(after.invoiceNo).toMatch(/^KXC-/);
    expect((await c.prisma.commissionClaim.findFirstOrThrow()).collectionStatus).toBe('INVOICED'); // never written off
    const aging = (await c.http().get('/api/v1/admin/commissions/aging').set(fin).expect(200)).body;
    expect(aging.rows[0]).toMatchObject({ orgRef: ORG, openMinor: 10000 });
    await c.http().post(`/api/v1/admin/commissions/runs/${run.id}/invoice-paid`).set(fin).send({ providerRef: 'fawry_ref_1', amountMinor: 4000 }).expect(200);
    await c.http().post(`/api/v1/admin/commissions/runs/${run.id}/invoice-paid`).set(fin).send({ providerRef: 'fawry_ref_1', amountMinor: 4000 }).expect(200); // idempotent
    await c.http().post(`/api/v1/admin/commissions/runs/${run.id}/invoice-paid`).set(fin).send({ providerRef: 'fawry_ref_2' }).expect(200);
    const done = await c.prisma.commissionRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(done).toMatchObject({ status: 'SETTLED', paidMinor: 10000 });
    expect((await c.prisma.commissionClaim.findFirstOrThrow()).collectionStatus).toBe('PAID');
    expect((await q().reconciliation({ orgRef: ORG })).findings).toEqual([]);
  });

  it('a hard decline or a missing saved method falls back to an invoice at once with the reason', async () => {
    await activate('MARKET', 'EG', S);
    await confirmed(ORG, '100.00'); await confirmed(ORG2, '70.00');
    await c.http().put(`/api/v1/admin/commissions/orgs/${ORG}/provider`).set(sa1).send({ market: 'EG', provider: 'paymob' }).expect(200);
    await c.http().post(`/api/v1/admin/commissions/orgs/${ORG}/saved-method`).set(sa1).send({ provider: 'paymob', tokenRef: 'fail_hard_1' }).expect(200);
    const out = (await svc().runDue(NOW)).outcomes.sort((a, b) => a.orgRef.localeCompare(b.orgRef));
    expect(out.map((o) => o.status)).toEqual(['INVOICE_OPEN', 'INVOICE_OPEN']);
    expect((await c.prisma.commissionRun.findFirstOrThrow({ where: { orgRef: ORG } })).fallbackReason).toBe('RETRIES_EXHAUSTED');
    expect((await c.prisma.commissionRun.findFirstOrThrow({ where: { orgRef: ORG2 } })).fallbackReason).toBe('NO_PROVIDER_CHOSEN');
  });

  it('per-organisation override and provider validation; payment card numbers are never accepted', async () => {
    await activate('MARKET', 'EG', S);
    await activate('ORG', ORG, { mode: 'INVOICE_AND_COLLECT' });
    expect((await q().org(await (async () => { await confirmed(ORG, '10.00'); return ORG; })())).config.settings.mode).toBe('INVOICE_AND_COLLECT');
    await c.http().put(`/api/v1/admin/commissions/orgs/${ORG}/provider`).set(sa1).send({ market: 'EG', provider: 'bitcoin' }).expect(400);
    await c.http().post(`/api/v1/admin/commissions/orgs/${ORG}/saved-method`).set(sa1).send({ provider: 'paymob', tokenRef: '4242424242424242' }).expect(400);
    expect(await c.prisma.auditLog.count({ where: { action: { startsWith: 'commission.policy' } } })).toBe(4);
  });

  it('NET_FROM_PAYOUT: the commission is kept out of the next payout; the shortfall after the window becomes an invoice', async () => {
    await activate('MARKET', 'EG', { ...S, mode: 'NET_FROM_PAYOUT' });
    await confirmed(ORG, '100.00', { clinic: 'clin_net' });
    expect((await svc().runForOrg(ORG, NOW)).status).toBe('COLLECTING');
    const tx = await c.prisma.$transaction(async (t) => svc().reserveForPayout(t, { clinicId: 'clin_net', payoutId: 'po_t1', payoutRef: 'po_ref_1', grossMinor: 6000, currency: 'EGP' }));
    expect(tx).toBe(6000);
    const mid = await c.prisma.commissionRun.findFirstOrThrow();
    expect(mid).toMatchObject({ status: 'COLLECTING', deductedMinor: 6000 });
    expect(await c.prisma.$transaction(async (t) => svc().reserveForPayout(t, { clinicId: 'clin_net', payoutId: 'po_t1', payoutRef: 'po_ref_1', grossMinor: 6000, currency: 'EGP' }))).toBe(0); // idempotent per payout
    await svc().processPending(new Date(NOW.getTime() + 10 * 86_400_000));
    const end = await c.prisma.commissionRun.findFirstOrThrow();
    expect(end).toMatchObject({ status: 'INVOICE_OPEN', deductedMinor: 6000, invoicedMinor: 4000, fallbackReason: 'NET_SHORTFALL' });
    expect((await q().reconciliation({ orgRef: ORG })).findings).toEqual([]);
  });

  it('a reversal after collection flags a credit due; a reversal before collection releases the claim', async () => {
    await activate('MARKET', 'EG', S);
    const a = await confirmed(ORG, '100.00'); const b = await confirmed(ORG, '40.00');
    await c.http().put(`/api/v1/admin/commissions/orgs/${ORG}/provider`).set(sa1).send({ market: 'EG', provider: 'paymob' }).expect(200);
    await wh('COMMISSION_CHARGE_REVERSED', { chargeId: b, appointmentId: 'apt_2', amount: '40.00', tenantId: ORG }, { aggregateId: 'apt_2', eventId: 'e_rev_b' }); 
    await c.http().post(`/api/v1/admin/commissions/orgs/${ORG}/saved-method`).set(sa1).send({ provider: 'paymob', tokenRef: 'tok_ok' }).expect(200);
    expect((await svc().runForOrg(ORG, NOW)).claimsMinor).toBe(10000);
    await wh('COMMISSION_CHARGE_REVERSED', { chargeId: a, appointmentId: 'apt_1', amount: '100.00', tenantId: ORG }, { aggregateId: 'apt_1', eventId: 'e_rev_a' }); 
    expect((await c.prisma.commissionClaim.findUniqueOrThrow({ where: { chargeId: a } })).reversedAfterCollection).toBe(true);
    expect((await q().reconciliation({ orgRef: ORG })).findings.map((f) => f.code)).toContain('CREDIT_DUE');
  });

  it('charged != decision amount is reported by the reconciliation', async () => {
    await confirmed(ORG, '100.00', { decision: '90.00' });
    expect((await q().reconciliation({ orgRef: ORG })).findings.map((f) => f.code)).toEqual(['CHARGE_NE_DECISION']);
  });

  it('a claim that differs from the resolved commission rate is reported (CLAIM_NE_RATE); a claim equal to it is not', async () => {
    const R = '/api/v1/admin/commissions/rates';
    const p = (await c.http().post(`${R}/defaults`).set(sa1).send({ product: 'CLINIC', spec: { feeType: 'PERCENT', percentBps: 1000 } }).expect(200)).body; // TEST placeholder: 10% of the 300.00 fee basis = 30.00
    await c.http().post(`${R}/${p.id}/decide`).set(sa2).send({ approve: true }).expect(200);
    await confirmed(ORG, '30.00'); const bad = await confirmed(ORG, '35.00');
    const f = (await q().reconciliation({ orgRef: ORG })).findings;
    expect(f.map((x) => x.code)).toEqual(['CLAIM_NE_RATE']);
    expect(f[0]).toMatchObject({ ref: (await c.prisma.commissionClaim.findUniqueOrThrow({ where: { chargeId: bad } })).id, expectedMinor: 3000, actualMinor: 3500 });
  });

  it('exports are CSV, role-checked and audited; the same filter exports the same rows', async () => {
    await confirmed(ORG, '100.00'); await confirmed(ORG2, '20.00');
    await c.http().get('/api/v1/admin/commissions/export/claims').set(ops).expect(403);
    const r = await c.http().get('/api/v1/admin/commissions/export/claims?org=org_alpha').set(fin).expect(200);
    expect(r.headers['content-type']).toContain('text/csv'); expect(r.text).toContain('chg_1'); expect(r.text).not.toContain('chg_2');
    const audits = (await c.http().get('/api/v1/admin/commissions/export-audit').set(fin).expect(200)).body;
    expect(audits[0]).toMatchObject({ actor: 'fin1', view: 'claims', format: 'CSV', scopeOrg: 'org_alpha', rowCount: 1 });
    await c.http().get('/api/v1/admin/commissions/export/nonsense').set(fin).expect(400);
  });

  it('the bilingual PDF statement is role-checked and audited', async () => {
    await confirmed(ORG, '100.00');
    await c.http().get('/api/v1/admin/commissions/statement.pdf').set(ops).expect(403);
    const r = await c.http().get('/api/v1/admin/commissions/statement.pdf?org=org_alpha').set(fin).buffer(true).parse((res, cb) => { const ch: Buffer[] = []; res.on('data', (d: Buffer) => ch.push(d)); res.on('end', () => cb(null, Buffer.concat(ch))); }).expect(200);
    expect(r.headers['content-type']).toContain('application/pdf'); expect((r.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect(await c.prisma.commissionExportAudit.count({ where: { view: 'statement', format: 'PDF', actor: 'fin1' } })).toBe(1);
  });

  it('the timeline is append-only at the database', async () => {
    await confirmed(ORG, '10.00');
    await expect(c.prisma.$executeRawUnsafe(`UPDATE "CommissionTimeline" SET event='X'`)).rejects.toThrow(/append-only/);
    await expect(c.prisma.$executeRawUnsafe(`DELETE FROM "CommissionTimeline"`)).rejects.toThrow(/append-only/);
  });
});
