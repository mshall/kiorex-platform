import { execSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Test support for the booking widget: build apps/widget when its dist is missing or older than its sources (real bundle, no mocks). */
const W = resolve(__dirname, '..', '..', 'widget');
const newest = (dir: string): number => readdirSync(dir).reduce((m, f) => { const p = join(dir, f); const s = statSync(p); return Math.max(m, s.isDirectory() ? newest(p) : s.mtimeMs); }, 0);

export function ensureWidgetBuild(): string {
  const manifest = join(W, 'dist/sdk/manifest.json');
  const src = newest(join(W, 'src'));
  const stale = !existsSync(manifest) || statSync(manifest).mtimeMs < src;
  if (stale) execSync('npm run build', { cwd: W, stdio: 'ignore' });
  return join(W, 'dist');
}
