import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';

/**
 * Module-boundary test: bounded contexts reach each other ONLY through `<module>/<module>-public.ts` façades
 * (plus the shared kernel: common/, prisma/). No product imports another product's source, no @aws-sdk outside platform/adapters.
 */
const SRC = resolve(__dirname);
const SHARED = new Set(['common', 'prisma']);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') && !p.endsWith('.spec.ts') ? [p] : [];
  });
}
const moduleOf = (file: string) => relative(SRC, file).split(sep)[0];

describe('module boundaries', () => {
  const all = files(SRC);
  const importsOf = (f: string) => [...readFileSync(f, 'utf8').matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);

  it('cross-module imports go through *-public façades only', () => {
    const violations: string[] = [];
    for (const f of all) {
      const mod = moduleOf(f);
      if (!relative(SRC, f).includes(sep)) continue; // root files (app.module, main) may import module publics; checked below
      for (const spec of importsOf(f)) {
        if (!spec.startsWith('.')) continue;
        const target = resolve(dirname(f), spec);
        const rel = relative(SRC, target);
        if (rel.startsWith('..')) continue;
        const tmod = rel.split(sep)[0];
        if (tmod === mod || SHARED.has(tmod)) continue;
        if (!/-public$/.test(rel.split(sep).pop()!)) violations.push(`${relative(SRC, f)} -> ${spec}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('root files import module façades (or module classes) only, never module internals', () => {
    const bad: string[] = [];
    for (const f of all.filter((x) => !relative(SRC, x).includes(sep))) {
      for (const spec of importsOf(f)) {
        if (!spec.startsWith('./')) continue;
        const rel = spec.slice(2);
        if (!rel.includes('/')) continue;
        const [m, file] = rel.split('/');
        if (SHARED.has(m)) continue;
        if (!/(-public|\.module|\.controller)$/.test(file) && file !== 'health.module') bad.push(`${relative(SRC, f)} -> ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('every bounded context exposes a *-public façade', () => {
    const mods = readdirSync(SRC).filter((d) => statSync(join(SRC, d)).isDirectory() && !SHARED.has(d) && d !== 'health' && d !== 'ops' && d !== 'webhooks' && d !== 'phase2');
    for (const m of mods) expect(readdirSync(join(SRC, m))).toContain(`${m}-public.ts`);
  });

  it('the growth family (growth, public-site, widget) is registered, façaded, and reaches other contexts only through *-public', () => {
    const app = readFileSync(join(SRC, 'app.module.ts'), 'utf8');
    for (const [dir, cls] of [['growth', 'GrowthModule'], ['public-site', 'PublicSiteModule'], ['widget', 'WidgetModule']] as const) {
      expect(readdirSync(join(SRC, dir))).toContain(`${dir}-public.ts`);
      expect(app).toContain(`${cls} } from './${dir}/${dir}-public'`);
      expect(app).toMatch(new RegExp(`imports: \\[[^\\]]*\\b${cls}\\b`));
    }
    // nothing outside the growth family imports growth internals (only growth-public); the family never reaches into booking/pay internals
    for (const f of all) {
      if (['growth', 'public-site', 'widget'].includes(moduleOf(f))) continue;
      for (const spec of importsOf(f).filter((x) => /\/(growth|public-site|widget)\//.test(x))) expect(`${relative(SRC, f)} -> ${spec}`).toMatch(/-public$/);
    }
  });

  it('no AWS SDK outside src/platform/adapters; no imports of other products\' source', () => {
    for (const f of all) {
      for (const spec of importsOf(f)) {
        if (spec.startsWith('@aws-sdk/')) expect(relative(SRC, f).startsWith(join('platform', 'adapters'))).toBe(true);
        expect(spec).not.toMatch(/clinics-management|kiorly-(pharmacy|lab)|kiorex-account|_legacy/);
      }
    }
  });
});
