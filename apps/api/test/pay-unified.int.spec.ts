import { createCtx, TestCtx } from './harness';
import { PayUnifiedService } from '../src/pay/pay-unified.service';

const B = '/api/v1/admin/payments';
let seq = 0;
/** Kiorly Pay unified layer on the real HTTP stack and Postgres (private per-run database): IPN matching queue, links, SHADOW fraud, rollups, roles. No vendor is called. */
describe('Kiorly Pay unified layer (LG-INT-PAY-12..16)', () => {
  let c: TestCtx; let fin: { Authorization: string }; let ops: { Authorization: string }; let sup: { Authorization: string }; let sa: { Authorization: string };
  const intent = (o: Partial<{ id: string; amountMinor: number; status: string; sub: string; psp: string; cardFingerprint: string; createdAt: Date }> = {}) =>
    c.prisma.paymentIntent.create({ data: { id: o.id ?? `pay_t${++seq}${Math.random().toString(36).slice(2, 8)}`, clinicId: 'cl_1', amountMinor: o.amountMinor ?? 5000, currency: 'EGP', psp: o.psp ?? 'bank_ipn', status: o.status ?? 'CREATED', purpose: 'LINK', sub: o.sub ?? null, cardFingerprint: o.cardFingerprint ?? null, createdAt: o.createdAt ?? new Date() } });
  const row = (ref: string, bankRef: string, amount: string, o: Record<string, string> = {}) => `${bankRef},${amount},EGP,${ref},2026-11-25T10:00:00Z,Ahmed Hassan,success,${o.type ?? 'credit'}`;
  const file = (...rows: string[]) => ['bankRef,amount,currency,reference,paidAt,payer,status,type', ...rows].join('\n');
  const upload = (content: string, h = fin) => c.http().post(`${B}/matching/ipn`).set(h).send({ content, format: 'csv' });

  beforeAll(async () => { c = await createCtx(); fin = await c.as('fin_1', { roles: ['finance'] }); ops = await c.as('ops_1', { roles: ['ops_admin'] }); sup = await c.as('sup_1', { roles: ['support'] }); sa = await c.as('sa_1', { roles: ['super_admin'] }); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => { await c.reset(); fin = await c.as('fin_1', { roles: ['finance'] }); ops = await c.as('ops_1', { roles: ['ops_admin'] }); sup = await c.as('sup_1', { roles: ['support'] }); sa = await c.as('sa_1', { roles: ['super_admin'] }); });

  describe('Phase 2: IPN matching and the finance-only queue', () => {
    it('exact reference + amount applies; mismatch, amount-only and reversals wait for a person; a re-upload changes nothing', async () => {
      const a = await intent({ amountMinor: 5000 }); const b = await intent({ amountMinor: 7000 }); const cc = await intent({ amountMinor: 9000 });
      const f = file(row(a.id, 'BK1', '50.00'), row(b.id, 'BK2', '70.01'), row('', 'BK3', '90.00'), row(a.id, 'BK4', '50.00', { type: 'reversal' }));
      const r = (await upload(f).expect(200)).body;
      expect(r).toMatchObject({ received: 4, applied: 1, queued: 3, duplicates: 0 });
      expect((await c.prisma.paymentIntent.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('CAPTURED');
      expect((await c.prisma.paymentIntent.findUniqueOrThrow({ where: { id: cc.id } })).status).toBe('CREATED'); // amount-only candidate is never applied
      const again = (await upload(f).expect(200)).body; expect(again).toMatchObject({ applied: 0, queued: 0, duplicates: 4 });
      const q = (await c.http().get(`${B}/matching/queue`).set(fin).expect(200)).body as Array<{ id: string; pspRef: string; decision: string }>;
      expect(q.map((x) => x.pspRef).sort()).toEqual(['BK2', 'BK3', 'BK4']);
      expect(q.every((x) => x.decision === 'REVIEW' || x.decision === 'UNMATCHED')).toBe(true);
    });
    it('the queue and the upload are finance-only: ops_admin and patients get 403', async () => {
      await c.http().get(`${B}/matching/queue`).set(ops).expect(403);
      await upload(file(), ops).expect(403);
      await c.http().get(`${B}/matching/queue`).set(await c.as('sub_amira')).expect(403);
      await c.http().get(`${B}/matching/queue`).set(sa).expect(200);
    });
    it('confirm: the payment amount check still applies (409, item reopens); a correct pairing captures once; reject closes', async () => {
      const b = await intent({ amountMinor: 7000 }); const cc = await intent({ amountMinor: 9000 });
      await upload(file(row('typo-ref', 'BK2', '70.00'), row('other', 'BK3', '90.00'), row('zzz', 'BK5', '12.00')));
      const q = (await c.http().get(`${B}/matching/queue`).set(fin).expect(200)).body as Array<{ id: string; pspRef: string }>;
      const id = (ref: string) => q.find((x) => x.pspRef === ref)!.id;
      await c.http().post(`${B}/matching/${id('BK3')}/confirm`).set(fin).send({ targetId: b.id }).expect(409); // 90.00 vs 70.00
      expect((await c.prisma.payMatchSignal.findUniqueOrThrow({ where: { id: id('BK3') } })).status).toBe('OPEN');
      await c.http().post(`${B}/matching/${id('BK3')}/confirm`).set(fin).send({ targetId: cc.id }).expect(200);
      expect((await c.prisma.paymentIntent.findUniqueOrThrow({ where: { id: cc.id } })).status).toBe('CAPTURED');
      await c.http().post(`${B}/matching/${id('BK3')}/confirm`).set(fin).send({ targetId: cc.id }).expect(409); // already decided
      await c.http().post(`${B}/matching/${id('BK5')}/reject`).set(fin).send({ note: 'not ours' }).expect(200);
      expect((await c.prisma.auditLog.count({ where: { action: { in: ['pay.match_confirmed', 'pay.match_rejected'] } } }))).toBe(2);
      const ledger = await c.prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*)::bigint n FROM "LedgerTx" WHERE "paymentId" = ${cc.id} AND kind = 'CAPTURE'`; expect(Number(ledger[0].n)).toBe(1);
    });
  });

  describe('Phase 3: payment links', () => {
    const mk = (o: Record<string, unknown> = {}) => c.http().post(`${B}/links`).set(sa).send({ context: 'CLINIC_INVOICE', subjectId: 'inv_1', organisationId: 'cl_1', amountMinor: 25000, ...o });
    it('is signed, single-use, amount-locked in the token and expiring; cancelled links cannot be used', async () => {
      const l = (await mk().expect(200)).body; expect(l.qr.kind).toBe('LINK'); expect(l.url).toContain('/pay/l/');
      const st = (await c.http().get(`/api/v1/pay/l/${l.token}`).expect(200)).body; expect(st).toMatchObject({ status: 'ACTIVE', amountMinor: 25000 });
      const co = (await c.http().post(`/api/v1/pay/l/${l.token}/checkout`).expect(200)).body; expect(co.paymentId).toBeTruthy();
      expect((await c.prisma.paymentIntent.findUniqueOrThrow({ where: { id: co.paymentId } })).amountMinor).toBe(25000);
      await c.http().post(`/api/v1/pay/l/${l.token}/checkout`).expect(409);
      expect((await c.http().get(`/api/v1/pay/l/${l.token}`).expect(200)).body.status).toBe('USED');
      const l2 = (await mk({ subjectId: 'inv_2' }).expect(200)).body; await c.http().post(`${B}/links/${l2.id}/cancel`).set(sa).expect(200);
      await c.http().post(`/api/v1/pay/l/${l2.token}/checkout`).expect(409);
      const l3 = (await mk({ subjectId: 'inv_3' }).expect(200)).body; await c.prisma.payLinkIssue.update({ where: { id: l3.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await c.http().post(`/api/v1/pay/l/${l3.token}/checkout`).expect(409);
      await c.http().get('/api/v1/pay/l/not-a-token').expect(404);
      const forged = l.token.replace(/\.[^.]+\./, `.${Buffer.from(JSON.stringify({ id: 'x', amountMinor: 1, exp: 9e9 })).toString('base64url')}.`); await c.http().get(`/api/v1/pay/l/${forged}`).expect(404);
    });
    it('concurrent checkouts: exactly one wins and exactly one payment exists', async () => {
      const l = (await mk({ subjectId: 'inv_c' }).expect(200)).body;
      const r = await Promise.all(Array.from({ length: 6 }, () => c.http().post(`/api/v1/pay/l/${l.token}/checkout`)));
      expect(r.filter((x) => x.status === 200)).toHaveLength(1); expect(await c.prisma.paymentIntent.count({ where: { orderRef: 'CLINIC_INVOICE:inv_c' } })).toBe(1);
    });
    it('rejects bad amounts', async () => { await mk({ amountMinor: 0 }).expect(400); await mk({ ttlSec: 5 }).expect(400); });
  });

  describe('Phase 4: organisation preference', () => {
    it('stores an audited preference, refuses unknown providers, excludes blocked ones from the order', async () => {
      await c.http().put(`${B}/organisations/cl_1/provider-preference`).set(sa).send({ preference: { order: ['fawry', 'paymob'], blocked: ['card'] } }).expect(200);
      await c.http().put(`${B}/organisations/cl_1/provider-preference`).set(sa).send({ preference: { order: ['nope'] } }).expect(400);
      await c.http().put(`${B}/organisations/cl_1/provider-preference`).set(ops).send({ preference: { order: ['paymob'] } }).expect(403);
      expect((await c.http().get(`${B}/organisations/cl_1/provider-preference`).set(fin).expect(200)).body).toMatchObject({ order: ['fawry', 'paymob'], blocked: ['card'] });
      expect(await c.prisma.auditLog.count({ where: { action: 'pay.org_preference_changed' } })).toBe(1);
      expect(await c.get(PayUnifiedService).orderedCandidates({ currency: 'EGP', organisationId: 'cl_1' })).not.toContain('card');
    });
  });

  describe('Phase 5: fraud scorer (shadow) and rollups', () => {
    it('scores a burst of failures without touching the payment, queues it, and a person reviews it (no ban)', async () => {
      const now = Date.now();
      for (let i = 0; i < 9; i++) await intent({ sub: 'sub_x', psp: 'paymob', status: 'FAILED', amountMinor: 1000, cardFingerprint: `fp${i}`, createdAt: new Date(now - (i + 1) * 30_000) });
      const last = await intent({ sub: 'sub_x', psp: 'paymob', status: 'FAILED', amountMinor: 1000, cardFingerprint: 'fpz' });
      const a = await c.get(PayUnifiedService).assessPayment(last.id);
      expect(a!.mode).toBe('SHADOW'); expect(a!.action).toBe('NONE'); expect(a!.signals.map((s) => s.rule)).toEqual(expect.arrayContaining(['VELOCITY', 'CARD_TESTING']));
      expect((await c.prisma.paymentIntent.findUniqueOrThrow({ where: { id: last.id } })).status).toBe('FAILED');
      const q = (await c.http().get(`${B}/fraud/queue`).set(fin).expect(200)).body; expect(q).toHaveLength(1);
      await c.http().post(`${B}/fraud/${q[0].id}/review`).set(fin).send({ outcome: 'CONFIRMED' }).expect(403); // finance reads, support decides
      await c.http().post(`${B}/fraud/${q[0].id}/review`).set(sup).send({ outcome: 'FALSE_POSITIVE' }).expect(200);
      await c.http().post(`${B}/fraud/${q[0].id}/review`).set(sup).send({ outcome: 'CONFIRMED' }).expect(409);
      await c.http().get(`${B}/fraud/queue`).set(ops).expect(403);
    });
    it('a quiet account scores nothing', async () => { const p = await intent({ sub: 'sub_q', psp: 'paymob', status: 'CAPTURED' }); expect(await c.get(PayUnifiedService).assessPayment(p.id)).toMatchObject({ score: 0 }); expect(await c.prisma.payFraudAssessment.count()).toBe(0); });
    it('rollup by organisation / platform in json, CSV (BOM, Arabic headers) and PDF; finance only; branch level refused here', async () => {
      await intent({ status: 'CAPTURED', amountMinor: 10000, psp: 'paymob' }); await intent({ status: 'FAILED', amountMinor: 5000, psp: 'fawry' });
      const j = (await c.http().get(`${B}/reports/rollup?level=organisation`).set(fin).expect(200)).body; expect(j.lines[0]).toMatchObject({ key: 'cl_1', count: 2, capturedMinor: 10000, successRate: 0.5 });
      const csv = await c.http().get(`${B}/reports/rollup?level=psp&lang=ar&format=csv`).set(fin).expect(200); expect(csv.headers['content-type']).toContain('text/csv'); expect(csv.text).toContain('المجموعة');
      const pdf = await c.http().get(`${B}/reports/rollup?level=platform&format=pdf`).set(fin).buffer(true).parse((res, cb) => { const d: Buffer[] = []; res.on('data', (x: Buffer) => d.push(x)); res.on('end', () => cb(null, Buffer.concat(d))); }).expect(200);
      expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
      await c.http().get(`${B}/reports/rollup?level=branch`).set(fin).expect(400);
      await c.http().get(`${B}/reports/rollup`).set(ops).expect(403);
    });
  });
});
