import { signKiorlyRequest } from '@kiorex/contracts';
import { createCtx, TestCtx } from './harness';
import { FakePartner } from './fake-partner';

/**
 * LG-COM-19: the settlement statement for a signed partner product (Clinic, Pharmacy, Lab): own organisation only, the same figures and CSV as the ops route, rate limited and audited.
 * All amounts are TEST placeholders. Private per-run database (test/db-url.ts) and private fake partners; nothing shared.
 */
describe('partner settlement statement (signed partner route)', () => {
  let c: TestCtx; let ph: FakePartner; let lab: FakePartner; let sa1: any; let sa2: any; let fin: any; let phReg = ''; let labReg = '';
  const ORG = 'org_alpha'; const OTHER = 'org_beta'; const A = '/api/v1/admin/commissions'; const P = '/api/v1/partner/commissions/settlement-statement';
  const CLINIC = { key: 'kx_dev_client', secret: 'kx_dev_webhook_secret' };
  const S = { mode: 'NET_FROM_PAYOUT', cycle: 'MONTHLY', cutoffDay: 5, graceDays: 1, retryDays: [2, 4], minCollectMinor: 0, invoiceDueDays: 10 };
  const range = { from: '2026-11-01T00:00:00Z', to: '2099-01-01T00:00:00Z' };
  let n = 0;
  const wh = async (...a: Parameters<TestCtx['webhook']>) => { const r = await c.webhook(...a); expect([200, 202]).toContain(r.status); };
  const charge = async (org: string, amount: string, tender?: string) => {
    const i = ++n;
    await wh('COMMISSION_CHARGE_CREATED', { chargeId: `chg_p${i}`, appointmentId: `apt_p${i}`, amount, currency: 'EGP', status: 'PENDING', tenantId: org, clinicId: org, decisionAmount: amount, disputeDeadline: '2026-11-20T00:00:00Z', feeBasisMinor: 100000, ...(tender ? { tender } : {}) }, { aggregateId: `apt_p${i}`, eventId: `e_p_${i}_a` });
    await wh('COMMISSION_CHARGE_STATUS_CHANGED', { chargeId: `chg_p${i}`, appointmentId: `apt_p${i}`, amount, currency: 'EGP', status: 'CONFIRMED', tenantId: org, confirmedAt: '2026-11-10T00:00:00Z', disputeDeadline: '2026-11-20T00:00:00Z' }, { aggregateId: `apt_p${i}`, eventId: `e_p_${i}_b` });
  };
  /** A signed GET exactly as a partner product sends it: the path is what is signed, the query is not. */
  const sign = (o: { key?: string; secret?: string; org?: string; path?: string; ts?: number; nonce?: string } = {}) => {
    const s = signKiorlyRequest({ clientKey: o.key ?? CLINIC.key, clientSecret: o.secret ?? CLINIC.secret, method: 'GET', path: o.path ?? P, timestamp: o.ts, nonce: o.nonce });
    return { ...s.headers, ...(o.org ? { 'X-Kiorly-Org-Ref': o.org } : {}) } as Record<string, string>;
  };
  const get = (path: string, h: Record<string, string>, q: Record<string, string> = range) => c.http().get(path).query(q).set(h);

  beforeAll(async () => { c = await createCtx(); ph = await new FakePartner('pharmacy').start(); lab = await new FakePartner('lab').start(); });
  afterAll(async () => { await c.close(); await ph.stop(); await lab.stop(); });
  beforeEach(async () => {
    await c.reset(); n = 0;
    sa1 = await c.as('sa1', { roles: ['super_admin', 'ops_admin'] }); sa2 = await c.as('sa2', { roles: ['super_admin', 'ops_admin'] }); fin = await c.as('fin1', { roles: ['finance', 'ops_admin'] });
    const p = (await c.http().post(`${A}/config`).set(sa1).send({ scope: 'MARKET', scopeRef: 'EG', settings: S }).expect(200)).body;
    await c.http().post(`${A}/config/${p.id}/decide`).set(sa2).send({ approve: true }).expect(200);
    phReg = (await c.http().post('/api/v1/admin/partners/pharmacy').set(sa1).send({ name: 'Pharmacy A', baseUrl: ph.url, clientKey: ph.cfg.clientKey, clientSecret: ph.cfg.clientSecret, webhookSecret: ph.cfg.webhookSecret }).expect(201)).body.id;
    labReg = (await c.http().post('/api/v1/admin/partners/lab').set(sa1).send({ name: 'Lab A', baseUrl: lab.url, clientKey: lab.cfg.clientKey, clientSecret: lab.cfg.clientSecret, webhookSecret: lab.cfg.webhookSecret }).expect(201)).body.id;
    // Clinic ORG: a cash and an online charge, one bank-transfer payout, matched; OTHER Clinic org has its own distinct figures
    await charge(ORG, '40.00', 'CASH'); await charge(ORG, '60.00', 'ONLINE'); await charge(OTHER, '90.00', 'CASH');
    await c.prisma.payout.create({ data: { id: 'po_p1', payoutRef: 'po_p1_ref', clinicId: ORG, amountMinor: 20000, commissionDeductedMinor: 10000, currency: 'EGP', periodKey: '2026-W50', paymentRefs: [] } });
    await c.prisma.pspSettlementLine.create({ data: { psp: 'paymob', pspRef: 'bank_ref_p1', kind: 'PAYOUT', amountMinor: 20000, date: new Date('2026-12-08'), matched: true, payoutRef: 'po_p1_ref' } });
    await c.prisma.payout.create({ data: { id: 'po_p2', payoutRef: 'po_p2_ref', clinicId: OTHER, amountMinor: 77700, commissionDeductedMinor: 0, currency: 'EGP', periodKey: '2026-W50', paymentRefs: [] } });
    await c.prisma.payout.create({ data: { id: 'po_p3', payoutRef: 'po_p3_ref', clinicId: phReg, amountMinor: 5500, commissionDeductedMinor: 0, currency: 'EGP', periodKey: '2026-W50', paymentRefs: [] } });
  });

  it('Clinic: its own statement is the ops statement, field for field, and the CSV is byte for byte the ops CSV', async () => {
    const mine = (await get(P, sign({ org: ORG })).expect(200)).body;
    const ops = (await get(`${A}/settlement-statement/${ORG}`, fin).expect(200)).body;
    expect(mine).toEqual(ops);
    expect(mine).toMatchObject({ orgRef: ORG, onlineCollectionsMinor: 30000, cashVisitCommissionAccruedMinor: 4000, netPayableMinor: 20000, reconciliation: 'MATCHED' });
    const csv = await get(`${P}/export`, sign({ path: `${P}/export`, org: ORG })).expect(200);
    const opsCsv = await get(`${A}/settlement-statement/${ORG}/export`, fin).expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/); expect(csv.headers['content-disposition']).toBe(opsCsv.headers['content-disposition']);
    expect(csv.text).toBe(opsCsv.text); expect(csv.text).toContain('netPayable,200.00');
    // the default period (no from/to) answers too, with the same shape as the ops default
    const d1 = (await get(P, sign({ org: ORG }), {}).expect(200)).body; const d2 = (await get(`${A}/settlement-statement/${ORG}`, fin, {}).expect(200)).body;
    expect(d1).toEqual(d2);
  });

  it('Clinic: another Clinic organisation has its own figures and neither sees the other', async () => {
    const other = (await get(P, sign({ org: OTHER })).expect(200)).body;
    expect(other).toMatchObject({ orgRef: OTHER, cashVisitCommissionAccruedMinor: 9000, paidByBankTransferMinor: 77700 });
    expect(JSON.stringify(other)).not.toContain(ORG); expect(JSON.stringify((await get(P, sign({ org: ORG })).expect(200)).body)).not.toContain(OTHER);
    expect(JSON.stringify(other)).not.toContain('po_p1');
  });

  it('Pharmacy and Lab: the organisation is the registration, never the request; the statement has the same shape as the ops one', async () => {
    const mine = (await get(P, sign({ key: ph.cfg.clientKey, secret: ph.cfg.webhookSecret })).expect(200)).body;
    const ops = (await get(`${A}/settlement-statement/${phReg}`, fin).expect(200)).body;
    expect(mine).toEqual(ops); expect(mine).toMatchObject({ orgRef: phReg, paidByBankTransferMinor: 5500 });
    expect(Object.keys(mine).sort()).toEqual(Object.keys((await get(P, sign({ org: ORG })).expect(200)).body).sort());
    const labStatement = (await get(P, sign({ key: lab.cfg.clientKey, secret: lab.cfg.webhookSecret, org: labReg })).expect(200)).body;
    expect(labStatement).toMatchObject({ orgRef: labReg, reconciliation: 'NO_PAYOUT', netPayableMinor: 0 }); expect(JSON.stringify(labStatement)).not.toContain('po_p3');
    const csv = await get(`${P}/export`, sign({ key: ph.cfg.clientKey, secret: ph.cfg.webhookSecret, path: `${P}/export` })).expect(200);
    expect(csv.text).toBe((await get(`${A}/settlement-statement/${phReg}/export`, fin).expect(200)).text);
  });

  it('cross-organisation: nothing but its own organisation is ever answered, and every attempt is denied and audited', async () => {
    // a Pharmacy naming a Clinic org, the Lab's registration, or itself in the query with another value
    await get(P, sign({ key: ph.cfg.clientKey, secret: ph.cfg.webhookSecret, org: ORG })).expect(403).expect((r) => expect(r.body.code).toBe('PARTNER_ORG_MISMATCH'));
    await get(P, sign({ key: ph.cfg.clientKey, secret: ph.cfg.webhookSecret }), { ...range, orgRef: labReg }).expect(403);
    await get(P, sign({ key: lab.cfg.clientKey, secret: lab.cfg.webhookSecret, org: phReg })).expect(403);
    // a Clinic naming a Pharmacy registration, or a query org different from the header
    await get(P, sign({ org: phReg })).expect(403);
    await get(P, sign({ org: ORG }), { ...range, orgRef: OTHER }).expect(403);
    // the organisation in the query is accepted only when it IS the authenticated one
    await get(P, sign({ org: ORG }), { ...range, orgRef: ORG }).expect(200);
    // the ops route's path shape is not served to partners
    await c.http().get(`${A}/settlement-statement/${ORG}`).query(range).set(sign({ path: `${A}/settlement-statement/${ORG}`, org: ORG })).expect(401);
    const denied = await c.prisma.auditLog.findMany({ where: { action: 'commission.partner_statement_denied' } });
    expect(denied).toHaveLength(5); expect(JSON.stringify(denied)).not.toContain(ph.cfg.webhookSecret);
  });

  it('refuses a wrong key, a wrong secret, a stale and a replayed signature, an unsigned request, a missing organisation and an env-default partner; the Clinic secret is not a Pharmacy secret', async () => {
    await c.http().get(P).query(range).expect(401);
    await get(P, sign({ org: ORG, key: 'kx_wrong_client' })).expect(401);
    await get(P, sign({ org: ORG, secret: 'kx_wrong_secret' })).expect(401);
    await get(P, sign({ key: ph.cfg.clientKey, secret: CLINIC.secret })).expect(401);
    await get(P, sign({ key: CLINIC.key, secret: ph.cfg.webhookSecret, org: ORG })).expect(401);
    await get(P, sign({ org: ORG, ts: Date.now() - 6 * 60_000 })).expect(401);
    await get(P, sign({ org: ORG, ts: Date.now() + 6 * 60_000 })).expect(401);
    await get(P, sign({})).expect(401); // Clinic without an organisation
    const h = sign({ org: ORG, nonce: 'once-1' });
    await get(P, h).expect(200);
    await get(P, h).expect(401); // replay
    await get(P, sign({ org: ORG, nonce: 'once-1' })).expect(401); // same nonce, fresh signature
    // a request signed for the JSON path cannot be replayed on the CSV path
    const g = sign({ org: ORG }); await get(`${P}/export`, g).expect(401);
    // the dev-default Lab credentials (no registration for them in this database) carry no organisation
    await c.prisma.partnerRegistration.deleteMany({ where: { id: labReg } });
    await get(P, sign({ key: lab.cfg.clientKey, secret: lab.cfg.webhookSecret })).expect((r) => expect([401, 403]).toContain(r.status));
    // an inactive registration is refused
    await c.prisma.partnerRegistration.update({ where: { id: phReg }, data: { active: false } });
    await get(P, sign({ key: ph.cfg.clientKey, secret: ph.cfg.webhookSecret })).expect((r) => expect([401, 403]).toContain(r.status));
  });

  it('the body of the statement has only the fields of the ops statement and none of counsel, maker, document or internal-note data; invalid periods are a 400', async () => {
    const body = (await get(P, sign({ org: ORG })).expect(200)).body;
    expect(Object.keys(body).sort()).toEqual(['cashBreakdown', 'cashVisitCharges', 'cashVisitCommissionAccruedMinor', 'cashVisitCommissionNettedMinor', 'cashVisitCommissionOpenMinor', 'commission', 'currency', 'deductions', 'netPayableMinor', 'notes', 'onlineCollectionsMinor', 'orgRef', 'paidByBankTransferMinor', 'payoutMethod', 'payouts', 'period', 'reconciliation', 'unknownTender']);
    expect(JSON.stringify(body)).not.toMatch(/counsel|reviewer|proposedBy|decidedBy|approvedBy|documentUrl|conditions|internalNote|maker|sa1|sa2|fin1/i);
    await get(P, sign({ org: ORG }), { from: '2026-12-01', to: '2026-11-01' }).expect(400);
    await get(P, sign({ org: ORG }), { from: 'garbage' }).expect(400);
  });

  it('every read and export is audited with who, the organisation and the period, and nothing else', async () => {
    await get(P, sign({ org: ORG })).expect(200); await get(`${P}/export`, sign({ path: `${P}/export`, org: ORG })).expect(200);
    await get(P, sign({ key: ph.cfg.clientKey, secret: ph.cfg.webhookSecret })).expect(200);
    const rows = await c.prisma.auditLog.findMany({ where: { resource: 'CommissionStatement', action: { not: 'commission.partner_statement_denied' } }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => [r.action, r.actor, r.resourceId])).toEqual([['commission.partner_statement_read', `partner:${CLINIC.key}`, ORG], ['commission.partner_statement_export', `partner:${CLINIC.key}`, ORG], ['commission.partner_statement_read', `partner:${ph.cfg.clientKey}`, phReg]]);
    expect(rows[1]!.metadata).toMatchObject({ format: 'CSV', product: 'CLINIC', rows: expect.any(Number), from: range.from });
    expect(JSON.stringify(rows)).not.toContain(CLINIC.secret);
  });

  it('is rate limited per organisation with Retry-After, without blocking another organisation', async () => {
    process.env.COMMISSION_STATEMENT_RATE_PER_MIN = '3';
    try {
      for (let i = 0; i < 3; i++) await get(P, sign({ org: ORG })).expect(200);
      const r = await get(P, sign({ org: ORG })).expect(429);
      expect(r.body.code).toBe('PARTNER_RATE_LIMITED'); expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
      await get(P, sign({ org: OTHER })).expect(200);
    } finally { delete process.env.COMMISSION_STATEMENT_RATE_PER_MIN; }
  });

  it('an ops session is not a partner: the partner route needs the signature, whatever the bearer', async () => {
    await c.http().get(P).query(range).set(fin).expect(401);
    await c.http().get(P).query(range).set({ ...fin, ...sign({ org: ORG }) }).expect(200); // a bearer next to a valid signature changes nothing: the signature decides the organisation
  });
});
