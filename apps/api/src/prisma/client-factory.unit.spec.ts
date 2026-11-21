import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_POOL_MAX, adapterFromUrl, resolvePoolMax, resolveSsl } from './client-factory';

describe('resolvePoolMax (explicit pg pool default, shared cluster has max_connections=100)', () => {
  const saved = process.env.DB_POOL_MAX;
  afterEach(() => { if (saved === undefined) delete process.env.DB_POOL_MAX; else process.env.DB_POOL_MAX = saved; });

  it('connection_limit in DATABASE_URL wins', () => { process.env.DB_POOL_MAX = '7'; expect(resolvePoolMax(3)).toBe(3); });
  it('falls back to DB_POOL_MAX, then to the explicit default of 10', () => {
    process.env.DB_POOL_MAX = '7'; expect(resolvePoolMax(Number.NaN)).toBe(7);
    delete process.env.DB_POOL_MAX; expect(resolvePoolMax(0)).toBe(DEFAULT_POOL_MAX); expect(DEFAULT_POOL_MAX).toBe(10);
  });
  it('ignores junk values', () => { process.env.DB_POOL_MAX = '-4'; expect(resolvePoolMax(Number.NaN)).toBe(DEFAULT_POOL_MAX); process.env.DB_POOL_MAX = 'abc'; expect(resolvePoolMax(Number.NaN)).toBe(DEFAULT_POOL_MAX); });
});

describe('resolveSsl (RDS CA bundle, sslmode=verify-full)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kx-ca-'));
  const pem = join(dir, 'rds.pem');
  writeFileSync(pem, '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n');
  const bad = join(dir, 'bad.pem');
  writeFileSync(bad, 'not a cert');

  it('local dev: no sslmode / disable / prefer means no TLS', () => {
    for (const m of [null, 'disable', 'allow', 'prefer']) expect(resolveSsl(m, null, {})).toBeUndefined();
    // a CA configured in the environment does not switch TLS on by itself
    expect(resolveSsl(null, null, { PGSSLROOTCERT: pem })).toBeUndefined();
  });
  it('no-verify keeps the seed-Lambda behaviour', () => { expect(resolveSsl('no-verify', pem, {})).toEqual({ rejectUnauthorized: false }); });
  it('verify-full without a bundle uses the default trust store', () => { expect(resolveSsl('verify-full', null, {})).toBe(true); expect(resolveSsl('require', null, {})).toBe(true); });
  it('verify-full loads the CA from the URL, DATABASE_SSL_CA, then PGSSLROOTCERT', () => {
    const fromUrl = resolveSsl('verify-full', pem, { DATABASE_SSL_CA: bad }) as { ca: string; rejectUnauthorized: boolean };
    expect(fromUrl.ca).toContain('BEGIN CERTIFICATE'); expect(fromUrl.rejectUnauthorized).toBe(true);
    expect((resolveSsl('verify-full', null, { DATABASE_SSL_CA: pem, PGSSLROOTCERT: bad }) as { ca: string }).ca).toContain('BEGIN CERTIFICATE');
    expect((resolveSsl('verify-full', null, { PGSSLROOTCERT: pem }) as { ca: string }).ca).toContain('BEGIN CERTIFICATE');
  });
  it('verify-ca verifies the chain but not the host name', () => {
    const o = resolveSsl('verify-ca', pem, {}) as { checkServerIdentity: () => unknown; rejectUnauthorized: boolean };
    expect(o.rejectUnauthorized).toBe(true); expect(o.checkServerIdentity()).toBeUndefined();
  });
  it('fails loudly on a missing or non-PEM bundle', () => {
    expect(() => resolveSsl('verify-full', join(dir, 'missing.pem'), {})).toThrow(/cannot read CA bundle/);
    expect(() => resolveSsl('verify-full', bad, {})).toThrow(/not a PEM/);
  });
  it('adapterFromUrl accepts sslrootcert and does not forward it to pg; plain local URLs still work', () => {
    expect(() => adapterFromUrl(`postgresql://u:p@db.example:5432/x?schema=public&sslmode=verify-full&sslrootcert=${encodeURIComponent(pem)}`)).not.toThrow();
    expect(() => adapterFromUrl('postgresql://postgres:postgres@127.0.0.1:5433/kiorex_platform?schema=public')).not.toThrow();
  });
});
