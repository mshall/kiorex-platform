import { createCtx, TestCtx } from './harness';
import { activateConfig } from './growth-helpers';
import { IntegrationService } from '../src/growth/integrations/integration.service';
import { IntegrationPullJob } from '../src/growth/integrations/jobs/pull.job';
import { GROWTH_DEFAULT_PAYLOADS } from '../src/growth/growth-public';
import { UpstreamError } from '../src/platform/platform-public';
import { mockFor } from '../src/growth/integrations/mock/mock.adapter';

type Auth = { Authorization: string };
const B = '/api/v1/admin/growth';
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

/** GRW-P2-F over the real HTTP stack and Postgres: mock runs, idempotency, partial failure and the breaker, fail-closed real mode, two-person real pulls, secrets never returned, flag OFF, roles, analytics numbers. */
describe('growth integrations and channel performance (GRW-P2-F)', () => {
  let c: TestCtx; let A: Auth; let Bd: Auth; let ops: Auth; let fin: Auth; let patient: Auth;
  const svc = () => c.get(IntegrationService);
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => {
    await c.reset(); c.flags.invalidate(); svc().adapterOverride = null; svc().sleep = async () => undefined;
    await c.prisma.growthExternalMetricDaily.deleteMany({}); await c.prisma.growthIntegrationRun.deleteMany({}); await c.prisma.growthIntegrationHealth.deleteMany({}); await c.prisma.growthCampaign.deleteMany({});
    A = await c.as('adm_a', { roles: ['ops_admin', 'super_admin'] }); Bd = await c.as('adm_b', { roles: ['ops_admin', 'super_admin'] }); ops = await c.as('ops_1', { roles: ['ops_admin'] }); fin = await c.as('fin_1', { roles: ['ops_admin', 'finance'] }); patient = await c.as('p_1');
  });
  const campaign = (key: string, status = 'ACTIVE') => c.prisma.growthCampaign.create({ data: { market: 'EG', key, utmCampaign: `eg-${key}`, name: key, objective: 'ACQUISITION', status, budgetTotalMinor: 1_000_000, budgetDailyMinor: 100_000, channels: ['SEO'], policyVersionId: 'seed', ownerSub: 'adm_a' } });
  const run = (kind: string, body: Record<string, unknown> = {}, who: Auth = A) => c.http().post(`${B}/integrations/${kind}/run`).set(who).send(body);
  const flagOff = async (key: string) => { const r = await c.http().put(`/api/v1/admin/flags/${key}/values`).set(A).send({ scope: 'GLOBAL', value: 'OFF', reason: 't', ticket: 'T-9', emergency: false }); expect([200, 202]).toContain(r.status); c.flags.invalidate(); };

  it('status lists the ten integrations in mock mode with secretRef presence as booleans only and a mock health', async () => {
    const r = await c.http().get(`${B}/integration-status`).set(ops).expect(200);
    expect(r.body.integrations).toHaveLength(10);
    for (const i of r.body.integrations) { expect(i).toMatchObject({ mode: 'mock', flagEffective: true, secretRefSet: false, circuit: 'CLOSED', connected: false }); expect(i.health.ok).toBe(true); }
  });
  it('a mock pull stores aggregates for the campaigns, records the run, and a second pull of the same window changes nothing (idempotent)', async () => {
    await campaign('ramadan'); const from = daysAgo(2); const to = today();
    const a = (await run('googleads', { from, to }).expect(200)).body;
    expect(a).toMatchObject({ kind: 'googleads', mode: 'mock', status: 'OK' }); expect(a.rows).toBeGreaterThan(0);
    const count = () => c.prisma.growthExternalMetricDaily.count({ where: { kind: 'googleads' } });
    const n1 = await count(); const keys = await c.prisma.growthExternalMetricDaily.findMany({ where: { kind: 'googleads' }, distinct: ['dimensionKey'], select: { dimensionKey: true } });
    expect(keys.map((k) => k.dimensionKey)).toEqual(['eg-ramadan']);
    const before = await c.prisma.growthExternalMetricDaily.aggregate({ where: { kind: 'googleads', metric: 'spend_minor' }, _sum: { value: true } });
    await run('googleads', { from, to }).expect(200);
    expect(await count()).toBe(n1);
    expect((await c.prisma.growthExternalMetricDaily.aggregate({ where: { kind: 'googleads', metric: 'spend_minor' }, _sum: { value: true } }))._sum.value).toEqual(before._sum.value);
    expect(await c.prisma.growthIntegrationRun.count({ where: { kind: 'googleads' } })).toBe(2);
    expect(await c.prisma.growthSpendEntry.count({ where: { source: 'ADAPTER' } })).toBe(0); // mock never writes spend lines
    expect(await c.prisma.auditLog.count({ where: { action: 'growth.integration.run' } })).toBe(2);
  });
  it('the run history and status show the last run as synthetic', async () => {
    await run('crux', {}).expect(200);
    const runs = (await c.http().get(`${B}/integration-runs?kind=crux`).set(ops).expect(200)).body; expect(runs[0]).toMatchObject({ kind: 'crux', status: 'OK', mode: 'mock' });
    const st = (await c.http().get(`${B}/integration-status`).set(ops).expect(200)).body.integrations.find((i: { kind: string }) => i.kind === 'crux'); expect(st).toMatchObject({ connected: true, synthetic: true });
  });
  it('a failing adapter makes a FAILED run, one IntegrationRunFailed event per run, opens the breaker at five, and the sixth call is refused until the cool-down', async () => {
    svc().adapterOverride = (k) => (k === 'searchconsole' ? mockFor('searchconsole', { failWith: new UpstreamError('UPSTREAM_STATUS', 500) }) : null);
    for (let i = 1; i <= 5; i++) { const r = (await run('searchconsole').expect(200)).body; expect(r).toMatchObject({ status: 'FAILED', reason: 'UPSTREAM_STATUS' }); }
    const h = await c.prisma.growthIntegrationHealth.findUniqueOrThrow({ where: { kind_market: { kind: 'searchconsole', market: 'EG' } } });
    expect(h).toMatchObject({ circuit: 'OPEN', consecutiveFailures: 5 });
    expect(await c.prisma.outboxEvent.count({ where: { type: 'IntegrationRunFailed' } })).toBe(5);
    expect((await run('searchconsole').expect(200)).body).toMatchObject({ status: 'SKIPPED', reason: 'CIRCUIT_OPEN' });
    expect(await c.prisma.growthIntegrationRun.count({ where: { kind: 'searchconsole' } })).toBe(5);
    // the cool-down passes, the probe succeeds, the breaker closes
    svc().adapterOverride = null;
    const r = await svc().run('searchconsole', { trigger: 'MANUAL', actor: 'adm_a', now: new Date(Date.now() + 31 * 60_000) }); expect(r.status).toBe('OK');
    expect((await c.prisma.growthIntegrationHealth.findUniqueOrThrow({ where: { kind_market: { kind: 'searchconsole', market: 'EG' } } })).circuit).toBe('CLOSED');
  });
  it('retries a transient upstream error with jittered backoff and then succeeds', async () => {
    let n = 0; const sleeps: number[] = []; svc().sleep = async (ms) => { sleeps.push(ms); };
    svc().adapterOverride = (k) => (k === 'crux' ? ({ kind: 'crux', mode: 'mock', health: async () => ({ ok: true, mode: 'mock', detail: '' }), pullCoreVitals: async (r: Parameters<ReturnType<typeof mockFor>['pullCoreVitals']>[0]) => { if (n++ < 2) throw new UpstreamError('UPSTREAM_TIMEOUT'); return mockFor('crux').pullCoreVitals(r); } } as never) : null);
    expect((await run('crux').expect(200)).body.status).toBe('OK'); expect(n).toBe(3); expect(sleeps).toHaveLength(2);
  });
  it('real mode without a resolvable secret fails closed with NEEDS_HUMAN, stores nothing and never calls the network', async () => {
    await activateConfig(c, 'INTEGRATION', { integrations: { ...(GROWTH_DEFAULT_PAYLOADS.INTEGRATION as { integrations: object }).integrations, googleads: { mode: 'real', secretRef: 'kiorex/googleads/token', accountLabel: '123', pullSchedule: 'daily', rateBudgetPerHour: 60, retentionDays: 395 } } });
    const req = (await c.http().post(`${B}/integrations/googleads/run-requests`).set(A).send({}).expect(201)).body;
    const r = (await run('googleads', { requestId: req.requestId }, Bd).expect(200)).body;
    expect(r).toMatchObject({ mode: 'real', status: 'FAILED', reason: 'NEEDS_HUMAN', rows: 0 });
    expect(await c.prisma.growthExternalMetricDaily.count({ where: { kind: 'googleads' } })).toBe(0);
    const st = (await c.http().get(`${B}/integration-status`).set(ops).expect(200)).body.integrations.find((i: { kind: string }) => i.kind === 'googleads');
    expect(st).toMatchObject({ mode: 'real', secretRefConfigured: true, secretRefSet: false, connected: false });
    expect(st.health.ok).toBe(false);
  });
  it('a real pull needs a request by one super admin and a confirmation by a different one; a request is single use', async () => {
    await activateConfig(c, 'INTEGRATION', { integrations: { ...(GROWTH_DEFAULT_PAYLOADS.INTEGRATION as { integrations: object }).integrations, metaads: { mode: 'real', secretRef: 'kiorex/meta/token', accountLabel: '9', pullSchedule: 'daily', rateBudgetPerHour: 60, retentionDays: 395 } } });
    expect((await run('metaads', {}).expect(400)).body.code).toBe('CONFIRMATION_REQUIRED');
    const req = (await c.http().post(`${B}/integrations/metaads/run-requests`).set(A).send({}).expect(201)).body;
    expect((await run('metaads', { requestId: req.requestId }, A).expect(403)).body.code).toBe('MAKER_CHECKER');
    await run('metaads', { requestId: req.requestId }, Bd).expect(200);
    expect((await run('metaads', { requestId: req.requestId }, Bd).expect(409)).body.code).toBe('REQUEST_USED');
    expect((await c.http().post(`${B}/integrations/crux/run-requests`).set(A).send({}).expect(400)).body.code).toBe('INTEGRATION_NOT_REAL');
  });
  it('a configured secret value never appears in any response', async () => {
    process.env.KIOREX_GOOGLEADS_TOKEN = 'SENTINEL-SECRET-VALUE-123';
    try {
      await activateConfig(c, 'INTEGRATION', { integrations: { ...(GROWTH_DEFAULT_PAYLOADS.INTEGRATION as { integrations: object }).integrations, googleads: { mode: 'real', secretRef: 'kiorex/googleads-token', accountLabel: '123', pullSchedule: 'daily', rateBudgetPerHour: 60, retentionDays: 395 } } });
      const st = await c.http().get(`${B}/integration-status`).set(A).expect(200);
      expect(st.body.integrations.find((i: { kind: string }) => i.kind === 'googleads')).toMatchObject({ secretRefSet: true }); expect(JSON.stringify(st.body)).not.toContain('SENTINEL');
      const t = await c.http().post(`${B}/integrations/googleads/test`).set(A).expect(200); expect(t.body).toMatchObject({ ok: true }); expect(JSON.stringify(t.body)).not.toContain('SENTINEL');
    } finally { delete process.env.KIOREX_GOOGLEADS_TOKEN; }
  });
  it('flag OFF skips the pull, keeps stored aggregates and the status says why', async () => {
    await run('crux').expect(200); const n = await c.prisma.growthExternalMetricDaily.count({ where: { kind: 'crux' } });
    await flagOff('growth.integrations.crux');
    expect((await run('crux').expect(200)).body).toMatchObject({ status: 'SKIPPED', reason: 'FLAG_OFF' });
    expect(await c.prisma.growthExternalMetricDaily.count({ where: { kind: 'crux' } })).toBe(n);
    expect((await c.http().get(`${B}/integration-status`).set(ops).expect(200)).body.integrations.find((i: { kind: string }) => i.kind === 'crux').flagEffective).toBe(false);
  });
  it('enforces the hourly request budget with 429', async () => {
    await activateConfig(c, 'INTEGRATION', { integrations: { ...(GROWTH_DEFAULT_PAYLOADS.INTEGRATION as { integrations: object }).integrations, crux: { mode: 'mock', secretRef: null, accountLabel: '', pullSchedule: 'daily', rateBudgetPerHour: 2, retentionDays: 395 } } });
    await run('crux').expect(200); await run('crux').expect(200); expect((await run('crux').expect(429)).body.code).toBe('INTEGRATION_RATE_BUDGET');
  });
  it('rejects bad ranges and unknown kinds with 4xx, not 500', async () => {
    await run('crux', { from: '2026-13-45' }).expect(400); await run('crux', { from: '2026-12-05', to: '2026-12-01' }).expect(400); await run('crux', { from: '2025-01-01', to: '2026-12-01' }).expect(400); await run('nope').expect(400);
    await c.http().get(`${B}/integration-runs?kind=nope`).set(ops).expect(400);
  });
  it('roles: reads for every growth ops role, pulls for super admin only, patients refused', async () => {
    for (const w of [ops, fin, A]) await c.http().get(`${B}/integration-status`).set(w).expect(200);
    await run('crux', {}, ops).expect(403); await run('crux', {}, fin).expect(403);
    await c.http().get(`${B}/integration-status`).set(patient).expect(403); await c.http().get(`${B}/channel-performance`).set(patient).expect(403);
  });
  it('the scheduled job runs each integration once a day, skips what is done, and purges expired aggregates', async () => {
    const job = c.get(IntegrationPullJob);
    const first = await job.runOnce(); expect(first.filter((r) => r.status === 'OK').length).toBe(10);
    const second = await job.runOnce(); expect(second.every((r) => r.reason === 'DONE_TODAY')).toBe(true);
    await c.prisma.growthExternalMetricDaily.create({ data: { market: 'EG', kind: 'crux', day: new Date('2020-01-01T00:00:00Z'), dimensionKey: 'old', metric: 'lcp_p75', value: 1 } });
    await svc().purgeExpired(); expect(await c.prisma.growthExternalMetricDaily.count({ where: { dimensionKey: 'old' } })).toBe(0);
  });

  describe('channel performance', () => {
    const fp = (campaign: string, metric: string, value: number, sourceKind = 'CAMPAIGN') => c.prisma.growthMetricDaily.create({ data: { market: 'EG', day: new Date(`${today()}T00:00:00Z`), metric, campaign, sourceKind, value } });
    it('with nothing connected every channel is "not connected", never zero', async () => {
      const r = (await c.http().get(`${B}/channel-performance`).set(ops).expect(200)).body;
      expect(r.channels).toHaveLength(10); expect(r.channels.every((x: { connected: boolean; metrics: unknown }) => !x.connected && x.metrics === null)).toBe(true);
      expect(r.notConnected).toHaveLength(10); expect(r.gaps).toContain('NO_INTEGRATION_CONNECTED');
    });
    it('shows external numbers beside first-party facts; CAC is hidden under k < 10 and printed from 10, with ROAS only for finance', async () => {
      await campaign('winter'); await run('googleads', { from: daysAgo(1), to: today() }).expect(200); await run('metaads', { from: daysAgo(1), to: today() }).expect(200);
      await fp('eg-winter', 'AttendedNewPatient', 4); await fp('eg-winter', 'BookingConfirmed', 6);
      let r = (await c.http().get(`${B}/channel-performance?from=${daysAgo(1)}&to=${today()}`).set(fin).expect(200)).body;
      let row = r.campaigns.find((x: { key: string }) => x.key === 'eg-winter');
      expect(row.external.spendMinor).toBeGreaterThan(0); expect(row.synthetic).toBe(true); expect(row.firstParty.attendedNewPatients).toBe('<10'); expect(row.cacMinor).toBe('<10'); expect(row.cacHidden).toBe('K_ANONYMITY'); expect(row.roas).toBe('<10');
      await c.prisma.growthMetricDaily.deleteMany({}); await fp('eg-winter', 'AttendedNewPatient', 12); await fp('eg-winter', 'BookingConfirmed', 20); await fp('eg-winter', 'RevenueMinor', 90_000);
      r = (await c.http().get(`${B}/channel-performance?from=${daysAgo(1)}&to=${today()}`).set(fin).expect(200)).body; row = r.campaigns.find((x: { key: string }) => x.key === 'eg-winter');
      expect(row.cacMinor).toBe(Math.round(row.spend.usedMinor / 12)); expect(row.spend.source).toBe('ADAPTER'); expect(row.roas).toBe(Math.round((90_000 / row.spend.usedMinor) * 100) / 100); expect(row.revenueToDateMinor).toBe(90_000);
      expect(r.blended.cacWithoutRewardsMinor).toBe(Math.round(r.blended.spendMinor / 12));
      const plain = (await c.http().get(`${B}/channel-performance?from=${daysAgo(1)}&to=${today()}`).set(ops).expect(200)).body.campaigns.find((x: { key: string }) => x.key === 'eg-winter');
      expect(plain.roas).toBeNull(); expect(plain.roasHidden).toBe('FINANCE_ONLY'); expect(plain.revenueToDateMinor).toBeNull(); expect(plain.cacMinor).toBe(row.cacMinor);
    });
    it('adapter spend wins over approved manual spend when they differ by more than 5 percent, and the note says so', async () => {
      const k = await campaign('delta'); await run('googleads', { from: today(), to: today() }).expect(200);
      const ext = (await c.prisma.growthExternalMetricDaily.aggregate({ where: { kind: 'googleads', dimensionKey: 'eg-delta', metric: 'spend_minor' }, _sum: { value: true } }))._sum.value!.toNumber();
      await c.prisma.growthSpendEntry.create({ data: { market: 'EG', day: new Date(`${today()}T00:00:00Z`), amountMinor: Math.round(ext * 0.5), campaign: 'eg-delta', channel: 'googleads', sourceKind: 'CAMPAIGN', status: 'APPROVED', createdBy: 'a', decidedBy: 'b', decidedAt: new Date(), campaignId: k.id, source: 'MANUAL' } as never });
      const row = (await c.http().get(`${B}/channel-performance?from=${today()}&to=${today()}`).set(ops).expect(200)).body.campaigns.find((x: { key: string }) => x.key === 'eg-delta');
      expect(row.spend).toMatchObject({ source: 'ADAPTER', conflict: true, note: 'ADAPTER_WINS', usedMinor: Math.round(ext) });
    });
    it('hides ratios under the spend floor and prints the denominators', async () => {
      await c.prisma.growthMetricDaily.deleteMany({}); await campaign('tiny'); await fp('eg-tiny', 'AttendedNewPatient', 30); await fp('eg-tiny', 'BookingConfirmed', 30);
      const row = (await c.http().get(`${B}/channel-performance`).set(fin).expect(200)).body.campaigns.find((x: { key: string }) => x.key === 'eg-tiny');
      expect(row.cacHidden).toBe('SPEND_FLOOR'); expect(row.cacMinor).toBe('<10'); expect(row.firstParty.attendedNewPatients).toBe(30); expect(row.spend.usedMinor).toBe(0);
    });
    it('blended CAC adds the cost of redeemed marketing rewards and shows both figures', async () => {
      await campaign('rw'); await run('googleads', { from: today(), to: today() }).expect(200); await fp('eg-rw', 'AttendedNewPatient', 20);
      const lot = await c.prisma.rewardLot.create({ data: { market: 'EG', sub: 's1', kind: 'PROMO', mode: 'COUPON', amountMinor: 20_000, ruleVersionId: 'rv', expiresAt: new Date(Date.now() + 86_400_000), funding: 'PLATFORM_MARKETING' } as never });
      await c.prisma.rewardLedgerEntry.create({ data: { lotId: lot.id, type: 'ISSUE', amountMinor: 20_000, idempotencyKey: `rwd:issue:t${Date.now()}`, ruleVersionId: 'rv', reasonCode: 'T', actor: 'sys' } as never });
      await c.prisma.rewardLedgerEntry.create({ data: { lotId: lot.id, type: 'RESERVE', amountMinor: 20_000, idempotencyKey: `rwd:reserve:t${Date.now()}`, ruleVersionId: 'rv', reasonCode: 'T', actor: 'sys' } as never });
      await c.prisma.rewardLedgerEntry.create({ data: { lotId: lot.id, type: 'REDEEM', amountMinor: 20_000, idempotencyKey: `rwd:redeem:t${Date.now()}`, ruleVersionId: 'rv', reasonCode: 'T', actor: 'sys' } as never });
      const b = (await c.http().get(`${B}/channel-performance?from=${today()}&to=${today()}`).set(ops).expect(200)).body.blended;
      expect(b.rewardCostMinor).toBe(20_000); expect(b.cacWithRewardsMinor).toBe(Math.round((b.spendMinor + 20_000) / 20)); expect(b.cacWithRewardsMinor).toBeGreaterThan(b.cacWithoutRewardsMinor);
    });
    it('organic search by page template and the app funnel appear only from connected adapters; no person-level field anywhere in the payload', async () => {
      await run('searchconsole', { from: today(), to: today() }).expect(200); await run('playconsole', { from: today(), to: today() }).expect(200); await run('appstoreconnect', { from: today(), to: today() }).expect(200);
      const r = (await c.http().get(`${B}/channel-performance?from=${today()}&to=${today()}`).set(fin).expect(200)).body;
      expect(r.organic.map((o: { template: string }) => o.template)).toEqual(expect.arrayContaining(['template:doctor', 'template:clinic'])); expect(r.appFunnel.storeConnected).toBe(true); expect(r.appFunnel.installsStore).toBeGreaterThan(0);
      expect(JSON.stringify(r)).not.toMatch(/"(sub|phone|email|bookingId|providerId|specialty|patientId)"/);
    });
  });
});
