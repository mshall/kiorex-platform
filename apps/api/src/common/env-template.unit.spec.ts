import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** kx-test environment template and the registry generator (ADR-059). The scripts are ESM tools, so they run as child processes. */
const ROOT = resolve(__dirname, '..', '..', '..', '..');
const VALIDATE = join(ROOT, 'scripts', 'validate-env-template.mjs');
const EMIT = join(ROOT, 'scripts', 'emit-env-from-registry.mjs');
const REGISTRY_TOOL = resolve(ROOT, '..', '_docs', 'registry', 'validate-registry.mjs');
const TEMPLATE = readFileSync(join(ROOT, 'apps/api/env/kx-test.env.template'), 'utf8');
const CONTAINERS = JSON.parse(readFileSync(join(ROOT, 'apps/api/env/kx-test.containers.json'), 'utf8'));

function check(template: string, containers: unknown = CONTAINERS): string[] {
  const code = `import('${VALIDATE}').then(m => { const t = JSON.parse(process.env.T); console.log(JSON.stringify(m.validate({ template: t.template, containers: t.containers, known: m.knownNames() }))); })`;
  const out = execFileSync(process.execPath, ['-e', code], { env: { ...process.env, T: JSON.stringify({ template, containers }) }, encoding: 'utf8' });
  return JSON.parse(out.trim().split('\n').pop() as string);
}

describe('kx-test env template', () => {
  it('the shipped template and containers file are valid', () => expect(check(TEMPLATE)).toEqual([]));
  it('CLI exits 0 on the shipped template', () => { expect(execFileSync(process.execPath, [VALIDATE], { encoding: 'utf8' })).toContain('env template OK'); });

  it('rejects a plaintext secret without echoing its value', () => {
    const errs = check(TEMPLATE.replace(/^FIELD_ENCRYPTION_KEY=.*$/m, 'FIELD_ENCRYPTION_KEY=SuperSecretValue123'));
    expect(errs.join('\n')).toContain('FIELD_ENCRYPTION_KEY: a secret must be a reference');
    expect(errs.join('\n')).not.toContain('SuperSecretValue123');
  });
  it('rejects a typed host or origin', () => {
    expect(check(TEMPLATE.replace(/^CORS_ORIGINS=.*$/m, 'CORS_ORIGINS=https://x.example.com')).join()).toContain('CORS_ORIGINS');
    expect(check(TEMPLATE + 'SOME_WEBHOOK=https://hooks.kiorex.com/x\n').join()).toContain('host literal');
  });
  it('keeps providers mock', () => {
    expect(check(TEMPLATE.replace('SMS_MODE=mock', 'SMS_MODE=real')).join()).toContain('SMS_MODE: kx-test stays on mock providers');
    expect(check(TEMPLATE.replace('AI_PROVIDER=fake', 'AI_PROVIDER=openai')).join()).toContain('AI_PROVIDER');
  });
  it('rejects unknown names and missing required names', () => {
    expect(check(TEMPLATE + 'NOT_A_REAL_API_SETTING=1\n').join()).toContain('NOT_A_REAL_API_SETTING: not read anywhere');
    expect(check(TEMPLATE.replace(/^RX_VERIFY_HMAC_SECRET=.*\n/m, '')).join()).toContain('RX_VERIFY_HMAC_SECRET: required name missing');
  });
  it('JOBS_ENABLED must be true on exactly one container', () => {
    const mk = (flags: string[]) => ({ containers: flags.map((f, i) => ({ name: `c${i}`, env: { JOBS_ENABLED: f } })) });
    expect(check(TEMPLATE, mk(['true', 'false'])).join()).toBe('');
    expect(check(TEMPLATE, mk(['true', 'true'])).join()).toContain('exactly one container (found 2)');
    expect(check(TEMPLATE, mk(['false', 'false'])).join()).toContain('exactly one container (found 0)');
    expect(check(TEMPLATE.replace('JOBS_ENABLED=false', 'JOBS_ENABLED=true'), mk(['false'])).join()).toContain('JOBS_ENABLED must default to false');
  });
  it('never allows the host-fallback override and requires every host variable', () => {
    expect(check(TEMPLATE + 'ALLOW_HOST_DEFAULTS=true\n').join()).toContain('ALLOW_HOST_DEFAULTS must not be set');
    expect(check(TEMPLATE.replace(/^CREATIVE_CDN_HOST=.*\n/m, '')).join()).toContain('CREATIVE_CDN_HOST: required name missing');
    expect(check(TEMPLATE.replace(/^PROVIDER_LINK_BASE_URL=.*$/m, 'PROVIDER_LINK_BASE_URL=https://x.example.com')).join()).toContain('PROVIDER_LINK_BASE_URL');
  });
  it('never allows insecure-secret or public-indexing flags', () => {
    expect(check(TEMPLATE + 'ALLOW_INSECURE_DEFAULT_SECRETS=true\n').join()).toContain('ALLOW_INSECURE_DEFAULT_SECRETS must not be set');
    expect(check(TEMPLATE.replace('SITE_ENVIRONMENT=test', 'SITE_ENVIRONMENT=production')).join()).toContain('indexable');
  });
});

const hasRegistry = existsSync(REGISTRY_TOOL);
(hasRegistry ? describe : describe.skip)('registry generator (needs the workspace registry)', () => {
  const out = hasRegistry ? mkdtempSync(join(tmpdir(), 'kx-env-')) : '';
  it('generates env files and OIDC redirect lists for test, pilot and prod; --check is clean', () => {
    execFileSync(process.execPath, [EMIT, '--env', 'all', '--out', out], { encoding: 'utf8' });
    for (const e of ['test', 'pilot', 'prod']) {
      const api = readFileSync(join(out, e, 'api.env'), 'utf8');
      expect(api).toMatch(/^CORS_ORIGINS=https:\/\//m);
      expect(api).not.toMatch(/localhost|http:\/\//);
      expect(api).toContain(`KX_ENV=${e}`);
      for (const n of ['RX_VERIFY_BASE_URL', 'CREATIVE_CDN_HOST', 'PROVIDER_LINK_BASE_URL', 'SITE_CANONICAL_HOST', 'PUBLIC_APP_URL', 'WIDGET_PRODUCTION_HOST', 'WIDGET_EMBED_HOST']) expect(api).toMatch(new RegExp(`^${n}=.+$`, 'm'));
      expect(JSON.parse(readFileSync(join(out, e, 'oidc-redirects.json'), 'utf8')).clients.length).toBeGreaterThan(0);
    }
    expect(readFileSync(join(out, 'test', 'api.env'), 'utf8')).toContain('.test.');
    // pilot uses the production issuer; prod CORS never contains a test origin
    expect(readFileSync(join(out, 'pilot', 'api.env'), 'utf8')).toMatch(/^OIDC_ISSUER=https:\/\/passport\.[a-z]+\.com$/m);
    expect(readFileSync(join(out, 'prod', 'api.env'), 'utf8')).not.toContain('.test.');
    execFileSync(process.execPath, [EMIT, '--env', 'all', '--out', out, '--check'], { encoding: 'utf8' });
  });
  it('the template marks as @registry only names the generator emits', () => {
    execFileSync(process.execPath, [EMIT, '--env', 'test', '--out', out], { encoding: 'utf8' });
    expect(execFileSync(process.execPath, [VALIDATE, '--generated', join(out, 'test', 'api.env')], { encoding: 'utf8' })).toContain('env template OK');
  });
});
