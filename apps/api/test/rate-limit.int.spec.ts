import { createCtx, TestCtx } from './harness';
import { PgRateLimiter } from '../src/common/rate-limit';
import { PrismaService } from '../src/prisma/prisma.service';

describe('PgRateLimiter: the intake limits are shared across API instances (Postgres)', () => {
  let c: TestCtx; let db: PrismaService;
  beforeAll(async () => { c = await createCtx(); db = c.get(PrismaService); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => { await c.reset(); });

  it('two limiter instances (two API instances) share one counter; concurrent hits never over-admit', async () => {
    const a = new PgRateLimiter(db as any), b = new PgRateLimiter(db as any);
    const results = await Promise.all(Array.from({ length: 24 }, (_, i) => (i % 2 ? a : b).hit('ip:1.2.3.4', 5, 60_000)));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    const refused = results.find((r) => !r.ok)!;
    expect(refused.retryAfterSec).toBeGreaterThanOrEqual(1); expect(refused.retryAfterSec).toBeLessThanOrEqual(60);
    expect((await a.hit('ip:other', 5, 60_000)).ok).toBe(true); // keys are independent
    expect((await b.blocked('ip:1.2.3.4', 5, 60_000)).ok).toBe(false); // visible from the other instance
    expect(Number((await db.$queryRawUnsafe<{ count: number }[]>(`SELECT "count" FROM "RateLimitBucket" WHERE "key" LIKE 'ip:1.2.3.4|%'`))[0]!.count)).toBe(5); // refused hits are not counted
  });

  it('a new window starts a fresh count; Retry-After is the time to the window end; the sweeper removes expired rows', async () => {
    let now = Date.UTC(2026, 10, 24, 10, 0, 10);
    const l = new PgRateLimiter(db as any, () => now);
    expect((await l.hit('k', 1, 60_000)).ok).toBe(true);
    const r = await l.hit('k', 1, 60_000); expect(r.ok).toBe(false); expect(r.retryAfterSec).toBe(50);
    now += 50_000; expect((await l.hit('k', 1, 60_000)).ok).toBe(true);
    expect(await l.sweep()).toBe(0);
    now += 3_600_000; expect(await l.sweep()).toBe(2);
  });
});
