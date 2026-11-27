import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** `npm run lint:hosts` (scripts/lint-hosts.mjs): the strict, CI-ready host-literal scan (ADR-059). */
const SCRIPT = resolve(__dirname, '..', '..', '..', '..', 'scripts', 'lint-hosts.mjs');

describe('lint:hosts strict scan', () => {
  it('passes on the repository', () => {
    expect(execFileSync(process.execPath, [SCRIPT], { encoding: 'utf8' })).toContain('lint:hosts OK');
  });
  it('fails (exit 1) on a planted literal, names the file, and allows the config file', () => {
    const root = mkdtempSync(join(tmpdir(), 'kx-lint-'));
    mkdirSync(join(root, 'apps/api/src/common'), { recursive: true });
    writeFileSync(join(root, 'apps/api/src/common/hosts.ts'), "export const a = 'https://kiorex.com';\n");
    writeFileSync(join(root, 'apps/api/src/x.ts'), "// https://kiorex.com in a comment is fine\nexport const b = 'https://book.kiorex.com';\nexport const s = 'https://schemas.kiorex.com/events/v1';\n");
    const r = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('apps/api/src/x.ts:2  book.kiorex.com');
    expect(r.stderr).not.toContain('hosts.ts');
    expect(r.stderr).not.toContain('schemas.');
  });
});
