#!/usr/bin/env node
// Strict host-literal lint for the platform (ADR-059, ENVIRONMENT_CONFIGURATION_STANDARD rule 1). CI-ready and self-contained: it needs no workspace registry.
// Equivalent of `_docs/registry/validate-registry.mjs --scan --strict` restricted to this repository: any quoted string or URL naming kiorex.com, kiorly.com or
// kiorly.link in runtime code, outside the allow-listed config files, fails the run (exit 1). Frozen event identifiers (schemas.*) and comments are ignored.
//   node scripts/lint-hosts.mjs [--root <dir>] [--json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ALLOW = new Set(['apps/api/src/common/hosts.ts', 'apps/web/src/lib/hosts.ts', 'apps/ops/src/lib/hosts.ts']);
export const SCAN_DIRS = ['apps/api/src', 'apps/web/src', 'apps/ops/src', 'apps/mobile/src', 'apps/widget/src', 'scripts'];
export const SCAN_FILES = ['apps/mobile/app.config.ts', 'apps/api/.env.example', 'apps/api/docker-entrypoint.mjs'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '__tests__', 'tests', 'test', 'demo', 'generated']);
const SKIP_FILE = /(\.test\.|\.spec\.|\.d\.ts$|\.json$|\.md$|\.html$|\.map$|\.snap$)/;
const DOMAIN_RE = /(?:https?:\/\/|["'`])((?:[a-z0-9-]+\.)*(?:kiorex\.com|kiorly\.com|kiorly\.link))\b/gi;

export function findHostLiterals(src) {
  const out = [];
  src.split('\n').forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('#')) return;
    for (const m of line.matchAll(DOMAIN_RE)) { const h = m[1].toLowerCase(); if (!h.startsWith('schemas.')) out.push({ line: i + 1, host: h }); }
  });
  return out;
}

function walk(dir, acc) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p, acc); continue; }
    if (/\.(ts|tsx|js|mjs|cjs|env|example)$/.test(e.name) && !SKIP_FILE.test(e.name)) acc.push(p);
  }
  return acc;
}

export function scan(root) {
  const files = new Set([...SCAN_DIRS.flatMap((d) => walk(path.join(root, d), [])), ...SCAN_FILES.map((f) => path.join(root, f)).filter((f) => fs.existsSync(f))]);
  const offenders = [];
  for (const f of files) {
    const rel = path.relative(root, f).split(path.sep).join('/');
    if (ALLOW.has(rel)) continue;
    for (const h of findHostLiterals(fs.readFileSync(f, 'utf8'))) offenders.push({ file: rel, ...h });
  }
  return { scanned: files.size, offenders };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const root = path.resolve(a.includes('--root') ? a[a.indexOf('--root') + 1] : path.join(here, '..'));
  const r = scan(root);
  if (a.includes('--json')) console.log(JSON.stringify(r));
  else if (r.offenders.length) { console.error(`lint:hosts FAILED: ${r.offenders.length} host literal(s) outside the allow-listed config files (put the host in the registry and read it from env in common/hosts.ts):`); for (const o of r.offenders) console.error(`  ${o.file}:${o.line}  ${o.host}`); }
  else console.log(`lint:hosts OK (${r.scanned} files scanned, no host literal outside ${[...ALLOW].join(', ')})`);
  process.exit(r.offenders.length ? 1 : 0);
}
