import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { HOST_ENV_VARS, assertHostConfig, inspectHostConfig } from './hosts';

const ALL = Object.fromEntries(HOST_ENV_VARS.map((n) => [n, 'x.example']));
const quiet = () => undefined;

describe('host configuration fails closed outside local (ADR-059)', () => {
  it('local keeps the production fallbacks: unset, local and dev boot with no host variable', () => {
    for (const e of [{}, { KX_ENV: 'local' }, { KX_ENV: 'dev' }, { KX_ENV: '' }]) {
      expect(inspectHostConfig(e).missing).toEqual([]);
      expect(() => assertHostConfig(e, quiet)).not.toThrow();
    }
  });
  it.each(['test', 'staging', 'pilot', 'prod'])('KX_ENV=%s with every host variable set boots', (kx) => {
    expect(() => assertHostConfig({ ...ALL, KX_ENV: kx }, quiet)).not.toThrow();
  });
  it.each(['test', 'pilot', 'prod'])('KX_ENV=%s with variables unset logs the missing names and refuses to start', (kx) => {
    const logs: string[] = [];
    const env = { ...ALL, KX_ENV: kx, RX_VERIFY_BASE_URL: undefined, CREATIVE_CDN_HOST: '  ' };
    expect(() => assertHostConfig(env, (m) => logs.push(m))).toThrow(/RX_VERIFY_BASE_URL, CREATIVE_CDN_HOST/);
    expect(logs.join('\n')).toContain('RX_VERIFY_BASE_URL, CREATIVE_CDN_HOST');
    expect(logs.join('\n')).not.toContain('x.example'); // names only, never values
  });
  it('an empty environment of a strict tag lists every name', () => {
    expect(inspectHostConfig({ KX_ENV: 'prod' }).missing).toEqual([...HOST_ENV_VARS]);
  });
  it('ALLOW_HOST_DEFAULTS=true is the explicit override and is logged as a warning', () => {
    const logs: string[] = [];
    expect(() => assertHostConfig({ KX_ENV: 'pilot', ALLOW_HOST_DEFAULTS: 'true' }, (m) => logs.push(m))).not.toThrow();
    expect(logs[0]).toMatch(/^WARNING .*ALLOW_HOST_DEFAULTS=true/);
    expect(() => assertHostConfig({ KX_ENV: 'pilot', ALLOW_HOST_DEFAULTS: '1' }, quiet)).toThrow();
    expect(() => assertHostConfig({ KX_ENV: 'pilot', ALLOW_HOST_DEFAULTS: 'false' }, quiet)).toThrow();
  });
  it('a misspelt KX_ENV does not reopen the production fallbacks', () => {
    expect(() => assertHostConfig({ KX_ENV: 'production' }, quiet)).toThrow(/KX_ENV=production/);
    expect(() => assertHostConfig({ ...ALL, KX_ENV: 'production' }, quiet)).not.toThrow();
  });
  it('the kx-test template lists every host variable as @registry', () => {
    const tpl = readFileSync(join(resolve(__dirname, '..', '..', 'env'), 'kx-test.env.template'), 'utf8');
    for (const n of HOST_ENV_VARS) expect(tpl).toMatch(new RegExp(`^${n}=@registry$`, 'm'));
    expect(tpl).not.toMatch(/ALLOW_HOST_DEFAULTS=/);
  });
});
