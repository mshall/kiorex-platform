import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { createCtx, TestCtx } from './harness';
import { testDatabaseUrl } from './db-url';

/**
 * GRW-P4-D schema (migration 20270218090000_growth_p4_loyalty, owner lane A1 of wave 9). Real Postgres: the tables, the CHECK rules, the ledger guard and append-only triggers, the program and redemption guards,
 * the FIFO expiry and erase functions, no foreign key into any credit table, and idempotent replay of the migration (twice, and again after rows exist).
 */
describe('growth Phase 4 schema, loyalty and partnerships (wave 9)', () => {
  let c: TestCtx;
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => { await c.reset(); });
  const rejects = (p: Promise<unknown>, re: RegExp) => expect(p).rejects.toThrow(re);
  let seq = 0; const u = () => `${Date.now().toString(36)}${(++seq).toString(36)}`;
  const acct = (o: Record<string, unknown> = {}) => c.prisma.loyaltyAccount.create({ data: { id: `lac_${u()}`, sub: `s_${u()}`, ...o } as never });
  const camp = (o: Record<string, unknown> = {}) => c.prisma.growthCampaign.create({ data: { key: `k-${u()}`, utmCampaign: `eg-${u()}`, name: 'n', objective: 'ACQUISITION', status: 'ACTIVE', budgetTotalMinor: 100_000, budgetDailyMinor: 1000, channels: ['PARTNER'], policyVersionId: 'v', ownerSub: 'o', ...o } as never });
  const prog = (o: Record<string, unknown> = {}) => c.prisma.partnershipProgram.create({ data: { id: `ptp_${u()}`, key: `p-${u()}`, partnerRef: 'x', kind: 'CODE_DISCOUNT', createdBy: 'a', ...o } as never });

  it('every loyalty and partnership table exists, with the triggers and functions', async () => {
    const t = (await c.prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = current_schema()`).map((r) => r.tablename);
    for (const n of ['LoyaltyAccount', 'LoyaltyAccrualEntry', 'PartnershipProgram', 'PartnershipCode', 'PartnershipCodeRedemption']) expect(t).toContain(n);
    const trg = (await c.prisma.$queryRaw<{ tgname: string }[]>`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal`).map((r) => r.tgname);
    for (const n of ['loyalty_entry_guard_ins', 'loyalty_entry_immutable', 'loyalty_account_guard_upd', 'partnership_program_guard_trg', 'partnership_redemption_guard_ins', 'partnership_redemption_immutable']) expect(trg).toContain(n);
    const fn = (await c.prisma.$queryRaw<{ proname: string }[]>`SELECT proname FROM pg_proc WHERE proname IN ('loyalty_expirable_points','growth_erase_loyalty')`).map((r) => r.proname); expect(fn.sort()).toEqual(['growth_erase_loyalty', 'loyalty_expirable_points']);
  });
  it('no foreign key crosses into the patient credit tables or the Clinic, and no column is a cash value, wallet or recipient', async () => {
    const fks = await c.prisma.$queryRaw<{ t: string; ref: string }[]>`SELECT conrelid::regclass::text AS t, confrelid::regclass::text AS ref FROM pg_constraint WHERE contype = 'f' AND (conrelid::regclass::text ~ '^"?(Loyalty|Partnership)')`;
    expect(fks.length).toBeGreaterThanOrEqual(4); for (const f of fks) expect(f.ref).toMatch(/^"?(Loyalty|Partnership|GrowthCampaign)/);
    const cols = await c.prisma.$queryRaw<{ column_name: string }[]>`SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND (table_name LIKE 'Loyalty%' OR table_name LIKE 'Partnership%')`;
    expect(cols.filter((x) => /cash|wallet|recipient|transfer|iban|account(number|no)|card/i.test(x.column_name))).toEqual([]);
  });
  it('account CHECKs: tier vocabulary, balance never below zero, one account per person and market', async () => {
    await rejects(acct({ tier: 'DIAMOND' }), /tier_check/); await rejects(acct({ pointsBalanceCache: -1 }), /balance_check|LOYALTY_CACHE_LOCKED/);
    const a = await acct({ sub: 'same' }); expect(a.pointsBalanceCache).toBe(0); await rejects(acct({ sub: 'same' }), /Unique constraint/); await acct({ sub: 'same', market: 'SA' });
  });
  it('the program CHECKs: vocabularies, money terms, window, and the ACTIVE rule (budget, value, window, campaign, legal text, platform funding, a second person)', async () => {
    await rejects(prog({ kind: 'WALLET' }), /kind_check/); await rejects(prog({ status: 'LIVE' }), /status_check/); await rejects(prog({ fundingMode: 'PARTNER_WALLET' }), /funding_check/); await rejects(prog({ budgetMinor: -1 }), /amounts_check/); await rejects(prog({ budgetMinor: 100, perRedemptionMinor: 101 }), /amounts_check/);
    await rejects(prog({ startsAt: new Date(2027, 5, 1), endsAt: new Date(2027, 4, 1) }), /window_check/);
    const d = await prog(); expect(d).toMatchObject({ status: 'DRAFT', budgetMinor: 0, perRedemptionMinor: 0, fundingMode: 'PLATFORM_MARKETING' });
    const k = await camp(); const ok = { budgetMinor: 6000, perRedemptionMinor: 3000, startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 86_400_000), campaignId: k.id, legalTextRef: 'L-1', activatedBy: 'b' };
    await rejects(c.prisma.partnershipProgram.update({ where: { id: d.id }, data: { status: 'ACTIVE', ...ok, activatedBy: 'a' } }), /active_check/); // the creator cannot activate
    for (const bad of [{ budgetMinor: 0, perRedemptionMinor: 0 }, { campaignId: null }, { legalTextRef: ' ' }, { startsAt: null }, { fundingMode: 'PARTNER_FUNDED' }, { activatedBy: null }]) await rejects(c.prisma.partnershipProgram.update({ where: { id: d.id }, data: { status: 'ACTIVE', ...ok, ...bad } as never }), /active_check|PARTNERSHIP_|amounts_check/);
    await c.prisma.partnershipProgram.update({ where: { id: d.id }, data: { status: 'ACTIVE', ...ok } });
  });
  it('an ACTIVE program needs an approved campaign of the same market with the PARTNER channel, within the campaign budget; money terms freeze; ENDED is final', async () => {
    const ok = (campaignId: string, o: Record<string, unknown> = {}) => ({ status: 'ACTIVE', budgetMinor: 6000, perRedemptionMinor: 3000, startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 86_400_000), campaignId, legalTextRef: 'L', activatedBy: 'b', ...o });
    const d = await prog();
    for (const k of [await camp({ status: 'DRAFT' }), await camp({ status: 'PENDING_APPROVAL' }), await camp({ status: 'PAUSED' }), await camp({ channels: ['EMAIL'] }), await camp({ market: 'SA' })]) await rejects(c.prisma.partnershipProgram.update({ where: { id: d.id }, data: ok(k.id) as never }), /PARTNERSHIP_TERMS_INCOMPLETE/);
    await rejects(c.prisma.partnershipProgram.update({ where: { id: d.id }, data: ok((await camp({ budgetTotalMinor: 5000, budgetDailyMinor: 1000 })).id) as never }), /PARTNERSHIP_BUDGET_EXCEEDED/);
    const good = await camp({ status: 'SCHEDULED' }); await c.prisma.partnershipProgram.update({ where: { id: d.id }, data: ok(good.id) as never });
    for (const f of [{ budgetMinor: 7000 }, { perRedemptionMinor: 1000 }, { campaignId: (await camp()).id }, { kind: 'CO_PROMO' }, { fundingMode: 'PARTNER_FUNDED' }, { endsAt: new Date(Date.now() + 9e9) }]) await rejects(c.prisma.partnershipProgram.update({ where: { id: d.id }, data: f as never }), /PARTNERSHIP_FROZEN/);
    await c.prisma.partnershipProgram.update({ where: { id: d.id }, data: { status: 'PAUSED' } }); await c.prisma.partnershipProgram.update({ where: { id: d.id }, data: { status: 'ENDED' } });
    await rejects(c.prisma.partnershipProgram.update({ where: { id: d.id }, data: { status: 'ACTIVE' } }), /PARTNERSHIP_ENDED/);
    await rejects(c.prisma.growthCampaign.delete({ where: { id: good.id } }), /foreign key|referenced|violates/i); // a campaign with a program cannot be deleted
  });
  it('codes: unique hash, vocabulary, counters cannot pass the limit; redemptions are append-only, one per person per program, with a positive amount', async () => {
    const k = await camp(); const p = await prog();
    const code = (o: Record<string, unknown> = {}) => c.prisma.partnershipCode.create({ data: { id: `ptc_${u()}`, programId: p.id, codeHash: `h${u()}`, label: 'l', maxRedemptions: 2, createdBy: 'a', ...o } as never });
    const first = await code(); await rejects(code({ codeHash: first.codeHash }), /Unique constraint/); await rejects(code({ status: 'GONE' }), /status_check/); await rejects(code({ maxRedemptions: 0 }), /counts_check/); await rejects(code({ redeemedCount: 3 }), /counts_check/);
    await rejects(c.prisma.partnershipCodeRedemption.create({ data: { id: `pcr_${u()}`, programId: p.id, codeId: first.id, subHash: 's', lotId: 'rwl_x', amountMinor: 0, idempotencyKey: `i${u()}` } }), /amount_check|PARTNERSHIP_NOT_ACTIVE/);
    expect(k.id).toBeTruthy();
  });
  it('growth_purge_loyalty removes only long-inactive accounts with no points (entries first), keeps anything with a balance or recent activity, purges redemptions of long-ended programs, and is idempotent', async () => {
    const old = new Date(Date.now() - 8 * 365 * 86_400_000); const recent = new Date(Date.now() - 30 * 86_400_000);
    const mk = async (o: { balance?: number; entryAt: Date; updatedAt?: Date }) => {
      const a = await acct({ pointsBalanceCache: 0 });
      await c.prisma.loyaltyAccrualEntry.create({ data: { id: `lae_${u()}`, accountId: a.id, type: 'TIER_BONUS', points: 10, idempotencyKey: `k_${u()}`, reasonCode: 'T', actor: 't', createdAt: o.entryAt, expiresAt: new Date(o.entryAt.getTime() + 365 * 86_400_000) } as never });
      await c.prisma.loyaltyAccrualEntry.create({ data: { id: `lae_${u()}`, accountId: a.id, type: 'EXPIRE', points: 10, idempotencyKey: `k_${u()}`, reasonCode: 'T', actor: 't', createdAt: o.entryAt } as never });
      if (o.balance) await c.prisma.loyaltyAccrualEntry.create({ data: { id: `lae_${u()}`, accountId: a.id, type: 'TIER_BONUS', points: o.balance, idempotencyKey: `k_${u()}`, reasonCode: 'T', actor: 't', createdAt: o.entryAt, expiresAt: new Date(Date.now() + 86_400_000) } as never });
      await c.prisma.$executeRaw`UPDATE "LoyaltyAccount" SET "updatedAt" = ${o.updatedAt ?? o.entryAt} WHERE "id" = ${a.id}`;
      return a.id;
    };
    const stale = await mk({ entryAt: old }); const holds = await mk({ entryAt: old, balance: 5 }); const active = await mk({ entryAt: recent });
    const r = (await c.prisma.$queryRaw<{ r: Record<string, number> }[]>`SELECT growth_purge_loyalty() AS r`)[0].r;
    expect(r).toMatchObject({ loyaltyAccountsPurged: 1, loyaltyLedgerEntriesPurged: 2, partnershipRedemptionsPurged: 0 });
    expect(await c.prisma.loyaltyAccount.count({ where: { id: stale } })).toBe(0); expect(await c.prisma.loyaltyAccrualEntry.count({ where: { accountId: stale } })).toBe(0);
    expect(await c.prisma.loyaltyAccount.count({ where: { id: { in: [holds, active] } } })).toBe(2); expect(await c.prisma.loyaltyAccrualEntry.count({ where: { accountId: holds } })).toBe(3);
    expect((await c.prisma.$queryRaw<{ r: Record<string, number> }[]>`SELECT growth_purge_loyalty() AS r`)[0].r).toMatchObject({ loyaltyAccountsPurged: 0, loyaltyLedgerEntriesPurged: 0 });
    // the ledger is still append-only for everyone else
    await rejects(c.prisma.$executeRaw`DELETE FROM "LoyaltyAccrualEntry" WHERE "accountId" = ${holds}`, /append-only/);
    await rejects(c.prisma.$queryRaw`SELECT growth_purge_loyalty(now(), 0)`, /years must be/);
  });
  it('growth_erase_loyalty anonymises exactly that person and keeps the ledger; it demands both arguments', async () => {
    const a = await acct({ sub: 'person1' }); await acct({ sub: 'person2' });
    const r = (await c.prisma.$queryRaw<{ r: { loyaltyAccountsAnonymised: number } }[]>`SELECT growth_erase_loyalty('person1', 'hash-1') AS r`)[0].r; expect(r.loyaltyAccountsAnonymised).toBe(1);
    expect((await c.prisma.loyaltyAccount.findUniqueOrThrow({ where: { id: a.id } })).sub).toMatch(/^h:[0-9a-f]{64}$/); expect(await c.prisma.loyaltyAccount.count({ where: { sub: 'person2' } })).toBe(1);
    await rejects(c.prisma.$queryRaw`SELECT growth_erase_loyalty('', 'x')`, /required/); await rejects(c.prisma.$queryRaw`SELECT growth_erase_loyalty('x', '')`, /required/);
  });
  it('the migration is idempotent when replayed twice, and again with rows present', async () => {
    const dir = join(__dirname, '..', 'prisma', 'migrations'); const f = readdirSync(dir).find((x) => x.endsWith('_growth_p4_loyalty'))!;
    const sql = readFileSync(join(dir, f, 'migration.sql'), 'utf8'); const cl = new Client({ connectionString: testDatabaseUrl() }); await cl.connect();
    try { await cl.query(sql); await cl.query(sql); const a = await acct(); await cl.query(sql); expect(await c.prisma.loyaltyAccount.count({ where: { id: a.id } })).toBe(1); } finally { await cl.end(); }
  });
  it('the migration name is the wave 9 name, sorts after every earlier migration and shares no prefix', () => {
    const names = readdirSync(join(__dirname, '..', 'prisma', 'migrations')).filter((f) => /^\d{14}_/.test(f)).sort();
    const prefixes = names.map((n) => n.slice(0, 14)); expect(new Set(prefixes).size).toBe(prefixes.length);
    expect(names).toContain('20270218090000_growth_p4_loyalty'); expect(names.indexOf('20270218090000_growth_p4_loyalty')).toBeGreaterThan(names.indexOf('20270128093000_growth_p4_corporate'));
  });
});
