import { PageCache, type CachedResponse } from './page-cache';
import { SiteMetrics } from './metrics';

const r = (tags: string[] = []): CachedResponse => ({ status: 200, headers: {}, body: 'x', etag: 'W/"1"', tags });

describe('page cache and metrics', () => {
  it('expires entries after the TTL, evicts the least recently used, and counts hits and misses', () => {
    let now = 0;
    const c = new PageCache(2, 1000, () => now);
    c.set('a', r()); c.set('b', r());
    expect(c.get('a')).toBeDefined();
    c.set('c', r()); // evicts b (a was touched)
    expect(c.get('b')).toBeUndefined();
    expect(c.get('c')).toBeDefined();
    now = 5000;
    expect(c.get('a')).toBeUndefined();
    expect(c.hits).toBe(2); expect(c.misses).toBe(2);
  });
  it('purges by tag and returns the removed keys (the CDN purge paths)', () => {
    const c = new PageCache(10, 1000);
    c.set('/en/eg/doctor/a', r(['provider:1'])); c.set('/en/eg/doctors/x', r(['list', 'provider:1'])); c.set('/en/eg/doctor/b', r(['provider:2']));
    expect(c.purgeTags(['provider:1']).sort()).toEqual(['/en/eg/doctor/a', '/en/eg/doctors/x']);
    expect(c.size).toBe(1);
    expect(c.clear()).toBe(1);
  });
  it('metrics: render percentiles, hit ratio and Prometheus text', () => {
    const m = new SiteMetrics();
    [10, 20, 30, 40, 100].forEach((x) => m.observeRender(x));
    m.inc('cache_hit', 3);
    const s = m.snapshot({ hits: 3, misses: 1, size: 4 });
    expect(s.render).toMatchObject({ count: 5, p50Ms: 30, p95Ms: 100, maxMs: 100 });
    expect(s.cache.hitRatio).toBe(0.75);
    expect(m.prometheus({ hits: 3, misses: 1, size: 4 })).toContain('kx_site_cache_hit_total 3');
  });
});
