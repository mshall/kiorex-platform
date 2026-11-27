import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * ADR-059 guard: runtime code carries no network host literal outside the allow-listed config files. Mirrors the workspace scanner
 * (`_docs/registry/validate-registry.mjs --scan`): a quoted string or URL naming kiorex.com, kiorly.com or kiorly.link. Frozen event identifiers
 * (`schemas.*`) are not network hosts and are ignored. To add a host: put it in the registry, resolve it from env in a config file below.
 */
const ROOT = resolve(__dirname, '..', '..', '..', '..'); // kiorex-platform
const ALLOW = new Set([
  'apps/api/src/common/hosts.ts',
  'apps/web/src/lib/hosts.ts',
  'apps/ops/src/lib/hosts.ts',
]);
const SCAN_DIRS = ['apps/api/src', 'apps/web/src', 'apps/ops/src', 'apps/mobile/src', 'apps/widget/src'];
const SCAN_FILES = ['apps/mobile/app.config.ts', 'apps/api/.env.example', 'apps/api/src/main.ts'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '__tests__', 'tests', 'test', 'demo', 'generated']);
const SKIP_FILE = /(\.test\.|\.spec\.|\.d\.ts$|\.json$|\.md$|\.html$|\.map$|\.snap$)/;
const DOMAIN_RE = /(?:https?:\/\/|["'`])((?:[a-z0-9-]+\.)*(?:kiorex\.com|kiorly\.com|kiorly\.link))\b/gi;

export function findHostLiterals(src: string): string[] {
  const out: string[] = [];
  src.split('\n').forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('#')) return;
    for (const m of line.matchAll(DOMAIN_RE)) {
      if (m[1].toLowerCase().startsWith('schemas.')) continue;
      out.push(`${i + 1}:${m[1].toLowerCase()}`);
    }
  });
  return out;
}

function walk(dir: string, acc: string[]): string[] {
  let ents;
  try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of ents) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p, acc); continue; }
    if (/\.(ts|tsx|js|mjs|cjs)$/.test(e.name) && !SKIP_FILE.test(e.name)) acc.push(p);
  }
  return acc;
}

describe('no host literal in runtime code outside the allow-listed config files', () => {
  it('scanner detects a literal and ignores frozen schema identifiers and comments', () => {
    expect(findHostLiterals(`const a = 'https://api.kiorex.com/x';`)).toEqual(['1:api.kiorex.com']);
    expect(findHostLiterals('const b = "kiorly.link";')).toEqual(['1:kiorly.link']);
    expect(findHostLiterals('const t = "https://schemas.kiorex.com/events/v1";')).toEqual([]);
    expect(findHostLiterals('// see https://kiorex.com')).toEqual([]);
  });

  it('finds no literal in the platform runtime code', () => {
    const files = [...SCAN_DIRS.flatMap((d) => walk(join(ROOT, d), [])), ...SCAN_FILES.map((f) => join(ROOT, f))];
    expect(files.length).toBeGreaterThan(100);
    const offenders: string[] = [];
    for (const f of new Set(files)) {
      const rel = relative(ROOT, f).split('\\').join('/');
      if (ALLOW.has(rel)) continue;
      let src: string;
      try { src = readFileSync(f, 'utf8'); } catch { continue; }
      for (const h of findHostLiterals(src)) offenders.push(`${rel}:${h}`);
    }
    expect(offenders).toEqual([]);
  });

  it('allow-listed config files exist', () => {
    for (const a of ALLOW) expect(() => readFileSync(join(ROOT, a), 'utf8')).not.toThrow();
  });
});
