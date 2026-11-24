import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { createCtx, TestCtx } from './harness';
import { testDatabaseUrl } from './db-url';
import { seedBooking } from './growth-helpers';
import { GrowthMaintenanceService } from '../src/growth/growth-public';

/**
 * GRW-P2-X1: the Phase 2 schema (migrations 20261203090000 .. 20261203095000). Real Postgres. Triggers (append-only, race-proof reward balance), CHECKs (approver differs,
 * code format, amounts), erasure and retention for every new table, the PatientLifecycle column guard, idempotent migrations, and the superseding GrowthMetricDaily key.
 */
describe('growth Phase 2 schema', () => {
  let c: TestCtx; let maint: GrowthMaintenanceService;
  beforeAll(async () => { c = await createCtx(); maint = c.app.get(GrowthMaintenanceService); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => { await c.reset(); });

  const rejects = (p: Promise<unknown>, re: RegExp) => expect(p).rejects.toThrow(re);
  let seq = 0;
  const uniq = () => `${Date.now().toString(36)}${(++seq).toString(36)}`;
  const campaign = (o: Record<string, unknown> = {}) => { const k = `camp-${uniq()}`; return c.prisma.growthCampaign.create({ data: { key: k, utmCampaign: `eg-${k}`, name: 'Test', objective: 'AWARENESS', budgetTotalMinor: 1_000_000, budgetDailyMinor: 100_000, channels: ['EMAIL'], policyVersionId: 'pv', ownerSub: 'ops_a', ...o } as any }); };
  const lot = (o: Record<string, unknown> = {}) => c.prisma.rewardLot.create({ data: { sub: `sub_${uniq()}`, kind: 'PROMO', mode: 'COUPON', amountMinor: 5000, ruleVersionId: 'rv', expiresAt: new Date(Date.now() + 86_400_000), ...o } as any });
  const entry = (lotId: string, type: string, amountMinor: number, key = `rwd:${type.toLowerCase()}:${uniq()}`) => c.prisma.rewardLedgerEntry.create({ data: { lotId, type, amountMinor, idempotencyKey: key, ruleVersionId: 'rv', reasonCode: 'REFERRER_QUALIFIED', actor: 'system' } });
  const balance = async (id: string) => (await c.prisma.$queryRaw<{ available: bigint; held: bigint; reserved: bigint }[]>`SELECT * FROM reward_lot_balance(${id})`)[0];

  it('every Phase 2 table exists and GrowthSpendEntry gained exactly the three additive columns', async () => {
    const t = (await c.prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = current_schema()`).map((r) => r.tablename);
    for (const n of ['GrowthCampaign', 'GrowthCampaignCreative', 'GrowthCampaignApproval', 'GrowthCampaignStatusHistory', 'GrowthCampaignBudgetDaily', 'ReferralCode', 'ReferralRelationship', 'ReferralQualificationCheck', 'ReferralIdentitySignal',
      'RewardLot', 'RewardLedgerEntry', 'RewardIssuanceBudget', 'PatientLifecycle', 'LifecycleEnrollment', 'LifecycleMessageDecision', 'LifecycleSegmentSnapshot', 'AssistantSession', 'AssistantTurn', 'AssistantToolCall', 'AssistantUsageDaily',
      'AssistantEscalation', 'GrowthIntegrationRun', 'GrowthExternalMetricDaily', 'GrowthIntegrationHealth', 'GrowthJobRun', 'RewardHousehold', 'RewardHouseholdMember', 'RefundDestinationChoice', 'GoodwillGrant', 'RewardCheckoutLine', 'RewardReconcileRun']) expect(t).toContain(n);
    const cols = (await c.prisma.$queryRaw<{ column_name: string }[]>`SELECT column_name FROM information_schema.columns WHERE table_name = 'GrowthSpendEntry'`).map((r) => r.column_name).sort();
    expect(cols).toEqual(['adapterRef', 'amountMinor', 'campaign', 'campaignId', 'channel', 'createdAt', 'createdBy', 'currency', 'day', 'decidedAt', 'decidedBy', 'id', 'market', 'note', 'source', 'sourceKind', 'status']);
  });

  it('PatientLifecycle is non-clinical: the column list is exactly the allowed one (no specialty, provider, diagnosis or visit reason can be added unnoticed)', async () => {
    const cols = (await c.prisma.$queryRaw<{ column_name: string }[]>`SELECT column_name FROM information_schema.columns WHERE table_name = 'PatientLifecycle'`).map((r) => r.column_name).sort();
    expect(cols).toEqual(['bookingsCount', 'city', 'district', 'hasDependants', 'language', 'lastAttendedAt', 'lastBookingAt', 'market', 'platform', 'referralStatus', 'registeredAt', 'stage', 'stageAt', 'sub']);
    expect(cols.join(' ')).not.toMatch(/specialty|provider|doctor|diagnos|reason|clinic|drug|lab|prescri|complaint/i);
  });

  describe('campaigns', () => {
    it('status history is append-only; a campaign with history cannot be deleted', async () => {
      const k = await campaign();
      const h = await c.prisma.growthCampaignStatusHistory.create({ data: { campaignId: k.id, from: 'DRAFT', to: 'SCHEDULED', actor: 'ops_a', reasonCode: 'SUBMITTED' } });
      await rejects(c.prisma.growthCampaignStatusHistory.update({ where: { id: h.id }, data: { actor: 'x' } }), /append-only/);
      await rejects(c.prisma.growthCampaignStatusHistory.delete({ where: { id: h.id } }), /append-only/);
      await rejects(c.prisma.$executeRawUnsafe(`DELETE FROM "GrowthCampaign" WHERE id='${k.id}'`), /append-only/);
      await rejects(c.prisma.$transaction(async (tx) => { await tx.$executeRawUnsafe(`SELECT set_config('kx.growth_maintenance','on',true)`); await tx.$executeRawUnsafe(`DELETE FROM "GrowthCampaignStatusHistory"`); }), /append-only/);
    });
    it('CHECKs: approver differs from requester, decision and decider come together, state names, budgets, key and utm format, window', async () => {
      const k = await campaign();
      const a = await c.prisma.growthCampaignApproval.create({ data: { campaignId: k.id, kind: 'ACTIVATE', requestedBy: 'ops_a', snapshot: {}, snapshotHash: 'h' } });
      await rejects(c.prisma.growthCampaignApproval.update({ where: { id: a.id }, data: { decidedBy: 'ops_a', decision: 'APPROVED', decidedAt: new Date() } }), /maker_checker/);
      await rejects(c.prisma.growthCampaignApproval.update({ where: { id: a.id }, data: { decidedBy: 'ops_b' } }), /decided_together/);
      await c.prisma.growthCampaignApproval.update({ where: { id: a.id }, data: { decidedBy: 'ops_b', decision: 'APPROVED', decidedAt: new Date() } });
      await rejects(campaign({ status: 'LIVE' }), /status_check/);
      await rejects(campaign({ budgetTotalMinor: 0 }), /budget_check/);
      await rejects(campaign({ budgetTotalMinor: 100, budgetDailyMinor: 200 }), /budget_check/);
      await rejects(campaign({ key: 'Bad Key' }), /key_check/);
      await rejects(campaign({ utmCampaign: 'Has Space' }), /utm_check/);
      await rejects(campaign({ startsAt: new Date('2027-02-01'), endsAt: new Date('2027-01-01') }), /window_check/);
      await rejects(c.prisma.growthCampaignStatusHistory.create({ data: { campaignId: k.id, from: 'ACTIVE', to: 'ACTIVE', actor: 'x', reasonCode: 'X' } }), /states_check/);
    });
    it('key and utm campaign are unique per market', async () => {
      const k = await campaign();
      await rejects(campaign({ key: k.key, utmCampaign: `eg-other-${uniq()}` }), /Unique constraint|unique/i);
      await rejects(campaign({ utmCampaign: k.utmCampaign }), /Unique constraint|unique/i);
      await campaign({ key: k.key, utmCampaign: `sa-${k.key}`, market: 'SA' });
    });
    it('adapter spend is de-duplicated by (campaign, day, source, adapterRef); manual spend is not constrained by it', async () => {
      const k = await campaign();
      const row = (o: Record<string, unknown>) => c.prisma.growthSpendEntry.create({ data: { day: new Date('2027-01-05'), amountMinor: 100, createdBy: 'system', campaignId: k.id, ...o } as any });
      await row({ source: 'ADAPTER', adapterRef: 'g_1' });
      await rejects(row({ source: 'ADAPTER', adapterRef: 'g_1' }), /Unique constraint|unique/i);
      await row({ source: 'ADAPTER', adapterRef: 'g_2' });
      await row({ source: 'MANUAL' }); await row({ source: 'MANUAL' });
      await rejects(row({ source: 'CRYSTAL' }), /source_check/);
    });
    it('GrowthMetricDaily has ONE unique index, the superseding dim2 key with campaignId (also after the migration is replayed)', async () => {
      const q = async () => (await c.prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'GrowthMetricDaily' AND indexdef LIKE '%UNIQUE%' AND indexname <> 'GrowthMetricDaily_pkey'`);
      let idx = await q();
      expect(idx.map((i) => i.indexname)).toEqual(['GrowthMetricDaily_dim2_key']);
      for (const col of ['city', 'providerRef', 'doctorRef', 'branchRef', 'channel', 'platform', 'product', 'campaignId']) expect(idx[0].indexdef).toContain(col);
      const cl = new Client({ connectionString: testDatabaseUrl() }); await cl.connect();
      try { await cl.query(readFileSync(join(__dirname, '..', 'prisma', 'migrations', '20261203090000_growth_p2_campaigns', 'migration.sql'), 'utf8')); } finally { await cl.end(); }
      idx = await q();
      expect(idx.map((i) => i.indexname)).toEqual(['GrowthMetricDaily_dim2_key']);
      await c.prisma.growthMetricDaily.create({ data: { day: new Date('2027-01-05'), metric: 'PageViewed', campaignId: '' } });
      await c.prisma.growthMetricDaily.create({ data: { day: new Date('2027-01-05'), metric: 'PageViewed', campaignId: 'cmp_1' } });
      await rejects(c.prisma.growthMetricDaily.create({ data: { day: new Date('2027-01-05'), metric: 'PageViewed', campaignId: 'cmp_1' } }), /Unique constraint|unique/i);
    });
  });

  describe('referral and rewards', () => {
    it('referral code format, status and self-referral CHECKs; one code per person and market; one relationship per invited person', async () => {
      const code = (o: Record<string, unknown>) => c.prisma.referralCode.create({ data: { sub: `s_${uniq()}`, code: '7K2M9X4Q', ...o } as any });
      await code({});
      for (const bad of ['7k2m9x4q', '7K2M9X4I', '7K2M9X4', '7K2M9X4QQ']) await rejects(code({ code: bad, sub: `s_${uniq()}` }), /format_check/);
      const rc = await c.prisma.referralCode.findFirstOrThrow();
      await rejects(code({ code: '8K2M9X4Q', sub: rc.sub }), /Unique constraint|unique/i);
      const rel = (o: Record<string, unknown>) => c.prisma.referralRelationship.create({ data: { referrerSub: 'a', refereeSub: `b_${uniq()}`, codeId: rc.id, ruleVersionId: 'rv', ...o } as any });
      await rejects(rel({ referrerSub: 'x', refereeSub: 'x' }), /not_self/);
      const r1 = await rel({ refereeSub: 'bob' });
      await rejects(rel({ refereeSub: 'bob' }), /Unique constraint|unique/i);
      await rejects(rel({ status: 'DONE' }), /status_check/);
      const chk = await c.prisma.referralQualificationCheck.create({ data: { relationshipId: r1.id, checkKey: 'ATTENDED', passed: true } });
      await rejects(c.prisma.referralQualificationCheck.update({ where: { id: chk.id }, data: { passed: false } }), /append-only/);
      await rejects(c.prisma.referralQualificationCheck.delete({ where: { id: chk.id } }), /append-only/);
    });
    it('the ledger is append-only, amounts are positive, the idempotency key is unique and well formed', async () => {
      const l = await lot(); const e = await entry(l.id, 'ISSUE', 5000, 'rwd:issue:r1');
      await rejects(c.prisma.rewardLedgerEntry.update({ where: { id: e.id }, data: { amountMinor: 1 } }), /append-only/);
      await rejects(c.prisma.rewardLedgerEntry.delete({ where: { id: e.id } }), /append-only/);
      await rejects(entry(l.id, 'ISSUE', 0), /amount_check/);
      await rejects(entry(l.id, 'ISSUE', 5000, 'rwd:issue:r1'), /Unique constraint|unique/i);
      await rejects(entry(l.id, 'ISSUE', 5000, 'bad key'), /key_check/);
      await rejects(entry(l.id, 'GIFT', 5000), /type_check/);
    });
    it('balances follow the ledger and refuse an entry that would make available, held or reserved negative', async () => {
      const l = await lot();
      await entry(l.id, 'ISSUE', 5000);
      await rejects(entry(l.id, 'RESERVE', 5001), /negative balance/);
      await rejects(entry(l.id, 'REDEEM', 1), /negative balance/); // a redeem consumes a reservation
      await entry(l.id, 'RESERVE', 3000);
      expect(await balance(l.id)).toMatchObject({ available: 2000n, held: 0n, reserved: 3000n });
      await entry(l.id, 'REDEEM', 3000);
      expect(await balance(l.id)).toMatchObject({ available: 2000n, reserved: 0n });
      await entry(l.id, 'HOLD', 500); await rejects(entry(l.id, 'RELEASE_HOLD', 501), /negative balance/);
      await entry(l.id, 'RELEASE_HOLD', 500); await entry(l.id, 'EXPIRE', 2000);
      expect(await balance(l.id)).toMatchObject({ available: 0n, held: 0n, reserved: 0n });
    });
    it('20 parallel reservations of one lot can never spend more than it holds (FOR UPDATE inside the deferred constraint trigger)', async () => {
      const l = await lot({ amountMinor: 5000 }); await entry(l.id, 'ISSUE', 5000);
      const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => entry(l.id, 'RESERVE', 1000, `rwd:reserve:par_${i}`)));
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(15);
      expect(await balance(l.id)).toMatchObject({ available: 0n, reserved: 5000n });
    });
    it('the issuance budget cannot exceed its ceiling', async () => {
      await c.prisma.rewardIssuanceBudget.create({ data: { ruleVersionId: 'rv1', ceilingMinor: 1000, issuedMinor: 1000 } });
      await rejects(c.prisma.rewardIssuanceBudget.update({ where: { ruleVersionId: 'rv1' }, data: { issuedMinor: 1001 } }), /bounds_check/);
    });
  });

  describe('patient credit ledger v2 (Rev 2.6, ADR-048 Proposed)', () => {
    it('S3: every lot has an expiry, a funding label and a known kind; REFUND_CREDIT lots are always PATIENT_REFUND money and nothing else is', async () => {
      await rejects(lot({ kind: 'GIFT' }), /kind_check/);
      await rejects(lot({ funding: 'KIORLY' }), /funding_check/);
      await rejects(lot({ kind: 'REFUND_CREDIT', funding: 'PLATFORM_MARKETING' }), /refund_credit_funding_check/);
      await rejects(lot({ kind: 'GOODWILL', funding: 'PATIENT_REFUND' }), /refund_credit_funding_check/);
      for (const kind of ['WELCOME', 'GOODWILL', 'CAMPAIGN', 'RESTORED', 'PROMO']) await lot({ kind });
      await rejects(c.prisma.$executeRawUnsafe(`INSERT INTO "RewardLot" ("id","sub","kind","mode","amountMinor","ruleVersionId","expiresAt") VALUES ('x','s','PROMO','COUPON',1,'r',NULL)`), /null value|expiresAt/);
    });
    it('S4: value for a referral, welcome or campaign is issued only for a qualifying booking that Kiorex has COMPLETED; sign-up and an unfinished booking cannot issue', async () => {
      const confirmed = await seedBooking(c); // status CONFIRMED: not completed yet
      const completed = await seedBooking(c); await c.prisma.bookingIntent.update({ where: { id: completed.id }, data: { status: 'COMPLETED' } });
      for (const kind of ['REFERRER', 'REFEREE', 'WELCOME', 'CAMPAIGN']) {
        await rejects(entry((await lot({ kind })).id, 'ISSUE', 5000), /COMPLETED qualifying booking/); // sign-up: no qualifying booking at all
        await rejects(entry((await lot({ kind, qualifyingBookingId: 'does_not_exist' })).id, 'ISSUE', 5000), /COMPLETED qualifying booking/);
        await rejects(entry((await lot({ kind, qualifyingBookingId: confirmed.id })).id, 'ISSUE', 5000), /COMPLETED qualifying booking/); // an unfinished booking
        await entry((await lot({ kind, qualifyingBookingId: completed.id })).id, 'ISSUE', 5000); // the verified completed visit
      }
      for (const kind of ['PROMO', 'GOODWILL', 'REPEAT', 'RESTORED']) await entry((await lot({ kind })).id, 'ISSUE', 100); // other kinds: their own reasons and caps apply
    });
    it('S7: a REFUND_CREDIT is issued only with a refund id and a recorded CREDIT choice; no other lot can be issued against a refund', async () => {
      const mk = () => lot({ kind: 'REFUND_CREDIT', funding: 'PATIENT_REFUND' });
      const noRefund = await mk(); await rejects(entry(noRefund.id, 'ISSUE', 5000), /CREDIT choice/);
      const orig = await mk();
      await c.prisma.refundDestinationChoice.create({ data: { refundId: 'rfd_orig', bookingId: 'b', sub: 's', choice: 'ORIGINAL', source: 'PATIENT_CANCEL' } });
      await rejects(c.prisma.rewardLedgerEntry.create({ data: { lotId: orig.id, type: 'ISSUE', amountMinor: 5000, idempotencyKey: 'rwd:issue:o1', ruleVersionId: 'rv', reasonCode: 'REFUND_CHOICE', actor: 'system', refundId: 'rfd_orig' } }), /CREDIT choice/);
      await c.prisma.refundDestinationChoice.create({ data: { refundId: 'rfd_credit', bookingId: 'b', sub: 's', choice: 'CREDIT', source: 'PATIENT_CANCEL' } });
      const ok = await mk();
      await c.prisma.rewardLedgerEntry.create({ data: { lotId: ok.id, type: 'ISSUE', amountMinor: 25000, idempotencyKey: 'rwd:issue:ok', ruleVersionId: 'rv', reasonCode: 'REFUND_CHOICE', actor: 'system', refundId: 'rfd_credit' } });
      const promo = await lot({ kind: 'PROMO' });
      await rejects(c.prisma.rewardLedgerEntry.create({ data: { lotId: promo.id, type: 'ISSUE', amountMinor: 1, idempotencyKey: 'rwd:issue:p1', ruleVersionId: 'rv', reasonCode: 'X', actor: 'system', refundId: 'rfd_credit' } }), /only a REFUND_CREDIT or RESTORED/);
    });
    it('the refund destination choice is immutable and one per refund; goodwill needs a reference and a different approver; households are one per owner', async () => {
      const ch = await c.prisma.refundDestinationChoice.create({ data: { refundId: 'rfd_1', bookingId: 'b', sub: 's', choice: 'ORIGINAL', source: 'PATIENT_REFUND_REQUEST' } });
      await rejects(c.prisma.refundDestinationChoice.update({ where: { id: ch.id }, data: { choice: 'CREDIT' } }), /append-only/);
      await rejects(c.prisma.refundDestinationChoice.delete({ where: { id: ch.id } }), /append-only/);
      await rejects(c.prisma.refundDestinationChoice.create({ data: { refundId: 'rfd_1', bookingId: 'b', sub: 's', choice: 'CREDIT', source: 'PATIENT_CANCEL' } }), /Unique constraint|unique/i);
      await rejects(c.prisma.refundDestinationChoice.create({ data: { refundId: 'rfd_2', bookingId: 'b', sub: 's', choice: 'CASH', source: 'PATIENT_CANCEL' } }), /choice_check/);
      const g = (o: Record<string, unknown>) => c.prisma.goodwillGrant.create({ data: { sub: 's', reason: 'LONG_WAIT', ticketRef: 'T-1', amountMinor: 5000, lotId: 'l', grantedBy: 'agent_a', ...o } as any });
      await g({}); await g({ approvedBy: 'lead_b' });
      await rejects(g({ approvedBy: 'agent_a' }), /maker_checker/);
      await rejects(g({ ticketRef: null }), /reference_check/);
      await rejects(g({ reason: 'BECAUSE' }), /reason_check/);
      await rejects(g({ amountMinor: 0 }), /amount_check/);
      await c.prisma.rewardHousehold.create({ data: { ownerSub: 'owner' } });
      await rejects(c.prisma.rewardHousehold.create({ data: { ownerSub: 'owner' } }), /Unique constraint|unique/i);
      const l = await c.prisma.rewardCheckoutLine.create({ data: { sub: 's', priceMinor: 50000, lines: [{ code: 'PRICE', amountMinor: 50000 }] } });
      await rejects(c.prisma.rewardCheckoutLine.update({ where: { id: l.id }, data: { priceMinor: 1 } }), /append-only/);
    });
    it('erasure anonymises household, member, owner, refund choice, goodwill and checkout rows and keeps the ledger; purge v2 follows the ledger retention', async () => {
      const sub = 'sub_credit_erase';
      const hh = await c.prisma.rewardHousehold.create({ data: { ownerSub: sub } });
      await c.prisma.rewardHouseholdMember.create({ data: { householdId: hh.id, memberSub: 'child_1' } });
      await c.prisma.rewardHouseholdMember.create({ data: { householdId: hh.id, memberSub: sub } });
      await c.prisma.refundDestinationChoice.create({ data: { refundId: 'rfd_e', bookingId: 'b', sub, choice: 'ORIGINAL', source: 'PATIENT_CANCEL' } });
      await c.prisma.goodwillGrant.create({ data: { sub, reason: 'LONG_WAIT', ticketRef: 'T', amountMinor: 100, lotId: 'l', grantedBy: 'a' } });
      await c.prisma.rewardCheckoutLine.create({ data: { sub, priceMinor: 100, lines: [] } });
      const l = await lot({ sub, ownerSub: sub }); await entry(l.id, 'ISSUE', 100);
      const r = await maint.eraseSubject(sub);
      expect(r).toMatchObject({ householdsAnonymised: 1, householdMembersAnonymised: 1, refundChoicesAnonymised: 1, goodwillGrantsAnonymised: 1, checkoutLinesAnonymised: 1 });
      const h = (await c.prisma.$queryRaw<{ h: string }[]>`SELECT 'h:' || encode(sha256(convert_to(${sub}, 'UTF8')), 'hex') AS h`)[0].h;
      expect((await c.prisma.rewardHousehold.findFirstOrThrow()).ownerSub).toBe(h);
      expect(await c.prisma.rewardHouseholdMember.count({ where: { memberSub: sub } })).toBe(0);
      expect((await c.prisma.rewardLot.findFirstOrThrow()).ownerSub).toBe(h);
      expect((await c.prisma.refundDestinationChoice.findFirstOrThrow()).sub).toBe(h);
      expect(await c.prisma.rewardLedgerEntry.count()).toBe(1);
      const old = new Date('2040-01-01T00:00:00Z');
      const purged = (await c.prisma.$queryRaw<{ r: Record<string, number> }[]>`SELECT growth_purge_expired_v2(${old}::timestamptz) AS r`)[0].r;
      expect(purged).toMatchObject({ refundChoicesDeleted: 1, goodwillGrantsDeleted: 1, checkoutLinesDeleted: 1 });
    });
  });

  describe('lifecycle, assistant, integrations', () => {
    it('lifecycle decisions are append-only; CHECKs on class and decision', async () => {
      const d = await c.prisma.lifecycleMessageDecision.create({ data: { sub: 's1', journeyKey: 'welcome', step: 1, messageClass: 'TRANSACTIONAL', channel: 'PUSH', templateKey: 't', decision: 'SEND', reason: 'OK' } });
      await rejects(c.prisma.lifecycleMessageDecision.update({ where: { id: d.id }, data: { reason: 'x' } }), /append-only/);
      await rejects(c.prisma.lifecycleMessageDecision.create({ data: { sub: 's1', journeyKey: 'w', step: 1, messageClass: 'PROMO', channel: 'PUSH', templateKey: 't', decision: 'SEND', reason: 'OK' } }), /class_check/);
      await rejects(c.prisma.lifecycleMessageDecision.create({ data: { sub: 's1', journeyKey: 'w', step: 1, messageClass: 'MARKETING', channel: 'PUSH', templateKey: 't', decision: 'MAYBE', reason: 'OK' } }), /decision_check/);
    });
    it('assistant turns and tool calls go with their session; one session per channel conversation', async () => {
      const s = await c.prisma.assistantSession.create({ data: { channelConversationId: 'cc1', phoneHash: 'ph', expiresAt: new Date(Date.now() + 1e6) } });
      await rejects(c.prisma.assistantSession.create({ data: { channelConversationId: 'cc1', phoneHash: 'ph', expiresAt: new Date() } }), /Unique constraint|unique/i);
      const t = await c.prisma.assistantTurn.create({ data: { sessionId: s.id, seq: 1, direction: 'IN', purgeAfter: new Date(Date.now() + 1e6) } });
      await rejects(c.prisma.assistantTurn.create({ data: { sessionId: s.id, seq: 1, direction: 'IN', purgeAfter: new Date() } }), /Unique constraint|unique/i);
      await c.prisma.assistantToolCall.create({ data: { turnId: t.id, tool: 'search_providers', resultKind: 'OK' } });
      await c.prisma.assistantSession.delete({ where: { id: s.id } });
      expect(await c.prisma.assistantTurn.count()).toBe(0); expect(await c.prisma.assistantToolCall.count()).toBe(0);
    });
    it('external metrics are unique per (market, kind, day, dimension, metric); integration CHECKs', async () => {
      const row = () => c.prisma.growthExternalMetricDaily.create({ data: { kind: 'googleads', day: new Date('2027-01-05'), dimensionKey: 'cmp_1', metric: 'impressions', value: 12 } });
      await row(); await rejects(row(), /Unique constraint|unique/i);
      await rejects(c.prisma.growthIntegrationRun.create({ data: { kind: 'ga4', status: 'WEIRD' } }), /status_check/);
      await rejects(c.prisma.growthIntegrationRun.create({ data: { kind: 'ga4', status: 'OK', mode: 'live' } }), /mode_check/);
      await rejects(c.prisma.growthIntegrationHealth.create({ data: { kind: 'ga4', circuit: 'HALF' } }), /circuit_check/);
    });
  });

  describe('erasure and retention cover every new table', () => {
    it('growth_erase_subject anonymises or deletes the person in every Phase 2 table and keeps ledger rows without a person', async () => {
      const sub = 'sub_erase_me'; const other = 'sub_keep_me';
      const rc = await c.prisma.referralCode.create({ data: { sub, code: '7K2M9X4Q' } });
      const rel = await c.prisma.referralRelationship.create({ data: { referrerSub: sub, refereeSub: other, codeId: rc.id, ruleVersionId: 'rv' } });
      await c.prisma.referralIdentitySignal.create({ data: { sub, kind: 'PHONE', valueHash: 'h1' } });
      const l = await lot({ sub, couponCodeHash: 'coupon' }); await entry(l.id, 'ISSUE', 5000);
      await c.prisma.patientLifecycle.create({ data: { sub, stage: 'REGISTERED', registeredAt: new Date() } });
      await c.prisma.lifecycleEnrollment.create({ data: { sub, journeyKey: 'welcome' } });
      await c.prisma.lifecycleMessageDecision.create({ data: { sub, journeyKey: 'welcome', step: 1, messageClass: 'TRANSACTIONAL', channel: 'PUSH', templateKey: 't', decision: 'SEND', reason: 'OK' } });
      const s = await c.prisma.assistantSession.create({ data: { channelConversationId: 'cc9', sub, phoneHash: 'ph', expiresAt: new Date(Date.now() + 1e6) } });
      await c.prisma.assistantTurn.create({ data: { sessionId: s.id, seq: 1, direction: 'IN', redactedText: 'hi', purgeAfter: new Date(Date.now() + 1e6) } });
      await c.prisma.patientLifecycle.create({ data: { sub: other, stage: 'REGISTERED', registeredAt: new Date() } });

      const r = await maint.eraseSubject(sub);
      expect(r).toMatchObject({ referralRelationshipsAnonymised: 1, referralCodesAnonymised: 1, identitySignalsDeleted: 1, rewardLotsAnonymised: 1, lifecycleRowsDeleted: 1, enrollmentsDeleted: 1, messageDecisionsAnonymised: 1, assistantSessionsDeleted: 1 });
      const h = (await c.prisma.$queryRaw<{ h: string }[]>`SELECT 'h:' || encode(sha256(convert_to(${sub}, 'UTF8')), 'hex') AS h`)[0].h;
      expect((await c.prisma.referralRelationship.findUniqueOrThrow({ where: { id: rel.id } })).referrerSub).toBe(h);
      expect(await c.prisma.referralCode.findFirstOrThrow()).toMatchObject({ sub: h, status: 'SUSPENDED' });
      expect(await c.prisma.rewardLot.findFirstOrThrow()).toMatchObject({ sub: h, couponCodeHash: null });
      expect(await c.prisma.rewardLedgerEntry.count()).toBe(1); // accounting rows stay
      expect((await c.prisma.lifecycleMessageDecision.findFirstOrThrow()).sub).toBe(h);
      expect(await c.prisma.patientLifecycle.count({ where: { sub } })).toBe(0);
      expect(await c.prisma.patientLifecycle.count({ where: { sub: other } })).toBe(1);
      expect(await c.prisma.assistantTurn.count()).toBe(0);
      const audit = await c.prisma.auditLog.findFirstOrThrow({ where: { action: 'growth.erase_subject' }, orderBy: { createdAt: 'desc' } });
      expect(JSON.stringify(audit)).not.toContain(sub);
    });
    it('growth_purge_expired_v2 purges assistant turns after purgeAfter, tool calls after 12 months, decisions after 24 months, old lots with their ledger after 7 years, and is idempotent', async () => {
      const now = new Date('2030-06-01T00:00:00Z'); const ago = (months: number) => new Date(now.getTime() - months * 30.5 * 86_400_000);
      const s = await c.prisma.assistantSession.create({ data: { channelConversationId: 'cc_p', phoneHash: 'ph', expiresAt: ago(1) } });
      const t1 = await c.prisma.assistantTurn.create({ data: { sessionId: s.id, seq: 1, direction: 'IN', purgeAfter: ago(1) } });
      await c.prisma.assistantTurn.create({ data: { sessionId: s.id, seq: 2, direction: 'OUT', purgeAfter: new Date(now.getTime() + 86_400_000) } });
      await c.prisma.assistantToolCall.create({ data: { turnId: t1.id, tool: 'get_slots', resultKind: 'OK', createdAt: ago(13) } });
      await c.prisma.lifecycleMessageDecision.create({ data: { sub: 's', journeyKey: 'w', step: 1, messageClass: 'TRANSACTIONAL', channel: 'PUSH', templateKey: 't', decision: 'SEND', reason: 'OK', at: ago(25) } });
      await c.prisma.lifecycleMessageDecision.create({ data: { sub: 's', journeyKey: 'w', step: 2, messageClass: 'TRANSACTIONAL', channel: 'PUSH', templateKey: 't', decision: 'SEND', reason: 'OK', at: ago(1) } });
      const old = await lot({ status: 'EXPIRED', expiresAt: ago(12 * 8) });
      await c.prisma.$executeRawUnsafe(`INSERT INTO "RewardLedgerEntry" ("id","lotId","type","amountMinor","idempotencyKey","ruleVersionId","reasonCode","actor","createdAt") VALUES ('led_old','${old.id}','ISSUE',100,'rwd:issue:old','rv','X','system','${ago(12 * 8).toISOString()}')`);
      const recent = await lot({ status: 'ACTIVE', expiresAt: ago(-6) }); await entry(recent.id, 'ISSUE', 100);
      const run = async () => (await c.prisma.$queryRaw<{ r: Record<string, number> }[]>`SELECT growth_purge_expired_v2(${now}::timestamptz) AS r`)[0].r;
      const r = await run();
      expect(r).toMatchObject({ assistantTurnsDeleted: 1, assistantToolCallsDeleted: 1, lifecycleDecisionsDeleted: 1, rewardLedgerEntriesDeleted: 1, rewardLotsDeleted: 1 });
      expect(await c.prisma.assistantTurn.count()).toBe(1);
      expect(await c.prisma.lifecycleMessageDecision.count()).toBe(1);
      expect(await c.prisma.rewardLot.count()).toBe(1);
      expect(await run()).toMatchObject({ assistantTurnsDeleted: 0, assistantToolCallsDeleted: 0, lifecycleDecisionsDeleted: 0, rewardLedgerEntriesDeleted: 0, rewardLotsDeleted: 0 });
      expect(await c.prisma.auditLog.count({ where: { action: 'growth.purge_expired_v2' } })).toBe(2);
      await rejects(c.prisma.$queryRaw`SELECT growth_purge_expired_v2(now(), 25, 13, 0)`, /retention values/);
    });
  });

  it('every Phase 2 migration is idempotent: applying each file a second time changes nothing and does not fail', async () => {
    const dir = join(__dirname, '..', 'prisma', 'migrations');
    const files = readdirSync(dir).filter((d) => /^20261203/.test(d)).sort();
    expect(files).toEqual(['20261203090000_growth_p2_campaigns', '20261203091000_growth_p2_referral_rewards', '20261203092000_growth_p2_lifecycle', '20261203093000_growth_p2_assistant', '20261203094000_growth_p2_integrations', '20261203095000_growth_p2_erase_retention_v2', '20261203096000_growth_p2_credit_ledger_v2']);
    const cl = new Client({ connectionString: testDatabaseUrl() }); await cl.connect();
    try { for (const f of files) { await cl.query(readFileSync(join(dir, f, 'migration.sql'), 'utf8')); await cl.query(readFileSync(join(dir, f, 'migration.sql'), 'utf8')); } } finally { await cl.end(); }
    expect(await c.prisma.growthCampaign.count()).toBe(0);
  });
});
