import { DEFAULT_POOL_MAX, resolvePoolMax } from './client-factory';

describe('resolvePoolMax (explicit pg pool default, shared cluster has max_connections=100)', () => {
  const saved = process.env.DB_POOL_MAX;
  afterEach(() => { if (saved === undefined) delete process.env.DB_POOL_MAX; else process.env.DB_POOL_MAX = saved; });

  it('connection_limit in DATABASE_URL wins', () => { process.env.DB_POOL_MAX = '7'; expect(resolvePoolMax(3)).toBe(3); });
  it('falls back to DB_POOL_MAX, then to the explicit default of 10', () => {
    process.env.DB_POOL_MAX = '7'; expect(resolvePoolMax(Number.NaN)).toBe(7);
    delete process.env.DB_POOL_MAX; expect(resolvePoolMax(0)).toBe(DEFAULT_POOL_MAX); expect(DEFAULT_POOL_MAX).toBe(10);
  });
  it('ignores junk values', () => { process.env.DB_POOL_MAX = '-4'; expect(resolvePoolMax(Number.NaN)).toBe(DEFAULT_POOL_MAX); process.env.DB_POOL_MAX = 'abc'; expect(resolvePoolMax(Number.NaN)).toBe(DEFAULT_POOL_MAX); });
});
