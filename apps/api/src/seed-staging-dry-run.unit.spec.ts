import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

/** Q10: `scripts/seed-staging.sh --dry-run` only prints the plan (offline), in dependency order. */
const script = join(__dirname, '../../../scripts/seed-staging.sh');
const run = (...args: string[]) => spawnSync('bash', [script, ...args], { encoding: 'utf8', env: { ...process.env, AWS_PROFILE: 'no-such-profile', PATH: '/usr/bin:/bin' } });
const steps = (out: string) => [...out.matchAll(/^\s+\d\. \[([a-z-]+)\]/gm)].map((m) => m[1]);

describe('seed-staging.sh --dry-run', () => {
  it('prints Passport -> Clinic -> Pharmacy -> Lab -> Kiorex sync -> Kiorex and executes nothing', () => {
    const r = run('--dry-run');
    expect(r.status).toBe(0);
    expect(steps(r.stdout)).toEqual(['passport', 'clinic', 'pharmacy', 'lab', 'kiorex-sync', 'kiorex']);
    expect(r.stdout).toContain('dry run: nothing was executed');
    expect(r.stdout).not.toMatch(/live\/prod/);
  });
  it('--only selects steps and unknown options fail', () => {
    expect(steps(run('--dry-run', '--only', 'lab,kiorex').stdout)).toEqual(['lab', 'kiorex']);
    expect(run('--bogus').status).toBe(2);
  });
});
