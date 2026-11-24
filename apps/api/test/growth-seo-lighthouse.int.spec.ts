import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createCtx, seedProvider, TestCtx } from './harness';
import { ensurePublicBundle, writeSpaShell } from './site-bundle';
import { SlugBootstrapService } from '../src/growth/seo/seo-public';
import { SeoAutomationService } from '../src/growth/seo-automation/seo-automation.service';
import { SeoVitalsService } from '../src/growth/seo-automation/vitals.service';

/**
 * GRW-P3-F Lighthouse on the real stack (OPT-IN: `KX_LIGHTHOUSE=1`, needs Chrome and the `lighthouse` package of apps/web). The SSR pages are served from this test's own Nest app on an ephemeral
 * loopback port (never 3000, 5173 or 5175), the SEO automation runs first so the computed links are in the HTML, `apps/web/scripts/lighthouse-audit.mjs` audits home, specialty hub, city hub, doctor and clinic
 * in AR and EN on a mobile profile, and the summary is ingested by the vitals service. The accessibility, SEO and best-practices categories are asserted against the lighthouserc budgets;
 * performance is lab data on a shared development machine and is recorded, not asserted.
 */
const on = process.env.KX_LIGHTHOUSE === '1';
(on ? describe : describe.skip)('SEO automation: Lighthouse over the SSR pages (AR and EN)', () => {
  let c: TestCtx; let port = 0;
  const prev: Record<string, string | undefined> = {};
  const setEnv = (k: string, v: string) => { if (!(k in prev)) prev[k] = process.env[k]; process.env[k] = v; };
  beforeAll(async () => {
    ensurePublicBundle();
    setEnv('SITE_ENVIRONMENT', 'production'); setEnv('SITE_CANONICAL_HOST', 'https://kiorex.test'); setEnv('SITE_SPA_SHELL', writeSpaShell());
    c = await createCtx(); await c.reset();
    const s = (key: string, o: Parameters<typeof seedProvider>[1]) => seedProvider(c, { id: `lst_${key}`, clinicianId: `dr_${key}`, ...o });
    await s('a', { clinicId: 'cl_a', specialty: 'paediatrics', nameEn: 'Dr Mona Fahmy', nameAr: 'د. منى فهمي', area: 'Maadi', governorate: 'Cairo', fee: 300, languages: ['ar', 'en'] });
    await s('b', { clinicId: 'cl_a', specialty: 'paediatrics', nameEn: 'Dr Hany Fawzy', nameAr: 'د. هاني فوزي', area: 'Maadi', governorate: 'Cairo', fee: 350, languages: ['ar'] });
    await s('c', { clinicId: 'cl_c', specialty: 'paediatrics', nameEn: 'Dr Dina Salem', nameAr: 'د. دينا سالم', area: 'Dokki', governorate: 'Cairo', fee: 280, languages: ['ar', 'en'] });
    await s('d', { clinicId: 'cl_d', specialty: 'cardiology', nameEn: 'Dr Omar Nabil', nameAr: 'د. عمر نبيل', area: 'Heliopolis', governorate: 'Cairo', fee: 400, languages: ['ar'] });
    await c.get(SlugBootstrapService).runOnce();
    await c.get(SeoAutomationService).run(); c.get(SeoAutomationService).invalidate();
    await c.app.listen(0, '127.0.0.1'); port = (c.app.getHttpServer().address() as AddressInfo).port;
  }, 240_000);
  afterAll(async () => { await c.close(); for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

  it('audits the five templates in both locales; accessibility, SEO and best-practices meet the budgets; the summary feeds the vitals page', async () => {
    const out = mkdtempSync(join(tmpdir(), 'kx-lh-')); const web = resolve(__dirname, '..', '..', 'web');
    const r = spawnSync('node', ['scripts/lighthouse-audit.mjs', '--base', `http://127.0.0.1:${port}`, '--runs', '1', '--only', 'mobile', '--out', out], { cwd: web, encoding: 'utf8', timeout: 600_000 });
    // eslint-disable-next-line no-console
    console.log(`lighthouse exit ${r.status}\n${r.stdout}${r.stderr.slice(0, 500)}`);
    expect(existsSync(join(out, 'summary.json'))).toBe(true);
    const rows = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8')) as { factor: string; locale: string; page: string; perf: number; a11y: number; bp: number; seo: number; lcp: number; cls: number; tbt: number }[];
    expect(rows).toHaveLength(10);
    for (const row of rows) { expect({ page: row.page, locale: row.locale, a11y: row.a11y >= 95 }).toEqual({ page: row.page, locale: row.locale, a11y: true }); expect({ page: row.page, locale: row.locale, seo: row.seo >= 95 }).toEqual({ page: row.page, locale: row.locale, seo: true }); expect({ page: row.page, locale: row.locale, bp: row.bp >= 95 }).toEqual({ page: row.page, locale: row.locale, bp: true }); }
    const v = c.get(SeoVitalsService);
    expect(await v.ingestLab(rows)).toMatchObject({ measured: true });
    const ov = await v.overview(); expect(ov.lab.measured).toBe(true); expect(ov.latest.filter((x) => x.source === 'LAB').length).toBeGreaterThan(10);
  }, 700_000);
});
