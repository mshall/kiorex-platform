import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { createCtx, TestCtx } from './harness';
import { testDatabaseUrl } from './db-url';

/** GRW-P3-E schema (migration 20270128090000_growth_p3_automation_recommendations, the slot reserved by the work packages for exactly this package). Real Postgres. */
describe('growth P3-E schema (wave 8, automation and recommendations)', () => {
  let c: TestCtx;
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => { await c.reset(); });
  const def = (o: Record<string, unknown> = {}) => c.prisma.lifecycleJourneyDefinition.create({ data: { key: 'k-one', graph: {}, checksum: 'c', createdBy: 'a', ...o } as never });

  it('the three tables exist and none has a person column', async () => {
    const cols = await c.prisma.$queryRaw<{ table_name: string; column_name: string }[]>`SELECT table_name, column_name FROM information_schema.columns WHERE table_name IN ('LifecycleJourneyDefinition', 'LifecycleJourneyRunLog', 'GrowthRecommendation')`;
    expect([...new Set(cols.map((x) => x.table_name))].sort()).toEqual(['GrowthRecommendation', 'LifecycleJourneyDefinition', 'LifecycleJourneyRunLog']);
    for (const x of cols) expect(x.column_name).not.toMatch(/^(sub$|subject|phone|email|patient|userId|address)/i);
  });
  it('only one PUBLISHED version per (market, key); a published row needs an approver and a time; the approver is not the author', async () => {
    await def({ version: 1, status: 'PUBLISHED', approvedBy: 'b', publishedAt: new Date() });
    await expect(def({ version: 2, status: 'PUBLISHED', approvedBy: 'b', publishedAt: new Date() })).rejects.toThrow();
    await expect(def({ key: 'k-two', status: 'PUBLISHED' })).rejects.toThrow(/published_check/);
    await expect(def({ key: 'k-three', approvedBy: 'a' })).rejects.toThrow(/maker_checker/);
    await expect(def({ key: 'K_BAD' })).rejects.toThrow(/key_check/);
    await expect(def({ key: 'k-four', status: 'LIVE' })).rejects.toThrow(/status_check/);
  });
  it('the run log is counts only: no negative count, one row per journey and day, no orphan', async () => {
    const d = await def();
    await c.prisma.lifecycleJourneyRunLog.create({ data: { definitionId: d.id, day: new Date('2027-02-01') } });
    await expect(c.prisma.lifecycleJourneyRunLog.create({ data: { definitionId: d.id, day: new Date('2027-02-01') } })).rejects.toThrow();
    await expect(c.prisma.lifecycleJourneyRunLog.create({ data: { definitionId: d.id, day: new Date('2027-02-02'), sent: -1 } })).rejects.toThrow(/counts_check/);
    await expect(c.prisma.lifecycleJourneyRunLog.create({ data: { definitionId: 'nope', day: new Date('2027-02-03') } })).rejects.toThrow();
  });
  it('replays idempotently (twice) and sorts after every earlier migration with a unique prefix', async () => {
    const dir = join(__dirname, '..', 'prisma', 'migrations'); const f = '20270128090000_growth_p3_automation_recommendations';
    const cl = new Client({ connectionString: testDatabaseUrl() }); await cl.connect();
    try { const sql = readFileSync(join(dir, f, 'migration.sql'), 'utf8'); await cl.query(sql); await cl.query(sql); } finally { await cl.end(); }
    const names = readdirSync(dir).filter((x) => /^\d{14}_/.test(x)).sort(); const prefixes = names.map((n) => n.slice(0, 14));
    expect(new Set(prefixes).size).toBe(prefixes.length);
    expect(names.filter((n) => n < f).every((n) => n.slice(0, 8) <= '20270107')).toBe(true);
  });
});
