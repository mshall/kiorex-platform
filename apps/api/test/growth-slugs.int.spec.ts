import { createCtx, TestCtx } from './harness';
import { SlugService } from '../src/growth/growth-public';

describe('GrowthSlug service (history and 301 resolution)', () => {
  let c: TestCtx; let slugs: SlugService;
  beforeAll(async () => { c = await createCtx(); slugs = c.get(SlugService); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => { await c.reset(); });
  const code = async (p: Promise<unknown>) => { try { await p; return 'NO_ERROR'; } catch (e) { return (e as { getResponse(): { code: string } }).getResponse().code; } };

  it('ensure is idempotent per entity and the slug is lowercase ASCII (Arabic names transliterate)', async () => {
    const a = await slugs.ensure({ entityType: 'DOCTOR', entityId: 'd1', name: 'Dr. Omar El-Sayed' });
    expect(a).toBe('dr-omar-el-sayed');
    expect(await slugs.ensure({ entityType: 'DOCTOR', entityId: 'd1', name: 'A totally different name now' })).toBe(a); // never silently changes
    expect(await slugs.ensure({ entityType: 'CLINIC', entityId: 'c1', name: 'عيادة النور' })).toMatch(/^[a-z-]{4,}$/);
    expect(await slugs.ensure({ entityType: 'LAB', entityId: 'l_1', name: '' })).toMatch(/^lab-/);
  });
  it('two entities with the same name get -2, -3 (also under concurrency); the same name under another entity type is free', async () => {
    const got = await Promise.all(Array.from({ length: 6 }, (_, i) => slugs.ensure({ entityType: 'DOCTOR', entityId: `d${i}`, name: 'Dr Same Name' })));
    expect(new Set(got).size).toBe(6);
    expect(got.sort()[0]).toBe('dr-same-name');
    expect(got.filter((g) => /-\d$/.test(g)).length).toBe(5);
    expect(await slugs.ensure({ entityType: 'CLINIC', entityId: 'c1', name: 'Dr Same Name' })).toBe('dr-same-name');
    const same = await Promise.all(Array.from({ length: 5 }, () => slugs.ensure({ entityType: 'DOCTOR', entityId: 'dupe', name: 'Concurrent Same Entity' })));
    expect(new Set(same).size).toBe(1);
  });
  it('rename keeps the old slug in history: old answers REDIRECT 301 to the new one (single hop across several renames); the new one is CURRENT', async () => {
    await slugs.ensure({ entityType: 'DOCTOR', entityId: 'd1', name: 'Dr Old Name' });
    await slugs.rename({ entityType: 'DOCTOR', entityId: 'd1', newSlug: 'dr-second-name' });
    await slugs.rename({ entityType: 'DOCTOR', entityId: 'd1', newSlug: 'dr-third-name' });
    expect(await slugs.resolve('DOCTOR', 'dr-third-name')).toEqual({ kind: 'CURRENT', entityId: 'd1', slug: 'dr-third-name' });
    expect(await slugs.resolve('DOCTOR', 'dr-old-name')).toMatchObject({ kind: 'REDIRECT', to: 'dr-third-name', status: 301, entityId: 'd1' });
    expect(await slugs.resolve('DOCTOR', 'dr-second-name')).toMatchObject({ kind: 'REDIRECT', to: 'dr-third-name', status: 301 });
    expect(await slugs.resolve('DOCTOR', 'never-existed')).toBeNull();
    expect(await c.prisma.growthSlugHistory.count({ where: { entityId: 'd1' } })).toBe(2);
  });
  it('a slug in anyone\'s history is never given to another entity; re-adopting your own old slug works; invalid slugs and unknown types are refused', async () => {
    await slugs.ensure({ entityType: 'DOCTOR', entityId: 'd1', name: 'Dr One' });
    await slugs.rename({ entityType: 'DOCTOR', entityId: 'd1', newSlug: 'dr-one-new' });
    expect(await slugs.ensure({ entityType: 'DOCTOR', entityId: 'd2', name: 'Dr One' })).toBe('dr-one-2'); // dr-one belongs to d1's history
    expect(await code(slugs.rename({ entityType: 'DOCTOR', entityId: 'd2', newSlug: 'dr-one' }))).toBe('GROWTH_INVALID_REQUEST');
    await slugs.rename({ entityType: 'DOCTOR', entityId: 'd1', newSlug: 'dr-one' }); // back to its own
    expect(await slugs.resolve('DOCTOR', 'dr-one')).toMatchObject({ kind: 'CURRENT', entityId: 'd1' });
    expect(await slugs.resolve('DOCTOR', 'dr-one-new')).toMatchObject({ kind: 'REDIRECT', to: 'dr-one' });
    for (const bad of ['AB', 'has space', 'Upper', 'ab', '-lead', 'x'.repeat(61), 'عيادة']) expect(await code(slugs.rename({ entityType: 'DOCTOR', entityId: 'd1', newSlug: bad }))).toBe('GROWTH_INVALID_REQUEST');
    expect(await code(slugs.ensure({ entityType: 'PLANET', entityId: 'x' }))).toBe('GROWTH_INVALID_REQUEST');
  });
  it('markets are isolated: the same slug can exist in two markets for different entities', async () => {
    expect(await slugs.ensure({ entityType: 'CITY', entityId: 'cairo', name: 'Cairo', market: 'EG' })).toBe('cairo');
    expect(await slugs.ensure({ entityType: 'CITY', entityId: 'cairo-ae', name: 'Cairo', market: 'AE' })).toBe('cairo');
    expect(await slugs.resolve('CITY', 'cairo', 'AE')).toMatchObject({ entityId: 'cairo-ae' });
    expect(await slugs.resolve('CITY', 'cairo', 'EG')).toMatchObject({ entityId: 'cairo' });
  });
  it('release (entity removed) frees the slug and its history; a redirect whose entity vanished is a 404', async () => {
    await slugs.ensure({ entityType: 'CLINIC', entityId: 'c1', name: 'Clinic One' });
    await slugs.rename({ entityType: 'CLINIC', entityId: 'c1', newSlug: 'clinic-uno' });
    await slugs.release('CLINIC', 'c1');
    expect(await slugs.resolve('CLINIC', 'clinic-one')).toBeNull();
    expect(await slugs.ensure({ entityType: 'CLINIC', entityId: 'c2', name: 'Clinic One' })).toBe('clinic-one');
  });
});
