import { CorporateBenefitService, CorporateJob } from '../src/growth/corporate-public';
import { memberHashOf } from '../src/growth/corporate/corporate-code';
import { GrowthMaintenanceService } from '../src/growth/maintenance/growth-maintenance.service';
import { createCtx, TestCtx } from './harness';
import { seedBooking } from './growth-helpers';

const FLAG = 'growth.corporate';
const ADM = '/api/v1/admin/growth/corporate';
const PAT = '/api/v1/growth/v1/corporate';
const DAY = 86_400_000;
let seq = 0;

/**
 * GRW-P4-C corporate partnerships and enterprise acquisition (Kiorex side), over the real HTTP stack and Postgres: account lifecycle with the two-person rule, codes, the three eligibility paths,
 * the HR list, the SEPARATE benefit ledger (ceiling, member cap, races, idempotency, append-only), the aggregate-only report (k >= 10), the lead pipeline, erasure and the flag OFF contract.
 * Mock providers only; the programme never touches patient credit or provider credit (asserted by row counts).
 */
describe('growth corporate programme (GRW-P4-C)', () => {
  let c: TestCtx; let a: { Authorization: string }; let b: { Authorization: string }; let ops: { Authorization: string }; let fin: { Authorization: string };
  const unlock = async () => { await c.prisma.flagGateEvidence.upsert({ where: { flagKey_gateId: { flagKey: FLAG, gateId: 'DEV-TEST-FIXTURE-NOT-A-REAL-GATE' } }, create: { flagKey: FLAG, gateId: 'DEV-TEST-FIXTURE-NOT-A-REAL-GATE', approver: 'test fixture', approvedOn: new Date(), documentUrl: 'https://dev.invalid/fixture', recordedBy: 'TEST_FIXTURE' }, update: {} }); c.flags.invalidate(); };
  const lock = async () => { await c.prisma.flagGateEvidence.deleteMany({ where: { flagKey: FLAG } }); c.flags.invalidate(); };
  const TERMS = { contractRef: 'CTR-TEST-001', sponsorCeilingMinor: 100_000, perMemberCapMinor: 30_000, perVisitMaxMinor: 20_000, coverBp: 5000, endsAt: new Date(Date.now() + 90 * DAY).toISOString(), emailDomains: ['acme.com'] };
  const mk = async (o: { terms?: Record<string, unknown>; name?: string; activate?: boolean } = {}) => {
    const acc = (await c.http().post(`${ADM}/accounts`).set(a).send({ displayName: o.name ?? `Acme ${++seq}` }).expect(201)).body;
    await c.http().put(`${ADM}/accounts/${acc.id}/terms`).set(a).send({ ...TERMS, ...(o.terms ?? {}) }).expect(200);
    if (o.activate !== false) await c.http().post(`${ADM}/accounts/${acc.id}/activate`).set(b).expect(200);
    return acc.id as string;
  };
  const code = async (accountId: string, o: Record<string, unknown> = {}) => (await c.http().post(`${ADM}/accounts/${accountId}/codes`).set(a).send({ label: 'HR campaign', maxRedemptions: 50, ...o }).expect(201)).body.code as string;
  const emp = (i: number, o: { email?: string; emailVerified?: boolean; phone?: string } = {}) => c.as(`emp_${i}`, { phone: o.phone ?? `+2010000${String(i).padStart(5, '0')}`, email: o.email, emailVerified: o.emailVerified });
  const join = (who: { Authorization: string }, codeText?: string) => c.http().post(`${PAT}/join`).set(who).send(codeText ? { code: codeText } : {});
  const booking = async (sub: string, deposit = 20_000) => { const bk = await seedBooking(c, { sub }); await c.prisma.bookingIntent.update({ where: { id: bk.id }, data: { depositAmountMinor: deposit } }); return bk.id; };
  const svc = () => c.get(CorporateBenefitService);
  const counts = async () => ({ lots: await c.prisma.rewardLot.count(), entries: await c.prisma.rewardLedgerEntry.count(), goodwill: await c.prisma.goodwillGrant.count(), sponsored: await c.prisma.bookingSponsoredDiscount.count() });

  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => {
    await c.reset(); c.flags.invalidate(); seq = 0;
    a = await c.as('adm_a', { roles: ['ops_admin', 'super_admin'] }); b = await c.as('adm_b', { roles: ['ops_admin', 'super_admin'] }); ops = await c.as('ops_1', { roles: ['ops_admin'] }); fin = await c.as('fin_1', { roles: ['ops_admin', 'finance'] });
    await unlock();
  });

  describe('account lifecycle and the two-person rule', () => {
    it('LEAD -> terms by one person -> activation by ANOTHER; incomplete terms, self activation and an edit while ACTIVE are refused; pause then edit then a second activation', async () => {
      const acc = (await c.http().post(`${ADM}/accounts`).set(a).send({ displayName: 'Nile Logistics' }).expect(201)).body;
      expect(acc).toMatchObject({ status: 'LEAD', terms: { complete: false, sponsorCeilingMinor: null, coverBp: null } }); // nothing invented: no price, no ceiling
      const inc = await c.http().post(`${ADM}/accounts/${acc.id}/activate`).set(b); expect(inc.status).toBe(422); expect(inc.body.code).toBe('CORPORATE_TERMS_INCOMPLETE'); expect(inc.body.missing).toEqual(expect.arrayContaining(['contractRef', 'sponsorCeilingMinor', 'perMemberCapMinor', 'coverBp', 'endsAt']));
      await c.http().put(`${ADM}/accounts/${acc.id}/terms`).set(a).send(TERMS).expect(200);
      const self = await c.http().post(`${ADM}/accounts/${acc.id}/activate`).set(a); expect(self.status).toBe(403); expect(self.body.code).toBe('CORPORATE_SELF_APPROVAL');
      expect((await c.http().post(`${ADM}/accounts/${acc.id}/activate`).set(b).expect(200)).body).toMatchObject({ status: 'ACTIVE', activatedBy: 'adm_b' });
      const frozen = await c.http().put(`${ADM}/accounts/${acc.id}/terms`).set(b).send({ coverBp: 9000 }); expect(frozen.status).toBe(409); expect(frozen.body.code).toBe('CORPORATE_TERMS_FROZEN');
      await c.http().post(`${ADM}/accounts/${acc.id}/pause`).set(a).expect(200);
      await c.http().put(`${ADM}/accounts/${acc.id}/terms`).set(b).send({ coverBp: 4000 }).expect(200);
      expect((await c.http().post(`${ADM}/accounts/${acc.id}/activate`).set(b)).status).toBe(403); // b edited last
      expect((await c.http().post(`${ADM}/accounts/${acc.id}/activate`).set(a).expect(200)).body.terms.coverBp).toBe(4000);
      expect((await c.prisma.auditLog.findMany({ where: { resourceId: acc.id, action: { startsWith: 'growth.corporate.' } } })).map((r) => r.action)).toEqual(expect.arrayContaining(['growth.corporate.account_created', 'growth.corporate.terms_edited', 'growth.corporate.activated', 'growth.corporate.paused']));
    });
    it('the database refuses an ACTIVE account without terms or with the editor as activator, whatever the service does', async () => {
      const id = (await c.http().post(`${ADM}/accounts`).set(a).send({ displayName: 'Raw Co' }).expect(201)).body.id;
      await expect(c.prisma.corporateAccount.update({ where: { id }, data: { status: 'ACTIVE', activatedBy: 'x' } })).rejects.toThrow(/active_check/);
      await c.prisma.corporateAccount.update({ where: { id }, data: { contractRef: 'C', sponsorCeilingMinor: 10, perMemberCapMinor: 5, coverBp: 100, termsEditedBy: 'same' } });
      await expect(c.prisma.corporateAccount.update({ where: { id }, data: { status: 'ACTIVE', activatedBy: 'same' } })).rejects.toThrow(/active_check/);
      await expect(c.prisma.corporateAccount.update({ where: { id }, data: { coverBp: 10001 } })).rejects.toThrow(/terms_check/);
    });
    it('validation: company data only (no personal contact), caps below the ceiling, dates in order, valid domains, integer money', async () => {
      await c.http().post(`${ADM}/accounts`).set(a).send({ displayName: 'sara@acme.com' }).expect(422);
      await c.http().post(`${ADM}/accounts`).set(a).send({ displayName: 'Acme', billingContactRef: '+201000000001' }).expect(422);
      const id = (await c.http().post(`${ADM}/accounts`).set(a).send({ displayName: 'Acme' }).expect(201)).body.id;
      for (const bad of [{ perMemberCapMinor: 200, sponsorCeilingMinor: 100 }, { sponsorCeilingMinor: 1.5 }, { sponsorCeilingMinor: -1 }, { coverBp: 0 }, { coverBp: 10001 }, { emailDomains: ['not a domain'] }, { startsAt: '2027-05-01', endsAt: '2027-04-01' }, { contractRef: 'sara@acme.com' }]) expect([400, 422]).toContain((await c.http().put(`${ADM}/accounts/${id}/terms`).set(a).send(bad)).status);
    });
    it('roles: ops_admin and finance read; only super_admin writes; patients are refused', async () => {
      const id = await mk({ activate: false });
      await c.http().get(`${ADM}/accounts`).set(ops).expect(200); await c.http().get(`${ADM}/accounts/${id}`).set(fin).expect(200);
      for (const who of [ops, fin]) { expect((await c.http().post(`${ADM}/accounts`).set(who).send({ displayName: 'X Co' })).status).toBe(403); expect((await c.http().put(`${ADM}/accounts/${id}/terms`).set(who).send({ coverBp: 1 })).status).toBe(403); expect((await c.http().post(`${ADM}/leads`).set(who).send({ companyName: 'X Co' })).status).toBe(403); }
      expect((await c.http().get(`${ADM}/accounts`).set(await c.as('sub_amira'))).status).toBe(403);
    });
    it('ending is final: members lose eligibility, codes are revoked, history stays, a join is refused', async () => {
      const id = await mk(); const cd = await code(id); const m = await emp(1); await join(m, cd).expect(200);
      await c.http().post(`${ADM}/accounts/${id}/end`).set(a).expect(200);
      expect((await c.prisma.corporateMember.findFirstOrThrow({ where: { accountId: id } })).endReason).toBe('ACCOUNT_ENDED');
      expect((await c.prisma.corporateCode.findFirstOrThrow({ where: { accountId: id } })).status).toBe('REVOKED');
      expect((await c.http().get(`${PAT}/me`).set(m).expect(200)).body.member).toBe(false);
      expect((await join(await emp(2), cd)).status).toBe(422);
      await c.http().post(`${ADM}/accounts/${id}/activate`).set(b).expect(409);
    });
  });

  describe('flag OFF contract (launch-locked growth.corporate)', () => {
    it('patient endpoints and money acts answer 403 FEATURE_DISABLED; reads, accounts in LEAD state and the lead pipeline keep working', async () => {
      const id = await mk(); const cd = await code(id); await lock();
      for (const r of [c.http().get(`${PAT}/me`).set(await emp(1)), c.http().post(`${PAT}/join`).set(await emp(1)).send({ code: cd }), c.http().post(`${PAT}/leave`).set(await emp(1)), c.http().get(`${PAT}/benefit/quote?bookingId=x`).set(await emp(1)),
        c.http().post(`${ADM}/accounts/${id}/codes`).set(a).send({ label: 'x', maxRedemptions: 1 }), c.http().post(`${ADM}/accounts/${id}/hr-lists`).set(a).send({ rows: ['+201000000009'] })]) { const res = await r; expect(res.status).toBe(403); expect(res.body.code).toBe('FEATURE_DISABLED'); }
      await c.http().get(`${ADM}/accounts`).set(ops).expect(200); await c.http().get(`${ADM}/accounts/${id}/report`).set(ops).expect(200); await c.http().get(`${ADM}/accounts/${id}/codes`).set(ops).expect(200);
      await c.http().post(`${ADM}/accounts`).set(a).send({ displayName: 'Prep Co' }).expect(201);
      await c.http().post(`${ADM}/leads`).set(a).send({ companyName: 'Prospect Co' }).expect(201);
      expect(await svc().reserve('emp_1', 'nope')).toBeNull(); // the port answers "nothing" and never throws
    });
  });

  describe('codes and joining', () => {
    it('the plain code is shown once; lists never carry the code or its hash; the stored value is a keyed hash', async () => {
      const id = await mk(); const created = (await c.http().post(`${ADM}/accounts/${id}/codes`).set(a).send({ label: 'Q1', maxRedemptions: 5 }).expect(201)).body;
      expect(created.shownOnce).toBe(true); expect(created.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
      const list = JSON.stringify((await c.http().get(`${ADM}/accounts/${id}/codes`).set(ops).expect(200)).body);
      expect(list).not.toContain(created.code); expect(list).not.toContain(created.code.replace('-', '')); expect(list).not.toMatch(/codeHash/);
      const row = await c.prisma.corporateCode.findFirstOrThrow({ where: { accountId: id } }); expect(row.codeHash).not.toContain(created.code.replace('-', '')); expect(row.codeHash.length).toBeGreaterThan(30);
    });
    it('joining with an open code makes a member that holds a keyed hash, not the sub; it is idempotent-safe: a second join, or another programme, is 409', async () => {
      const id = await mk(); const cd = await code(id); const other = await mk(); const cd2 = await code(other); const m = await emp(1);
      const ok = await join(m, cd.toLowerCase().replace('-', ' ')).expect(200); expect(ok.body).toMatchObject({ member: true, verifiedBy: 'CODE' });
      const row = await c.prisma.corporateMember.findFirstOrThrow({ where: { accountId: id } });
      expect(row.subHash).toBe(memberHashOf('emp_1')); expect(JSON.stringify(row)).not.toContain('emp_1');
      for (const x of [cd, cd2]) { const r = await join(m, x); expect(r.status).toBe(409); expect(r.body.code).toBe('CORPORATE_ALREADY_MEMBER'); }
      expect((await c.prisma.corporateCode.findFirstOrThrow({ where: { accountId: id } })).redeemedCount).toBe(1);
      expect((await c.prisma.outboxEvent.findMany({ where: { type: 'CorporateCodeRedeemed' } })).length).toBe(1);
      const ev = JSON.stringify((await c.prisma.outboxEvent.findFirstOrThrow({ where: { type: 'CorporateCodeRedeemed' } })).payload); expect(ev).not.toMatch(/emp_1|\+2010|sub|phone|email/i);
    });
    it('unknown, malformed, revoked, expired and exhausted codes: no oracle for an unknown code, specific reasons for a real one', async () => {
      const id = await mk(); const real = await code(id, { maxRedemptions: 1 });
      const unknown = await join(await emp(1), 'ZZZZZ-ZZZZZ'); const garbage = await join(await emp(1), '!!');
      expect(unknown.status).toBe(422); expect(unknown.body.code).toBe('CORPORATE_CODE_INVALID'); expect(garbage.body.code).toBe('CORPORATE_CODE_INVALID'); expect(unknown.body.message).toBe(garbage.body.message);
      await join(await emp(2), real).expect(200);
      expect((await join(await emp(3), real)).body.code).toBe('CORPORATE_CODE_EXHAUSTED');
      const exp = await code(id, { expiresAt: new Date(Date.now() - 1000).toISOString() }); expect((await join(await emp(4), exp)).body.code).toBe('CORPORATE_CODE_EXPIRED');
      const rev = await code(id); const cid = (await c.prisma.corporateCode.findMany({ where: { accountId: id }, orderBy: { createdAt: 'desc' }, take: 1 }))[0].id; await c.http().post(`${ADM}/accounts/${id}/codes/${cid}/revoke`).set(a).expect(200);
      expect((await join(await emp(5), rev)).body.code).toBe('CORPORATE_CODE_INVALID');
    });
    it('race: 12 people redeem a code with 5 places at once: exactly 5 join, the counter equals the members', async () => {
      const id = await mk(); const cd = await code(id, { maxRedemptions: 5 });
      const who = await Promise.all(Array.from({ length: 12 }, (_, i) => emp(100 + i)));
      const res = await Promise.all(who.map((w) => join(w, cd)));
      expect(res.filter((r) => r.status === 200)).toHaveLength(5); expect(res.filter((r) => r.status !== 200).every((r) => r.body.code === 'CORPORATE_CODE_EXHAUSTED')).toBe(true);
      expect(await c.prisma.corporateMember.count({ where: { accountId: id } })).toBe(5); expect((await c.prisma.corporateCode.findFirstOrThrow({ where: { accountId: id } })).redeemedCount).toBe(5);
    });
    it('the same person redeeming in parallel creates one membership', async () => {
      const id = await mk(); const cd = await code(id); const m = await emp(1);
      const res = await Promise.all([1, 2, 3, 4].map(() => join(m, cd)));
      expect(res.filter((r) => r.status === 200)).toHaveLength(1); expect(await c.prisma.corporateMember.count({ where: { accountId: id, endedAt: null } })).toBe(1);
    });
    it('leaving ends eligibility and keeps history; the person can join again', async () => {
      const id = await mk(); const cd = await code(id); const m = await emp(1); await join(m, cd).expect(200);
      expect((await c.http().post(`${PAT}/leave`).set(m).expect(200)).body.left).toBe(true);
      expect((await c.http().get(`${PAT}/me`).set(m).expect(200)).body.member).toBe(false);
      expect(await c.prisma.corporateMember.count({ where: { accountId: id } })).toBe(1);
      await join(m, cd).expect(200); expect(await c.prisma.corporateMember.count({ where: { accountId: id } })).toBe(2);
    });
    it('a paused or lead account cannot be joined', async () => {
      const id = await mk(); const cd = await code(id); await c.http().post(`${ADM}/accounts/${id}/pause`).set(a).expect(200);
      expect((await join(await emp(1), cd)).body.code).toBe('CORPORATE_ACCOUNT_NOT_ACTIVE');
    });
    it('rate limit: the 11th attempt of one person in an hour is 429', async () => {
      const m = await emp(1); let last = 0; for (let i = 0; i < 12; i++) last = (await join(m, 'ZZZZZ-ZZZZZ')).status;
      expect(last).toBe(429);
    });
  });

  describe('domain e-mail path (verified claim only)', () => {
    it('needs a verified e-mail on a listed domain: unverified is refused, a free-mail domain never counts, a verified work address joins', async () => {
      await mk();
      expect((await join(await emp(1, { email: 'sara@acme.com', emailVerified: false }))).body.code).toBe('CORPORATE_EMAIL_NOT_VERIFIED');
      expect((await join(await emp(2))).body.code).toBe('CORPORATE_EMAIL_NOT_VERIFIED');
      expect((await join(await emp(3, { email: 'sara@gmail.com', emailVerified: true }))).body.code).toBe('CORPORATE_NOT_ELIGIBLE');
      expect((await join(await emp(4, { email: 'sara@other.com', emailVerified: true }))).body.code).toBe('CORPORATE_NOT_ELIGIBLE');
      expect((await join(await emp(5, { email: 'Sara@ACME.com', emailVerified: true }))).body).toMatchObject({ member: true, verifiedBy: 'DOMAIN_EMAIL' });
      expect(JSON.stringify(await c.prisma.corporateMember.findMany())).not.toMatch(/acme|sara/i); // the address is not stored
    });
  });

  describe('HR list (two-person, keyed hashes, deleted after the window)', () => {
    it('upload, a second person approves, only a listed phone or e-mail joins with a LIST code, rows hold hashes only, the list shows counts only, rows are purged after the window', async () => {
      const id = await mk(); const cd = await code(id, { kind: 'LIST' });
      const up = (await c.http().post(`${ADM}/accounts/${id}/hr-lists`).set(a).send({ rows: ['+201000000101', ' 0100 000 0102 ', 'sara@acme.com', 'not-a-contact', '+201000000101'] }).expect(201)).body;
      expect(up).toMatchObject({ status: 'PENDING_APPROVAL', rowCount: 3, invalidRows: 1 });
      expect((await join(await emp(101, { phone: '+201000000101' }), cd)).body.code).toBe('CORPORATE_NOT_ELIGIBLE'); // not approved yet
      expect((await c.http().post(`${ADM}/hr-lists/${up.batchId}/decision`).set(a).send({ decision: 'APPROVED' })).status).toBe(403); // the uploader cannot approve
      const ok = (await c.http().post(`${ADM}/hr-lists/${up.batchId}/decision`).set(b).send({ decision: 'APPROVED' }).expect(200)).body; expect(ok.windowEndsAt).toBeTruthy();
      expect(JSON.stringify(await c.prisma.corporateHrEntry.findMany())).not.toMatch(/0100|20100|acme|sara/i);
      expect((await join(await emp(101, { phone: '+201000000101' }), cd)).body).toMatchObject({ member: true, verifiedBy: 'HR_LIST' });
      expect((await join(await emp(999, { phone: '+201000000999' }), cd)).body.code).toBe('CORPORATE_NOT_ELIGIBLE');
      expect((await join(await emp(103, { phone: '+201000000103', email: 'sara@acme.com', emailVerified: true }), cd)).body.verifiedBy).toBe('HR_LIST'); // matched by the verified e-mail
      expect((await c.prisma.corporateHrEntry.count({ where: { matchedAt: { not: null } } }))).toBe(2);
      const view = JSON.stringify((await c.http().get(`${ADM}/accounts/${id}/hr-lists`).set(ops).expect(200)).body); expect(view).toMatch(/rowCount/); expect(view).not.toMatch(/keyHash|0100|acme/);
      const r = await c.get(CorporateJob).runOnce(new Date(Date.now() + 31 * DAY));
      expect(r.hrBatchesPurged).toBe(1); expect(r.hrRowsPurged).toBe(3); expect(await c.prisma.corporateHrEntry.count()).toBe(0); expect((await c.prisma.corporateHrBatch.findFirstOrThrow()).status).toBe('PURGED');
    });
    it('a rejected list is purged at once; a list can be rejected by the second person; limits and an empty list are refused', async () => {
      const id = await mk();
      const up = (await c.http().post(`${ADM}/accounts/${id}/hr-lists`).set(a).send({ rows: ['+201000000201'] }).expect(201)).body;
      await c.http().post(`${ADM}/hr-lists/${up.batchId}/decision`).set(b).send({ decision: 'REJECTED' }).expect(200);
      await c.http().post(`${ADM}/hr-lists/${up.batchId}/decision`).set(b).send({ decision: 'APPROVED' }).expect(409);
      await c.get(CorporateJob).runOnce(); expect(await c.prisma.corporateHrEntry.count()).toBe(0);
      expect((await c.http().post(`${ADM}/accounts/${id}/hr-lists`).set(a).send({ rows: ['x', 'y'] })).status).toBe(422);
      expect((await c.http().post(`${ADM}/accounts/${id}/hr-lists`).set(a).send({ rows: [] })).status).toBe(400);
    });
  });

  describe('the benefit ledger (its own ledger; ceiling, cap, races, idempotency)', () => {
    it('quote sizes the benefit from the deposit; reserve is idempotent; redeem and reverse settle; every step nets and reconciles; patient credit is untouched', async () => {
      const id = await mk(); const m = await emp(1); await join(m, await code(id)).expect(200); const before = await counts();
      const bk = await booking('emp_1', 20_000);
      const q = (await c.http().get(`${PAT}/benefit/quote?bookingId=${bk}`).set(m).expect(200)).body.quote; expect(q).toMatchObject({ amountMinor: 10_000, currency: 'EGP' }); expect(JSON.stringify(q)).not.toMatch(/balance|wallet|credit/i);
      const r1 = await svc().reserve('emp_1', bk); const r2 = await svc().reserve('emp_1', bk);
      expect(r1).toMatchObject({ amountMinor: 10_000 }); expect(r2?.reservationRef).toBe(r1?.reservationRef);
      expect(await c.prisma.corporateBenefitEntry.count({ where: { bookingId: bk, type: 'RESERVE' } })).toBe(1);
      expect(await svc().redeem(bk)).toBe(10_000); expect(await svc().redeem(bk)).toBe(0); expect(await svc().release(bk)).toBe(0);
      expect(await svc().reverse(bk, 4_000)).toBe(4_000); expect(await svc().reverse(bk)).toBe(6_000); expect(await svc().reverse(bk)).toBe(0);
      expect(await svc().reconcile()).toEqual([]);
      const u = await svc().use(c.prisma, { accountId: id }); expect(u).toMatchObject({ reserved: 10_000, redeemed: 10_000, reversed: 10_000, used: 0, held: 0, net: 0 });
      expect(await counts()).toEqual(before); // no RewardLot, RewardLedgerEntry, GoodwillGrant or sponsored line was written
    });
    it('release returns the hold to the ceiling and the cap; a new reservation on the same booking is allowed after a release', async () => {
      const id = await mk({ terms: { perMemberCapMinor: 10_000 } }); const m = await emp(1); await join(m, await code(id)).expect(200);
      const bk = await booking('emp_1'); expect((await svc().reserve('emp_1', bk))?.amountMinor).toBe(10_000);
      const bk2 = await booking('emp_1'); expect(await svc().reserve('emp_1', bk2)).toBeNull(); // the member cap is used up by the hold
      expect(await svc().release(bk, 'PAYMENT_FAILED')).toBe(10_000);
      expect((await svc().reserve('emp_1', bk2))?.amountMinor).toBe(10_000);
      expect((await svc().reserve('emp_1', bk))).toBeNull(); // the cap is used by bk2 now
      expect(await svc().reconcile()).toEqual([]);
    });
    it('per-member cap: three bookings use 10k, 10k and then only the remaining 10k of a 30k cap with a 20k per-visit bound', async () => {
      const id = await mk({ terms: { perMemberCapMinor: 25_000, perVisitMaxMinor: 20_000, coverBp: 10_000, sponsorCeilingMinor: 1_000_000 } }); const m = await emp(1); await join(m, await code(id)).expect(200);
      const got: number[] = []; for (let i = 0; i < 4; i++) { const bk = await booking('emp_1', 20_000); const r = await svc().reserve('emp_1', bk); got.push(r?.amountMinor ?? 0); if (r) await svc().redeem(bk); }
      expect(got).toEqual([19_999, 5_001, 0, 0]); // the card always keeps one minor unit; then only what is left of the cap
    });
    it('ceiling race: 8 members reserve at once against a ceiling that fits only a part: the total never exceeds it and every refusal is clean', async () => {
      const id = await mk({ terms: { sponsorCeilingMinor: 35_000, perMemberCapMinor: 30_000 } }); const cd = await code(id);
      for (let i = 1; i <= 8; i++) await join(await emp(i), cd).expect(200);
      const bks = await Promise.all(Array.from({ length: 8 }, (_, i) => booking(`emp_${i + 1}`)));
      const res = await Promise.all(bks.map((bk, i) => svc().reserve(`emp_${i + 1}`, bk)));
      const total = res.reduce((s, r) => s + (r?.amountMinor ?? 0), 0);
      expect(total).toBeLessThanOrEqual(35_000); expect(total).toBeGreaterThanOrEqual(30_000); // 10k each: three fit fully, a fourth gets the remaining 5k
      expect((await svc().use(c.prisma, { accountId: id })).used).toBe(total); expect(await svc().reconcile()).toEqual([]);
    });
    it('the database itself refuses overspend, a second reservation on a booking, over-release, over-redeem and over-reverse, and any update or delete', async () => {
      const id = await mk({ terms: { sponsorCeilingMinor: 10_000, perMemberCapMinor: 10_000 } }); await join(await emp(1), await code(id)).expect(200);
      const mem = await c.prisma.corporateMember.findFirstOrThrow({ where: { accountId: id } });
      const e = (type: string, amountMinor: number, bookingId: string, k = `k${++seq}`) => c.prisma.corporateBenefitEntry.create({ data: { accountId: id, memberId: mem.id, type, amountMinor, bookingId, idempotencyKey: k, reasonCode: 'T', actor: 'test' } });
      await expect(e('RESERVE', 10_001, 'bkA')).rejects.toThrow(/CORPORATE_CEILING_EXCEEDED/);
      await expect(e('RESERVE', 0, 'bkA')).rejects.toThrow(/amount_check/);
      const r = await e('RESERVE', 6_000, 'bkA');
      await expect(e('RESERVE', 1_000, 'bkA')).rejects.toThrow(/CORPORATE_ALREADY_RESERVED/);
      await expect(e('RESERVE', 5_000, 'bkB')).rejects.toThrow(/CORPORATE_CEILING_EXCEEDED/);
      await expect(e('RELEASE', 6_001, 'bkA')).rejects.toThrow(/CORPORATE_NOTHING_HELD/);
      await expect(e('REDEEM', 7_000, 'bkA')).rejects.toThrow(/CORPORATE_NOTHING_HELD/);
      await expect(e('REVERSE', 1, 'bkA')).rejects.toThrow(/CORPORATE_NOTHING_REDEEMED/);
      await e('REDEEM', 6_000, 'bkA'); await expect(e('REVERSE', 6_001, 'bkA')).rejects.toThrow(/CORPORATE_NOTHING_REDEEMED/);
      await expect(c.prisma.corporateBenefitEntry.create({ data: { accountId: id, memberId: mem.id, type: 'RESERVE', amountMinor: 1, bookingId: 'bkC', idempotencyKey: r.idempotencyKey, reasonCode: 'T', actor: 't' } })).rejects.toThrow(/Unique constraint/);
      await expect(c.prisma.corporateBenefitEntry.update({ where: { id: r.id }, data: { amountMinor: 1 } })).rejects.toThrow(/append-only/);
      await expect(c.prisma.corporateBenefitEntry.delete({ where: { id: r.id } })).rejects.toThrow(/append-only/);
      await expect(c.prisma.$transaction(async (tx) => { await tx.$executeRawUnsafe(`SELECT set_config('kx.growth_maintenance','on',true)`); await tx.$executeRawUnsafe(`DELETE FROM "CorporateBenefitEntry"`); })).rejects.toThrow(/append-only/);
    });
    it('nothing applies: not a member, a dependant booking, no deposit, a booking that is not mine, an ended window, an account without a ceiling', async () => {
      const id = await mk(); const cd = await code(id); const stranger = await emp(9);
      const bk9 = await booking('emp_9'); expect((await c.http().get(`${PAT}/benefit/quote?bookingId=${bk9}`).set(stranger).expect(200)).body.quote).toBeNull();
      await join(await emp(1), cd).expect(200); const m = await emp(1);
      const noDep = await booking('emp_1', 0); expect((await c.http().get(`${PAT}/benefit/quote?bookingId=${noDep}`).set(m).expect(200)).body.quote).toBeNull();
      const dep = await booking('emp_1'); await c.prisma.bookingIntent.update({ where: { id: dep }, data: { dependantId: 'dep_1' } }); expect((await c.http().get(`${PAT}/benefit/quote?bookingId=${dep}`).set(m).expect(200)).body.quote).toBeNull();
      const bk = await booking('emp_1'); expect((await c.http().get(`${PAT}/benefit/quote?bookingId=${bk}`).set(await emp(2)).expect(404)).body.code).toBe('BOOKING_NOT_FOUND');
      await c.prisma.corporateAccount.update({ where: { id }, data: { endsAt: new Date(Date.now() - 1000) } });
      expect((await c.http().get(`${PAT}/benefit/quote?bookingId=${bk}`).set(m).expect(200)).body.quote).toBeNull(); // the benefit expires with the contract
    });
    it('the housekeeping job releases holds of bookings that died, ends members of ended accounts and reports a clean ledger', async () => {
      const id = await mk(); await join(await emp(1), await code(id)).expect(200);
      const bk = await booking('emp_1'); await svc().reserve('emp_1', bk);
      await c.prisma.bookingIntent.update({ where: { id: bk }, data: { status: 'CANCELLED' } });
      await c.prisma.corporateAccount.update({ where: { id }, data: { endsAt: new Date(Date.now() - 3600_000) } });
      const r = await c.get(CorporateJob).runOnce(new Date(Date.now() + 3600_000));
      expect(r).toMatchObject({ endedMembers: 1, releasedHolds: 1, problems: [] }); expect((await svc().use(c.prisma, { accountId: id })).used).toBe(0);
    });
  });

  describe('the aggregate report (k >= 10), privacy and erasure', () => {
    it('30 synthetic members redeem and use sponsored benefit: the report is aggregate only and the money adds up', async () => {
      const id = await mk({ terms: { sponsorCeilingMinor: 1_000_000, perMemberCapMinor: 30_000 } }); const cd = await code(id, { maxRedemptions: 100 });
      for (let i = 1; i <= 30; i++) { await join(await emp(i), cd).expect(200); const bk = await booking(`emp_${i}`); expect((await svc().reserve(`emp_${i}`, bk))?.amountMinor).toBe(10_000); await svc().redeem(bk); }
      const rep = (await c.http().get(`${ADM}/accounts/${id}/report`).set(ops).expect(200)).body;
      expect(rep.enrolment).toMatchObject({ enrolled: 30, active: 30, byVerification: { CODE: 30, HR_LIST: 0, DOMAIN_EMAIL: 0 } });
      expect(rep.utilisation).toMatchObject({ membersWhoUsedBenefit: 30, sponsoredVisits: 30, sponsoredValueMinor: 300_000 });
      expect(rep.suppressed).toEqual([]);
      const text = JSON.stringify(rep); for (const forbidden of ['emp_', 'bookingId', 'kx_bk', 'subHash', 'provider', 'specialty', 'clinic', 'doctor', 'phone', 'email']) expect(text).not.toContain(forbidden);
      expect(await svc().reconcile()).toEqual([]);
      // employer export: ops (finance or super admin) issues a CSV or PDF of exactly this masked report; support cannot; every export is an audit row without figures
      const csv = await c.http().get(`${ADM}/accounts/${id}/report/export?format=csv`).set(fin).expect(200);
      expect(csv.headers['content-type']).toContain('text/csv'); expect(csv.headers['content-disposition']).toMatch(/attachment; filename="employer-benefit-report-\d{4}-\d{2}-\d{2}\.csv"/); expect(csv.headers['cache-control']).toBe('no-store');
      expect(csv.text).toContain('Members enrolled,30'); expect(csv.text).toContain('Sponsored value,3000.00 EGP');
      for (const forbidden of ['emp_', 'kx_bk', 'subHash', 'provider', 'specialty', 'clinic', 'doctor']) expect(csv.text).not.toContain(forbidden);
      const pdf = await c.http().get(`${ADM}/accounts/${id}/report/export?format=pdf`).set(fin).buffer(true).parse((r, cb) => { const ch: Buffer[] = []; r.on('data', (d: Buffer) => ch.push(d)); r.on('end', () => cb(null, Buffer.concat(ch))); }).expect(200);
      expect(pdf.headers['content-type']).toBe('application/pdf'); expect((pdf.body as Buffer).subarray(0, 8).toString()).toBe('%PDF-1.4');
      expect((await c.http().get(`${ADM}/accounts/${id}/report/export`).set(ops)).status).toBe(403); // ops_admin without the finance capability
      expect(await c.prisma.auditLog.count({ where: { action: 'growth.corporate.report_exported', resourceId: id } })).toBe(2);
      expect(JSON.stringify(await c.prisma.auditLog.findMany({ where: { action: 'growth.corporate.report_exported' } }))).not.toMatch(/300000|Members enrolled/);
      const st = (await c.http().get(`${ADM}/accounts/${id}/statement?month=${new Date().toISOString().slice(0, 7)}`).set(fin).expect(200)).body; expect(st.sponsorSpendMinor).toBe(300_000);
      expect((await c.http().get(`${ADM}/accounts/${id}/statement`).set(ops)).status).toBe(403); // finance only
      const note = (await c.http().post(`${ADM}/accounts/${id}/invoice-notes`).set(a).send({ month: new Date().toISOString().slice(0, 7), notes: 'PO 4471, sent to finance' }).expect(201)).body; expect(note.sponsorSpendMinor).toBe(300_000);
      await c.http().post(`${ADM}/accounts/${id}/invoice-notes`).set(a).send({ month: new Date().toISOString().slice(0, 7) }).expect(409);
      await c.http().post(`${ADM}/accounts/${id}/invoice-notes`).set(a).send({ month: '2027-02', notes: 'call 01000000001' }).expect(400);
    });
    it('below k every cell is masked, including the money and the breakdown: 9 members reveal nothing, and a single hidden cell hides its sibling', async () => {
      const id = await mk(); const cd = await code(id);
      for (let i = 1; i <= 9; i++) { await join(await emp(i), cd).expect(200); const bk = await booking(`emp_${i}`); await svc().reserve(`emp_${i}`, bk); await svc().redeem(bk); }
      const rep = (await c.http().get(`${ADM}/accounts/${id}/report`).set(ops).expect(200)).body;
      expect(rep.enrolment.enrolled).toBeNull(); expect(rep.enrolment.active).toBeNull(); expect(rep.enrolment.byVerification.CODE).toBeNull();
      expect(rep.utilisation).toEqual({ membersWhoUsedBenefit: null, sponsoredVisits: null, sponsoredValueMinor: null });
      expect(rep.byMonth.every((m: any) => m.membersWhoUsedBenefit === null && m.sponsoredValueMinor === null)).toBe(true);
      expect(rep.suppressed.length).toBeGreaterThan(4);
      const masked = (await c.http().get(`${ADM}/accounts/${id}/report/export?format=csv`).set(fin).expect(200)).text; // the export masks exactly like the report
      expect(masked).toContain('Members enrolled,<10'); expect(masked).toContain('Sponsored value,<10'); expect(masked).not.toMatch(/Members enrolled,9|Sponsored value,\d/);
      await join(await emp(10), cd).expect(200); // now 10 members, 9 used the benefit
      const rep2 = (await c.http().get(`${ADM}/accounts/${id}/report`).set(ops).expect(200)).body; expect(rep2.enrolment.enrolled).toBe(10); expect(rep2.utilisation.membersWhoUsedBenefit).toBeNull();
    });
    it('privacy: no corporate endpoint returns a person, a booking or a provider; `me` shows only my own allowance', async () => {
      const id = await mk(); const cd = await code(id); const m = await emp(1); await join(m, cd).expect(200); const bk = await booking('emp_1'); await svc().reserve('emp_1', bk);
      const me = (await c.http().get(`${PAT}/me`).set(m).expect(200)).body; expect(me).toMatchObject({ member: true, allowance: { capMinor: 30_000, heldMinor: 10_000, usedMinor: 0, remainingMinor: 20_000 } });
      const all = JSON.stringify([me, (await c.http().get(`${ADM}/accounts/${id}`).set(ops)).body, (await c.http().get(`${ADM}/accounts`).set(ops)).body, (await c.http().get(`${ADM}/accounts/${id}/codes`).set(ops)).body, (await c.http().get(`${ADM}/accounts/${id}/report`).set(ops)).body, (await c.http().get(`${ADM}/accounts/${id}/hr-lists`).set(ops)).body]);
      for (const f of ['emp_1', bk, 'subHash', 'codeHash', 'keyHash', 'bookingId', 'providerId', 'tenantId']) expect(all).not.toContain(f);
      expect((await c.http().get(`${PAT}/members`).set(m)).status).toBe(404); expect((await c.http().get(`${ADM}/accounts/${id}/members`).set(a)).status).toBe(404); // no member list exists
    });
    it('erasure: the member row loses the person, the ledger and the counts stay, and the person cannot be matched afterwards', async () => {
      const id = await mk(); const m = await emp(1); await join(m, await code(id)).expect(200); const bk = await booking('emp_1'); await svc().reserve('emp_1', bk); await svc().redeem(bk);
      const r = await c.get(GrowthMaintenanceService).eraseSubject('emp_1'); expect(Number(r.corporateMembersAnonymised)).toBe(1);
      const row = await c.prisma.corporateMember.findFirstOrThrow({ where: { accountId: id } }); expect(row.subHash).toMatch(/^erased:/); expect(row.endedAt).toBeTruthy(); expect(row.endReason).toBe('ERASED');
      expect((await svc().use(c.prisma, { accountId: id })).net).toBe(10_000); expect(await c.prisma.corporateBenefitEntry.count()).toBe(2);
      expect(await svc().activeMembership('emp_1')).toBeNull();
    });
  });

  describe('enterprise lead pipeline and the Clinic B2B referral', () => {
    const referral = (o: Record<string, unknown> = {}) => ({ referralId: `b2b_${++seq}`, orgRef: 'tn_1', clinicId: 'cl_1', companyName: 'Nile Logistics', sizeBucket: '200_999', contactRef: 'ref-hr-1', referredAt: new Date().toISOString(), ...o });
    const push = (d: Record<string, unknown>) => c.webhook('CorporateLeadReferred', d, { aggregateId: String(d.referralId), eventId: `evt_${++seq}_${Math.random().toString(36).slice(2)}`, aggregateType: 'ProviderB2BReferral' });
    it('a provider referral becomes a lead (idempotent per referral), works with the flag OFF, carries no personal data and creates no reward', async () => {
      await lock(); const before = await counts(); const d = referral();
      expect((await push(d)).body.status).toBe('APPLIED'); expect((await push(d)).body.status).toBe('APPLIED'); // a re-delivery with a new event id
      const list = (await c.http().get(`${ADM}/leads`).set(ops).expect(200)).body; expect(list.items).toHaveLength(1);
      expect(list.items[0]).toMatchObject({ source: 'B2B_REFERRAL', status: 'NEW', companyName: 'Nile Logistics', sizeBucket: '200_999', referrerOrgRef: 'tn_1', contactRef: 'ref-hr-1' }); expect(list.pipeline).toEqual({ NEW: 1 });
      expect(await counts()).toEqual(before);
      expect((await push(referral({ companyName: 'sara@acme.com' }))).body.status).toBe('IGNORED'); expect((await push(referral({ companyName: 'x' }))).body.status).toBe('IGNORED'); expect((await push({ ...referral(), referralId: '' })).body.status).toBe('IGNORED');
      const odd = (await push(referral({ contactRef: '+201000000001', sizeBucket: 'HUGE' }))).body; expect(odd.status).toBe('APPLIED');
      const stored = (await c.http().get(`${ADM}/leads?take=10`).set(ops)).body.items.find((x: any) => x.sizeBucket === 'UNKNOWN'); expect(stored.contactRef).toBeNull();
    });
    it('a second open lead for the same company is marked DUPLICATE; the pipeline moves only along allowed steps with an append-only history; notes cannot hold a person', async () => {
      await push(referral()); await push(referral({ companyName: ' nile  logistics ' }));
      const items = (await c.http().get(`${ADM}/leads`).set(ops)).body.items; expect(items.map((x: any) => x.status).sort()).toEqual(['DUPLICATE', 'NEW']);
      const lead = items.find((x: any) => x.status === 'NEW');
      expect((await c.http().post(`${ADM}/leads/${lead.id}/transition`).set(a).send({ status: 'WON' })).status).toBe(409);
      for (const s of ['CONTACTED', 'QUALIFIED', 'PROPOSAL', 'WON']) await c.http().post(`${ADM}/leads/${lead.id}/transition`).set(a).send({ status: s, note: `step ${s}` }).expect(200);
      expect((await c.http().post(`${ADM}/leads/${lead.id}/transition`).set(a).send({ status: 'LOST' })).status).toBe(409);
      const full = (await c.http().get(`${ADM}/leads/${lead.id}`).set(ops).expect(200)).body; expect(full.history.map((h: any) => h.to)).toEqual(['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'WON']); expect(full.ownerSub).toBe('adm_a');
      await expect(c.prisma.corporateLeadHistory.update({ where: { id: (await c.prisma.corporateLeadHistory.findFirstOrThrow()).id }, data: { note: 'x' } })).rejects.toThrow(/append-only/);
      expect((await c.http().put(`${ADM}/leads/${lead.id}/notes`).set(a).send({ notes: 'ask Sara 01000000001' })).status).toBe(422);
      await c.http().put(`${ADM}/leads/${lead.id}/notes`).set(a).send({ notes: 'Renewal in Q3, 200 staff' }).expect(200);
      expect((await c.http().post(`${ADM}/leads/${lead.id}/assign`).set(a).send({ ownerSub: 'adm_b' }).expect(200)).body.ownerSub).toBe('adm_b');
      expect((await c.http().post(`${ADM}/leads`).set(a).send({ companyName: 'Prospect Co', source: 'INBOUND', contactRef: 'a@b.com' })).status).toBe(422);
      expect((await c.http().post(`${ADM}/leads`).set(a).send({ companyName: 'Prospect Co', source: 'INBOUND', sizeBucket: '50_199' }).expect(201)).body).toMatchObject({ source: 'INBOUND', status: 'NEW' });
    });
    it('an account can be opened from a lead and the lead remembers it', async () => {
      await push(referral()); const lead = (await c.http().get(`${ADM}/leads`).set(ops)).body.items[0];
      const acc = (await c.http().post(`${ADM}/accounts`).set(a).send({ displayName: 'Nile Logistics', leadId: lead.id }).expect(201)).body;
      expect((await c.http().get(`${ADM}/leads/${lead.id}`).set(ops)).body.accountId).toBe(acc.id);
      expect((await c.prisma.outboxEvent.findMany({ where: { type: 'CorporateAccountCreated' } })).length).toBe(1);
    });
  });
});
