#!/usr/bin/env node
// Production-bundle hygiene for EVERY browser app of this repo: patient web, ops console, booking widget (app + SDK) and the public SSR site (client + server bundle).
//   node scripts/check-production-bundles.mjs [web|ops|widget|public ...]      (default: all)
// For each target it builds production into a temp dir, scans every text file and fails when it finds
//   1. a dev-only feature: the "Test users (dev only)" panel, synthetic demo logins / phones, the MSW service worker, mock-mode switches, dev inbox / dev-login routes;
//   2. a `localhost` / `127.0.0.1` / `.test` URL (a production build that silently falls back to a local service);
// and, so the check cannot pass vacuously, builds the web and ops apps in development mode and asserts the scan DOES see their localhost fallbacks there.
// Library-internal constants that mention localhost (react-router's URL base, the language detector's host regex) are listed in BENIGN with the reason.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MARKERS = ['Test users (dev only)', 'مستخدمو الاختبار (للتطوير فقط)', 'data-dev-test-users', 'Demo@12345', 'demo.kiorex.test', 'demo.kiorly.local', '+2010000000', 'mockServiceWorker', 'KX_DEV_', 'dev/inbox', 'dev-login', 'VITE_MOCK', 'sandbox-fake'];
/** Strings that legitimately contain "localhost" inside bundled libraries (not configuration). Each is removed before the scan. */
const BENIGN = [
  [/new URL\(`http:\/\/localhost`\)/g, 'react-router: base URL used to parse relative paths'],
  [/=`http:\/\/localhost`/g, 'react-router createLocation base'],
  [/=["']http:\/\/localhost["']/g, 'react-router createLocation base (double quotes)'],
  [/\|localhost\)\/i/g, 'i18next-browser-languagedetector: subdomain regex'],
  [/new URL\([a-z],`http:\/\/127\.0\.0\.1`\)/g, 'oidc-client-ts: base URL to read the query / fragment of a callback URL'],
];
const walk = (d) => (existsSync(d) ? readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; }) : []);
const textFiles = (dir) => walk(dir).filter((f) => /\.(js|mjs|cjs|html|json|css|webmanifest|svg|txt)$/.test(f));
const strip = (s) => BENIGN.reduce((acc, [re]) => acc.replace(re, ''), s);
// a URL that names a local service or a .test address; a bare hostname comparison such as `hostname === "localhost"` is not a pointer to one
const LOCAL = /(?:https?:)?\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])|https?:\/\/[^\s"'`\/]+\.test(?![\w(])|@[\w.-]+\.test(?![\w(])/;
const scan = (dir) => textFiles(dir).flatMap((f) => {
  const raw = readFileSync(f, 'utf8'); const out = [];
  for (const m of MARKERS) if (raw.includes(m)) out.push(`${f.replace(dir, '')}: dev-only marker "${m}"`);
  const s = strip(raw); const hit = LOCAL.exec(s);
  if (hit) out.push(`${f.replace(dir, '')}: local address "${s.slice(Math.max(0, hit.index - 50), hit.index + 40).replace(/\s+/g, ' ')}"`);
  return out;
});
const sh = (cwd, args, env = {}) => execFileSync('npx', args, { cwd, stdio: 'pipe', env: { ...process.env, ...env } });

const TARGETS = {
  web: { dev: true, build: (out, mode) => sh(join(root, 'apps/web'), ['vite', 'build', '--mode', mode, '--outDir', out, '--emptyOutDir'], { NODE_ENV: mode }) },
  ops: { dev: true, build: (out, mode) => sh(join(root, 'apps/ops'), ['vite', 'build', '--mode', mode, '--outDir', out, '--emptyOutDir'], { NODE_ENV: mode }) },
  widget: { build: (out) => { sh(join(root, 'apps/widget'), ['vite', 'build', '--config', 'vite.config.ts', '--outDir', join(out, 'app'), '--emptyOutDir']); sh(join(root, 'apps/widget'), ['vite', 'build', '--config', 'vite.sdk.config.ts', '--outDir', join(out, 'sdk'), '--emptyOutDir']); } },
  public: { build: (out) => { sh(join(root, 'apps/web'), ['vite', 'build', '--config', './vite.public.config.ts', '--outDir', join(out, 'client'), '--emptyOutDir']); sh(join(root, 'apps/web'), ['vite', 'build', '--config', './vite.public.config.ts', '--ssr', 'src/entry-server.tsx', '--outDir', join(out, 'server'), '--emptyOutDir']); } },
};
const want = process.argv.slice(2).filter((a) => a in TARGETS); const names = want.length ? want : Object.keys(TARGETS);
let failed = 0;
for (const name of names) {
  const t = TARGETS[name]; const prod = mkdtempSync(join(tmpdir(), `kx-${name}-prod-`));
  try {
    t.build(prod, 'production');
    const files = textFiles(prod).length; const found = scan(prod);
    if (!files) { console.error(`FAIL ${name}: the production build produced no files`); failed++; continue; }
    if (found.length) { console.error(`FAIL ${name}: dev-only content in the PRODUCTION bundle (${files} files scanned):\n  ${found.join('\n  ')}`); failed++; continue; }
    if (t.dev) { // sanity: the dev build must contain the local fallback, otherwise the scan proves nothing
      const dev = mkdtempSync(join(tmpdir(), `kx-${name}-dev-`));
      try { t.build(dev, 'development'); if (!scan(dev).some((x) => /local address/.test(x))) { console.error(`FAIL ${name}: sanity check, the development build shows no localhost fallback (the scan would pass vacuously)`); failed++; continue; } } finally { rmSync(dev, { recursive: true, force: true }); }
    }
    console.log(`OK   ${name}: ${files} files, no dev-only feature and no localhost in the production bundle`);
  } catch (e) { console.error(`FAIL ${name}: build error ${String(e.stderr ?? e.message).split('\n').slice(0, 6).join(' | ')}`); failed++; }
  finally { rmSync(prod, { recursive: true, force: true }); }
}
process.exit(failed ? 1 : 0);
