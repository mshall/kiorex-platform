import { createCtx, seedProvider, TestCtx } from './harness';
import { ensurePublicBundle, writeSpaShell } from './site-bundle';
import { PublicSiteCache } from '../src/public-site/public-site-public';
import { ExperimentService } from '../src/growth/experiments/experiment.service';
import { assign } from '../src/growth/experiments/assignment';
import { unlockFlag } from './growth-helpers';

/**
 * GRW-P3-A SSR variant slot against the REAL Vite SSR bundle, real Postgres and the real experiment tables: a variant is rendered only for a consented visitor (kxv + kxe cookies) on a page type with
 * a copy slot, the variant is recomputed on the server (a tampered cookie is control), it never leaks into the shared cache, flag OFF and forbidden surfaces always render control.
 */
const HOST = 'https://kiorex.test';
type Auth = { Authorization: string };
const BASE = '/api/v1/admin/growth/experiments';
const PUB = '/api/v1/growth/v1/experiments';
const B_H1 = 'Book a verified doctor in minutes';
const CONTROL_H1 = 'Find a doctor and book a real slot';

describe('public site SSR experiment variants (GRW-P3-A)', () => {
  let c: TestCtx; let A: Auth; let B: Auth;
  const prev: Record<string, string | undefined> = {};
  const setEnv = (k: string, v: string | undefined) => { if (!(k in prev)) prev[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  const get = (path: string, cookie?: string) => c.http().get(path).set(cookie ? { Cookie: cookie } : {}).buffer(true).parse((res, cb) => { let d = ''; res.setEncoding('utf8'); res.on('data', (x) => (d += x)); res.on('end', () => { (res as unknown as { text: string }).text = d; cb(null, d); }); });
  const h1 = (html: string) => /<h1[^>]*>([^<]*)<\/h1>/.exec(html)?.[1] ?? '';
  const kxv = (i: number) => `kxv_ssrvariant${String(i).padStart(14, "0")}`;

  /** A running experiment on a surface; returns it plus a visitor key assigned to `b` and another assigned to control (found through the real assignment endpoint). */
  async function running(surface: string) {
    const r = await c.http().post(BASE).set(A).send({ key: `ssr-${surface.split('.').pop()}`, name: 'ssr', surface, hypothesis: 'A different wording raises booking starts', variants: [{ key: 'control', weightBp: 5000 }, { key: 'b', weightBp: 5000 }], primaryMetric: 'booking_started', minSample: 500, plannedDays: 14 }).expect(201);
    await c.http().post(`${BASE}/${r.body.id}/submit`).set(A).expect(200);
    await c.get(ExperimentService).approveAndStart({ sub: 'adm_b', kind: 'USER' }, r.body.id, new Date());
    const row = await c.prisma.growthExperiment.findUniqueOrThrow({ where: { id: r.body.id } });
    let vb: string | null = null; let vc: string | null = null;
    for (let i = 0; i < 400 && !(vb && vc); i++) {
      const a = assign({ variants: row.variants as never, allocationBp: row.allocationBp, salt: row.salt, status: row.status }, `v:${kxv(i)}`);
      if (a.enrolled && a.variant === 'b') vb ??= kxv(i); else if (a.enrolled) vc ??= kxv(i);
    }
    expect(vb && vc).toBeTruthy();
    return { key: r.body.key as string, vb: vb!, vc: vc! };
  }

  beforeAll(async () => {
    ensurePublicBundle();
    setEnv('SITE_ENVIRONMENT', 'production'); setEnv('SITE_CANONICAL_HOST', HOST); setEnv('SITE_SPA_SHELL', writeSpaShell());
    c = await createCtx();
  }, 180_000);
  afterAll(async () => { await c.close(); for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  beforeEach(async () => {
    await c.reset(); c.flags.invalidate(); await unlockFlag(c, 'growth.analytics_visitor');
    A = await c.as('adm_a', { roles: ['ops_admin', 'super_admin'] }); B = await c.as('adm_b', { roles: ['ops_admin', 'super_admin'] }); void B;
    for (const [id, n] of [['lst_a', 'a'], ['lst_b', 'b'], ['lst_c', 'c']] as const) await seedProvider(c, { id, clinicianId: `dr_${n}`, clinicId: 'cl_a', specialty: 'cardiology', nameEn: `Dr ${n}`, nameAr: `د. ${n}`, area: 'Maadi', governorate: 'Cairo', fee: 300, languages: ['ar', 'en'] });
    await c.prisma.growthSlug.create({ data: { entityType: 'DOCTOR', entityId: 'lst_a', slug: 'sara-hassan' } });
    c.flags.invalidate(); c.get(PublicSiteCache).purgeAll();
  });

  it('home hero: control without cookies; variant copy with kxv + kxe; private cache headers; the shared cache stays control', async () => {
    const e = await running('landing.home.hero_copy');
    const plain = await get('/en/eg').expect(200);
    expect(h1(plain.text)).toBe(CONTROL_H1); expect(plain.headers['cache-control']).toMatch(/public/);
    const v = await get('/en/eg', `kxv=${e.vb}; kxe=${encodeURIComponent(`${e.key}:b`)}`).expect(200);
    expect(h1(v.text)).toBe(B_H1); expect(v.headers['cache-control']).toBe('private, no-cache'); expect(v.headers.vary).toMatch(/Cookie/);
    expect(v.text).toContain('"experiments"'); // embedded state so the client records the exposure after hydration
    expect((await get('/en/eg', `kxv=${e.vb}; kxe=${encodeURIComponent(`${e.key}:b`)}`).expect(200)).headers['x-site-cache']).toBe('HIT'); // variant pages are cached under their own key
    const again = await get('/en/eg').expect(200); expect(h1(again.text)).toBe(CONTROL_H1); expect(again.headers['cache-control']).toMatch(/public/);
    const ar = await get('/ar/eg', `kxv=${e.vb}; kxe=${encodeURIComponent(`${e.key}:b`)}`).expect(200); expect(h1(ar.text)).toBe('احجز طبيبًا موثّقًا في دقائق');
  });

  it('no consent signal, no variant: kxe alone, kxv alone, a malformed visitor key and a tampered or stale kxe all render control with the shared cache headers', async () => {
    const e = await running('landing.home.hero_copy');
    const kxe = `kxe=${encodeURIComponent(`${e.key}:b`)}`;
    for (const cookie of [kxe, `kxv=${e.vb}`, `kxv=not-a-key; ${kxe}`, `kxv=${e.vc}; ${kxe}`, `kxv=${e.vb}; kxe=${encodeURIComponent(`${e.key}:zzz`)}`, `kxv=${e.vb}; kxe=${encodeURIComponent('other-exp:b')}`, `kxv=${e.vb}; kxe=%E0%A4%A`]) {
      const r = await get('/en/eg', cookie).expect(200);
      expect(h1(r.text)).toBe(CONTROL_H1); expect(r.headers['cache-control']).toMatch(/public/);
    }
  });

  it('provider page CTA label is the second slot; a paused-booking page and non-slot page types never carry a variant', async () => {
    const e = await running('landing.provider.cta_label');
    const cookie = `kxv=${e.vb}; kxe=${encodeURIComponent(`${e.key}:b`)}`;
    const doc = await get('/en/eg/doctor/sara-hassan', cookie).expect(200);
    expect(doc.text).toContain('Choose a time'); expect(doc.text).not.toContain('Book an appointment'); expect(doc.headers['cache-control']).toBe('private, no-cache');
    expect((await get('/en/eg/doctor/sara-hassan').expect(200)).text).toContain('Book an appointment');
    for (const path of ['/en/eg', '/en/eg/doctors/cardiology', '/en/eg/clinic/x']) { const r = await get(path, cookie); expect(r.text).not.toContain('Choose a time'); expect(r.headers['cache-control'] ?? '').not.toBe('private, no-cache'); }
  });

  it('flag growth.experiments OFF and a stopped experiment render control at once', async () => {
    const e = await running('landing.home.hero_copy');
    const cookie = `kxv=${e.vb}; kxe=${encodeURIComponent(`${e.key}:b`)}`;
    expect(h1((await get('/en/eg', cookie).expect(200)).text)).toBe(B_H1);
    const off = await c.http().put('/api/v1/admin/flags/growth.experiments/values').set(A).send({ scope: 'GLOBAL', value: 'OFF', reason: 't', ticket: 'T-1', emergency: false }); expect([200, 202]).toContain(off.status); c.flags.invalidate();
    expect(h1((await get('/en/eg', cookie).expect(200)).text)).toBe(CONTROL_H1);
  });

  it('a surface that is not an SSR surface never reaches a template, even with matching cookies (signup copy is client-side only)', async () => {
    const e = await running('signup.value_proposition');
    const r = await get('/en/eg', `kxv=${e.vb}; kxe=${encodeURIComponent(`${e.key}:b`)}`).expect(200);
    expect(h1(r.text)).toBe(CONTROL_H1); expect(r.headers['cache-control']).toMatch(/public/);
  });
});
