import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { createCtx, TestCtx } from './harness';
import { testDatabaseUrl } from './db-url';

/**
 * GRW-P4 wave 8 schema, corporate part (migration 20270128093000_growth_p4_corporate, owner lane A4). Real Postgres: the tables, the CHECK rules, the one-active-membership index, the ledger guard and
 * append-only triggers, the erase and purge functions, no foreign key into any credit table, no balance column, and idempotent replay of the migration.
 */
describe('growth Phase 4 schema, corporate (wave 8)', () => {
  let c: TestCtx;
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => { await c.reset(); });
  const rejects = (p: Promise<unknown>, re: RegExp) => expect(p).rejects.toThrow(re);
  let seq = 0; const u = () => `${Date.now().toString(36)}${(++seq).toString(36)}`;
  const acct = (o: Record<string, unknown> = {}) => c.prisma.corporateAccount.create({ data: { displayName: `Co ${u()}`, createdBy: 'a', ...o } as never });

  it('every corporate table exists', async () => {
    const t = (await c.prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = current_schema()`).map((r) => r.tablename);
    for (const n of ['CorporateAccount', 'CorporateCode', 'CorporateMember', 'CorporateBenefitEntry', 'CorporateHrBatch', 'CorporateHrEntry', 'CorporateLead', 'CorporateLeadHistory', 'CorporateInvoiceNote']) expect(t).toContain(n);
  });

  it('no corporate table has a foreign key into a patient credit, reward, promotion or Clinic table, and no column is a balance', async () => {
    const fks = await c.prisma.$queryRaw<{ t: string; ref: string }[]>`SELECT conrelid::regclass::text AS t, confrelid::regclass::text AS ref FROM pg_constraint WHERE contype = 'f' AND conrelid::regclass::text LIKE '"Corporate%'`;
    expect(fks.length).toBeGreaterThan(5);
    for (const f of fks) expect(f.ref).toMatch(/^"?Corporate/);
    const cols = (await c.prisma.$queryRaw<{ column_name: string; table_name: string }[]>`SELECT table_name, column_name FROM information_schema.columns WHERE table_name LIKE 'Corporate%' AND table_schema = current_schema()`);
    expect(cols.filter((x) => /balance|wallet|available|storedvalue|remaining/i.test(x.column_name))).toEqual([]);
  });

  it('account CHECKs: status, funding, non-negative terms, cover share range, activation needs a contract, a ceiling, a cap, a share and a second person', async () => {
    await rejects(acct({ status: 'LIVE' }), /status_check/);
    await rejects(acct({ fundingMode: 'WALLET' }), /funding_check/);
    await rejects(acct({ sponsorCeilingMinor: -1 }), /terms_check/);
    await rejects(acct({ coverBp: 0 }), /terms_check/);
    await rejects(acct({ status: 'ACTIVE', activatedBy: 'b' }), /active_check/);
    await rejects(acct({ status: 'ACTIVE', activatedBy: 'b', contractRef: 'C', sponsorCeilingMinor: 1, perMemberCapMinor: 1, coverBp: 1, termsEditedBy: 'b' }), /active_check/);
    await acct({ status: 'ACTIVE', activatedBy: 'b', contractRef: 'C', sponsorCeilingMinor: 1, perMemberCapMinor: 1, coverBp: 1, termsEditedBy: 'a' });
  });

  it('codes: unique hash, kind and status vocabulary, the counter cannot pass the limit', async () => {
    const a = await acct();
    const code = (o: Record<string, unknown> = {}) => c.prisma.corporateCode.create({ data: { accountId: a.id, codeHash: `h${u()}`, label: 'l', maxRedemptions: 2, createdBy: 'a', ...o } as never });
    const first = await code(); await rejects(code({ codeHash: first.codeHash }), /Unique constraint/);
    await rejects(code({ kind: 'WALLET' }), /kind_check/); await rejects(code({ status: 'GONE' }), /status_check/); await rejects(code({ maxRedemptions: 0 }), /counts_check/); await rejects(code({ redeemedCount: 3 }), /counts_check/);
  });

  it('one ACTIVE membership per person across all programmes; an ended one frees the person; the vocabulary is enforced', async () => {
    const a = await acct(); const b = await acct();
    const m = (accountId: string, o: Record<string, unknown> = {}) => c.prisma.corporateMember.create({ data: { accountId, subHash: 'hash1', verifiedBy: 'CODE', ...o } as never });
    const first = await m(a.id); await rejects(m(b.id), /one_active_per_person|Unique constraint/); await rejects(m(a.id), /one_active_per_person|Unique constraint/);
    await rejects(m(b.id, { subHash: 'other', verifiedBy: 'GUESS' }), /verified_check/);
    await c.prisma.corporateMember.update({ where: { id: first.id }, data: { endedAt: new Date(), endReason: 'LEFT' } });
    await m(b.id); expect(await c.prisma.corporateMember.count()).toBe(2);
  });

  it('the ledger guard is installed on the table (insert and update/delete triggers) and the type and amount are constrained', async () => {
    const trg = (await c.prisma.$queryRaw<{ tgname: string }[]>`SELECT tgname FROM pg_trigger WHERE tgrelid = '"CorporateBenefitEntry"'::regclass AND NOT tgisinternal`).map((r) => r.tgname);
    expect(trg).toEqual(expect.arrayContaining(['corporate_benefit_guard_ins', 'corporate_benefit_immutable']));
    const a = await acct({ sponsorCeilingMinor: 100, perMemberCapMinor: 100 }); const m = await c.prisma.corporateMember.create({ data: { accountId: a.id, subHash: 'h', verifiedBy: 'CODE' } });
    const e = (o: Record<string, unknown>) => c.prisma.corporateBenefitEntry.create({ data: { accountId: a.id, memberId: m.id, bookingId: 'b1', idempotencyKey: `k${u()}`, reasonCode: 'T', actor: 't', type: 'RESERVE', amountMinor: 1, ...o } as never });
    await rejects(e({ type: 'TOPUP' }), /type_check/); await rejects(e({ type: 'TRANSFER' }), /type_check/); await rejects(e({ amountMinor: -5 }), /amount_check/);
    await rejects(c.prisma.corporateBenefitEntry.create({ data: { accountId: a.id, memberId: 'nope', bookingId: 'b1', idempotencyKey: `k${u()}`, reasonCode: 'T', actor: 't', type: 'RESERVE', amountMinor: 1 } }), /CORPORATE_MEMBER_MISMATCH/);
    const other = await acct({ sponsorCeilingMinor: 100, perMemberCapMinor: 100 }); const om = await c.prisma.corporateMember.create({ data: { accountId: other.id, subHash: 'h2', verifiedBy: 'CODE' } });
    await rejects(c.prisma.corporateBenefitEntry.create({ data: { accountId: a.id, memberId: om.id, bookingId: 'b2', idempotencyKey: `k${u()}`, reasonCode: 'T', actor: 't', type: 'RESERVE', amountMinor: 1 } }), /CORPORATE_MEMBER_MISMATCH/);
    await rejects(c.prisma.corporateAccount.update({ where: { id: a.id }, data: { sponsorCeilingMinor: null } }).then(() => e({ bookingId: 'b3' })), /CORPORATE_TERMS_INCOMPLETE/);
  });

  it('HR lists: the approver cannot be the uploader; entries cascade with their batch; one row per hash per batch', async () => {
    const a = await acct();
    await rejects(c.prisma.corporateHrBatch.create({ data: { accountId: a.id, rowCount: 1, uploadedBy: 'x', approvedBy: 'x' } }), /two_person_check/);
    await rejects(c.prisma.corporateHrBatch.create({ data: { accountId: a.id, rowCount: 1, uploadedBy: 'x', status: 'DONE' } }), /status_check/);
    const b = await c.prisma.corporateHrBatch.create({ data: { accountId: a.id, rowCount: 1, uploadedBy: 'x' } });
    await c.prisma.corporateHrEntry.create({ data: { batchId: b.id, keyHash: 'k' } }); await rejects(c.prisma.corporateHrEntry.create({ data: { batchId: b.id, keyHash: 'k' } }), /Unique constraint/);
    await c.prisma.corporateHrBatch.delete({ where: { id: b.id } }); expect(await c.prisma.corporateHrEntry.count()).toBe(0);
  });

  it('leads: source and status vocabulary, one lead per Clinic referral, history is append-only, invoice month format', async () => {
    const l = (o: Record<string, unknown> = {}) => c.prisma.corporateLead.create({ data: { source: 'OUTBOUND', companyName: 'Co', ...o } as never });
    await rejects(l({ source: 'MAGIC' }), /source_check/); await rejects(l({ status: 'DONE' }), /status_check/);
    const x = await l({ referralRef: 'r1' }); await rejects(l({ referralRef: 'r1' }), /Unique constraint/);
    const h = await c.prisma.corporateLeadHistory.create({ data: { leadId: x.id, toStatus: 'NEW', actor: 'a' } });
    await rejects(c.prisma.corporateLeadHistory.update({ where: { id: h.id }, data: { note: 'n' } }), /append-only/); await rejects(c.prisma.corporateLeadHistory.delete({ where: { id: h.id } }), /append-only/);
    const a = await acct(); await rejects(c.prisma.corporateInvoiceNote.create({ data: { accountId: a.id, month: '2027-13', sponsorSpendMinor: 1, createdBy: 'a' } }), /month_check/);
    await c.prisma.corporateInvoiceNote.create({ data: { accountId: a.id, month: '2027-02', sponsorSpendMinor: 1, createdBy: 'a' } }); await rejects(c.prisma.corporateInvoiceNote.create({ data: { accountId: a.id, month: '2027-02', sponsorSpendMinor: 2, createdBy: 'a' } }), /Unique constraint/);
  });

  it('growth_erase_corporate anonymises exactly the member with that hash; growth_purge_corporate deletes expired HR rows and old ledger rows of ended accounts only', async () => {
    const a = await acct({ sponsorCeilingMinor: 1000, perMemberCapMinor: 1000 });
    const m1 = await c.prisma.corporateMember.create({ data: { accountId: a.id, subHash: 'person1', verifiedBy: 'CODE' } }); await c.prisma.corporateMember.create({ data: { accountId: a.id, subHash: 'person2', verifiedBy: 'CODE' } });
    expect((await c.prisma.$queryRaw<{ r: { corporateMembersAnonymised: number } }[]>`SELECT growth_erase_corporate('person1') AS r`)[0].r.corporateMembersAnonymised).toBe(1);
    expect((await c.prisma.corporateMember.findUniqueOrThrow({ where: { id: m1.id } })).subHash).toBe(`erased:${m1.id}`);
    expect((await c.prisma.corporateMember.findMany({ where: { endedAt: null } })).map((x) => x.subHash)).toEqual(['person2']);
    await rejects(c.prisma.$queryRaw`SELECT growth_erase_corporate('')`, /sub hash is required/);
    await c.prisma.corporateBenefitEntry.create({ data: { accountId: a.id, memberId: m1.id, type: 'RESERVE', amountMinor: 5, bookingId: 'old', idempotencyKey: `k${u()}`, reasonCode: 'T', actor: 't' } });
    const r1 = (await c.prisma.$queryRaw<{ r: Record<string, number> }[]>`SELECT growth_purge_corporate(now() + interval '10 years') AS r`)[0].r; expect(Number(r1.corporateLedgerEntriesPurged)).toBe(0); // the account is not ENDED: the ledger stays
    await c.prisma.corporateAccount.update({ where: { id: a.id }, data: { status: 'ENDED', endsAt: new Date('2027-01-01') } });
    expect(Number((await c.prisma.$queryRaw<{ r: Record<string, number> }[]>`SELECT growth_purge_corporate(${new Date('2027-06-01')}::timestamptz) AS r`)[0].r.corporateLedgerEntriesPurged)).toBe(0); // inside the 7 years
    expect(Number((await c.prisma.$queryRaw<{ r: Record<string, number> }[]>`SELECT growth_purge_corporate(${new Date('2036-06-01')}::timestamptz) AS r`)[0].r.corporateLedgerEntriesPurged)).toBe(1);
    await rejects(c.prisma.$queryRaw`SELECT growth_purge_corporate(now(), 0)`, /years must be >= 1/);
  });

  it('the migration is idempotent when replayed twice', async () => {
    const dir = join(__dirname, '..', 'prisma', 'migrations'); const f = readdirSync(dir).find((x) => x.endsWith('_growth_p4_corporate'))!;
    const sql = readFileSync(join(dir, f, 'migration.sql'), 'utf8'); const cl = new Client({ connectionString: testDatabaseUrl() }); await cl.connect();
    try { await cl.query(sql); await cl.query(sql); } finally { await cl.end(); }
    await c.prisma.corporateAccount.count();
  });
  it('the migration name sorts after every earlier migration and shares no prefix', () => {
    const names = readdirSync(join(__dirname, '..', 'prisma', 'migrations')).filter((f) => /^\d{14}_/.test(f)).sort();
    const prefixes = names.map((n) => n.slice(0, 14)); expect(new Set(prefixes).size).toBe(prefixes.length);
    expect(names.indexOf('20270128093000_growth_p4_corporate')).toBeGreaterThan(-1); // later migrations (wave 9) may follow it, the corporate one is never reordered
    expect(names.slice(names.indexOf('20270128093000_growth_p4_corporate') + 1).every((n) => n > '20270128093000')).toBe(true);
  });
});
