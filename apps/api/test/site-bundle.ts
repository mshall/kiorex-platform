import { execSync } from 'node:child_process';
import { existsSync, readdirSync, statSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** Test support for the public site: build the SSR bundle and the public client when missing or older than their sources (real bundle, no mocks). */
const WEB = resolve(__dirname, '..', '..', 'web');
const newest = (dir: string): number => readdirSync(dir).reduce((m, f) => { const p = join(dir, f); const s = statSync(p); return Math.max(m, s.isDirectory() ? newest(p) : s.mtimeMs); }, 0);

export function ensurePublicBundle(): { server: string; client: string } {
  const server = join(WEB, 'dist-public/server/entry-server.cjs');
  const client = join(WEB, 'dist-public/client/.vite/manifest.json');
  const srcTime = Math.max(newest(join(WEB, 'src/public')), statSync(join(WEB, 'src/entry-server.tsx')).mtimeMs, statSync(join(WEB, 'src/entry-client.tsx')).mtimeMs);
  const stale = !existsSync(server) || !existsSync(client) || statSync(server).mtimeMs < srcTime || statSync(client).mtimeMs < srcTime;
  if (stale) execSync('npm run build:public', { cwd: WEB, stdio: 'ignore' });
  return { server, client };
}

/** A tiny SPA shell file standing in for apps/web/dist/index.html (the fallback and flag-OFF response). */
export function writeSpaShell(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kx-shell-'));
  const f = join(dir, 'index.html');
  writeFileSync(f, '<!doctype html><html lang="ar"><head><meta charset="utf-8"><title>Kiorex SPA shell</title></head><body><div id="root"></div></body></html>');
  return f;
}
