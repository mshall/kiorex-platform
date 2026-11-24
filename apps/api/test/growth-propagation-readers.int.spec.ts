import { createCtx, TestCtx } from './harness';
import { GrowthConfigService, GROWTH_DEFAULT_PAYLOADS } from '../src/growth/growth-public';
import { SeoConfigService } from '../src/public-site/seo-config.service';
import { WidgetPolicyService } from '../src/widget/widget-policy.service';

type Auth = { Authorization: string };

/** GRW-P1-K gap closed: the SEO renderer (package E) and the widget host (package G) report to the propagation monitor like the config service does. */
describe('propagation monitor: SEO renderer and widget host report the version they serve', () => {
  let c: TestCtx; let A: Auth; let B: Auth;
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => {
    await c.reset(); c.get(GrowthConfigService).invalidate(); c.get(SeoConfigService).invalidate(); c.get(WidgetPolicyService).invalidate();
    A = await c.as('adm_a', { roles: ['ops_admin', 'super_admin'] }); B = await c.as('adm_b', { roles: ['ops_admin', 'super_admin'] });
  });
  const api = (m: 'get' | 'post', path: string, who: Auth, body?: unknown) => { const r = c.http()[m](`/api/v1/ops/growth${path}`).set(who); return body === undefined ? r : r.send(body as object); };
  const activate = async (kind: string, payload: Record<string, unknown>) => {
    const d = (await api('post', '/config', A, { kind, scope: 'GLOBAL', payload, ticket: 'T-1', reason: 'test' }).expect(201)).body;
    await api('post', `/config/${d.id}/submit`, A).expect(200);
    return (await api('post', `/config/${d.id}/approve`, B).expect(200)).body;
  };

  it('SEO: the renderer appears as a reader with the active version, and the console says converged', async () => {
    const seo = { ...(GROWTH_DEFAULT_PAYLOADS.SEO as object), minLiveProviders: 4, templates: { en: { city: { title: '{specialty} in {city} | {brand}' } } }, paginatedIndexable: true } as Record<string, unknown>;
    const v = await activate('SEO', seo); // also proves the contract 1.11.0 schema + validateSeoExtensions accept the extension keys through maker-checker
    expect((await c.get(SeoConfigService).get('EG')).minLiveProviders).toBe(4);
    const p = (await api('get', '/config/propagation?kind=SEO&scope=GLOBAL&scopeId=', A).expect(200)).body;
    const r = p.readers.find((x: { reader: string }) => x.reader === 'seo-renderer');
    expect(r).toMatchObject({ reader: 'seo-renderer', versionId: v.id, upToDate: true });
    expect(p.converged).toBe(true);
  });

  it('SEO: a bad template is rejected before it is stored', async () => {
    const bad = { ...(GROWTH_DEFAULT_PAYLOADS.SEO as object), templates: { en: { city: { title: '{nme} in {city}' } } } };
    const r = await api('post', '/config', A, { kind: 'SEO', scope: 'GLOBAL', payload: bad, ticket: 'T-1', reason: 'test' });
    expect([r.status, r.body.code]).toEqual([422, 'GROWTH_CONFIG_INVALID']);
  });

  it('widget host: WIDGET_POLICY reads report as widget-host', async () => {
    const v = await activate('WIDGET_POLICY', { ...(GROWTH_DEFAULT_PAYLOADS.WIDGET_POLICY as object), maxOriginsPerOrg: 6 });
    expect((await c.get(WidgetPolicyService).get()).maxOriginsPerOrg).toBe(6);
    const p = (await api('get', '/config/propagation?kind=WIDGET_POLICY&scope=GLOBAL&scopeId=', A).expect(200)).body;
    expect(p.readers.find((x: { reader: string }) => x.reader === 'widget-host')).toMatchObject({ versionId: v.id, upToDate: true });
  });
});

/** GRW-P1-K gap closed: GROWTH_OVERVIEW_SOURCE is the real GrowthMetricsService once a rollup exists (k-anonymity applies), the raw tables before. */
describe('executive overview source (GROWTH_OVERVIEW_SOURCE)', () => {
  let c: TestCtx; let ops: Auth;
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => { await c.reset(); ops = await c.as('ops_1', { roles: ['ops_admin'] }); });
  const get = async () => (await c.http().get('/api/v1/ops/growth/overview?days=7').set(ops).expect(200)).body;

  it('before any rollup it says "internal" (raw tables); after a rollup it says analytics-v1 with masked small cells and real counts from 10 up', async () => {
    const { GrowthRollupService } = await import('../src/growth/growth-public');
    await c.prisma.growthEvent.createMany({ data: Array.from({ length: 12 }, (_, i) => ({ name: 'PageViewed', dedupeKey: `ov|${i}` })) });
    await c.prisma.growthEvent.create({ data: { name: 'SearchStarted', dedupeKey: 'ov|s' } });
    expect((await get()).source).toBe('internal');
    await c.get(GrowthRollupService).rollup({ days: 2 });
    const o = await get();
    expect(o.source).toBe('analytics-v1');
    expect(o.funnel.find((f: { name: string }) => f.name === 'PageViewed')).toMatchObject({ count: 12 });
    expect(o.funnel.find((f: { name: string }) => f.name === 'SearchStarted')).toMatchObject({ count: 0, masked: true }); // one search is a person: never shown
    expect(o.config.length).toBeGreaterThan(0);
  });
});
