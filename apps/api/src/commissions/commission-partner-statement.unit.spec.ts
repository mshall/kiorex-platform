import { signKiorlyRequest } from '@kiorex/contracts';
import { canonicalQuery, clinicOrgSecret, signStatementQuery } from './commission-partner-signing';
import { CommissionPartnerStatementService, type PartnerStatementReq } from './commission-partner-statement.service';

const PATH = '/api/v1/partner/commissions/settlement-statement';
const CLINIC = { key: 'kx_dev_client', secret: 'kx_dev_webhook_secret' };
const PH = { key: 'ph_key', secret: 'ph_webhook_secret', reg: 'pr_pharmacy_1' };

function setup() {
  const nonces = new Set<string>(); const audits: any[] = []; const regs = new Set<string>([PH.reg, 'pr_lab_9']);
  const prisma: any = {
    partnerIntakeNonce: { create: async ({ data }: any) => { if (nonces.has(data.id)) throw new Error('dup'); nonces.add(data.id); } },
    partnerRegistration: { findUnique: async ({ where }: any) => (regs.has(where.id) ? { id: where.id } : null) },
    auditLog: { create: async ({ data }: any) => { audits.push(data); } },
  };
  const partners: any = { webhookAuth: async (kind: string, key: string) => (kind === 'PHARMACY' && key === PH.key ? { secret: PH.secret, registrationId: PH.reg } : kind === 'LAB' && key === 'env_lab' ? { secret: 'env_secret', registrationId: null } : null) };
  const svc = new CommissionPartnerStatementService(prisma, partners, {} as never);
  const req = (o: { key?: string; secret?: string; org?: string; query?: Record<string, string>; path?: string; ts?: number; nonce?: string; method?: string; ip?: string } = {}): PartnerStatementReq => {
    const s = signKiorlyRequest({ clientKey: o.key ?? CLINIC.key, clientSecret: o.secret ?? CLINIC.secret, method: o.method ?? 'GET', path: o.path ?? PATH, timestamp: o.ts, nonce: o.nonce });
    // Node lower-cases header names
    const headers: Record<string, string> = Object.fromEntries(Object.entries(s.headers).map(([k, v]) => [k.toLowerCase(), v as string]));
    if (o.org) headers['x-kiorly-org-ref'] = o.org;
    return { ip: o.ip ?? '10.0.0.1', originalUrl: (o.path ?? PATH) + (o.query ? '?' + new URLSearchParams(o.query).toString() : ''), method: o.method ?? 'GET', headers, query: o.query };
  };
  return { svc, req, audits };
}

describe('partner settlement statement authentication', () => {
  beforeAll(() => { process.env.RATE_LIMIT_STORE = 'memory'; });
  afterAll(() => { delete process.env.RATE_LIMIT_STORE; });

  it('Clinic: the organisation is the tenant in X-Kiorly-Org-Ref', async () => {
    const { svc, req } = setup();
    expect(await svc.authenticate(req({ org: 'tenant_a' }))).toMatchObject({ orgRef: 'tenant_a', product: 'CLINIC' });
  });
  it('Clinic: no organisation reference, an unsigned request, a wrong key, a wrong secret, a stale and a replayed signature are all 401', async () => {
    const { svc, req } = setup();
    const code = async (r: PartnerStatementReq) => svc.authenticate(r).then(() => 'OK', (e) => `${e.getStatus()}:${e.getResponse().code}`);
    expect(await code(req())).toBe('401:PARTNER_UNAUTHORIZED');
    expect(await code({ ...req({ org: 'tenant_a' }), headers: { 'x-kiorly-client-key': CLINIC.key } })).toBe('401:UNAUTHENTICATED');
    expect(await code(req({ org: 'tenant_a', key: 'wrong_key' }))).toBe('401:PARTNER_UNAUTHORIZED');
    expect(await code(req({ org: 'tenant_a', secret: 'wrong_secret' }))).toBe('401:PARTNER_UNAUTHORIZED');
    expect(await code(req({ org: 'tenant_a', ts: Date.now() - 6 * 60_000 }))).toBe('401:PARTNER_UNAUTHORIZED');
    const r = req({ org: 'tenant_a', nonce: 'n-1' });
    expect(await code(r)).toBe('OK'); expect(await code(r)).toBe('401:PARTNER_UNAUTHORIZED');
    expect(await code(req({ org: 'tenant_a', path: PATH + '/export', method: 'POST' }))).toBe('OK'); // method and path are signed; the controller routing decides what answers
  });
  it('a request signed for one path cannot be replayed on another', async () => {
    const { svc, req } = setup();
    const r = req({ org: 'tenant_a' }); r.originalUrl = PATH + '/export';
    await expect(svc.authenticate(r)).rejects.toMatchObject({ response: { code: 'PARTNER_UNAUTHORIZED' } });
  });
  it('Clinic cannot name a Pharmacy or Lab registration as its organisation, and the denial is audited', async () => {
    const { svc, req, audits } = setup();
    await expect(svc.authenticate(req({ org: PH.reg }))).rejects.toMatchObject({ response: { code: 'PARTNER_ORG_MISMATCH' } });
    expect(audits).toEqual([expect.objectContaining({ action: 'commission.partner_statement_denied', actor: `partner:${CLINIC.key}` })]);
  });
  it('Pharmacy: the organisation is the registration, with or without a matching header', async () => {
    const { svc, req } = setup();
    expect(await svc.authenticate(req({ key: PH.key, secret: PH.secret }))).toMatchObject({ orgRef: PH.reg, product: 'PHARMACY' });
    expect(await svc.authenticate(req({ key: PH.key, secret: PH.secret, org: PH.reg, query: { orgRef: PH.reg } }))).toMatchObject({ orgRef: PH.reg });
  });
  it('Pharmacy: a different organisation in the header or the query is 403 and audited; its registration secret is not the Clinic secret', async () => {
    const { svc, req, audits } = setup();
    await expect(svc.authenticate(req({ key: PH.key, secret: PH.secret, org: 'tenant_a' }))).rejects.toMatchObject({ response: { code: 'PARTNER_ORG_MISMATCH' } });
    await expect(svc.authenticate(req({ key: PH.key, secret: PH.secret, query: { orgRef: 'pr_lab_9' } }))).rejects.toMatchObject({ response: { code: 'PARTNER_ORG_MISMATCH' } });
    expect(audits.map((a) => a.metadata.reason)).toEqual(['HEADER_ORG_DIFFERS', 'QUERY_ORG_DIFFERS']);
    await expect(svc.authenticate(req({ key: PH.key, secret: CLINIC.secret }))).rejects.toMatchObject({ response: { code: 'PARTNER_UNAUTHORIZED' } });
    await expect(svc.authenticate(req({ key: CLINIC.key, secret: PH.secret, org: 'tenant_a' }))).rejects.toMatchObject({ response: { code: 'PARTNER_UNAUTHORIZED' } });
  });
  it('an env-default partner (no registration) has no organisation: 403', async () => {
    const { svc, req } = setup();
    await expect(svc.authenticate(req({ key: 'env_lab', secret: 'env_secret' }))).rejects.toMatchObject({ response: { code: 'PARTNER_ORG_UNKNOWN' } });
  });
  it('Clinic: a query orgRef that differs from the header is 403', async () => {
    const { svc, req } = setup();
    await expect(svc.authenticate(req({ org: 'tenant_a', query: { orgRef: 'tenant_b' } }))).rejects.toMatchObject({ response: { code: 'PARTNER_ORG_MISMATCH' } });
  });
  it('is rate limited per organisation and per IP', async () => {
    process.env.COMMISSION_STATEMENT_RATE_PER_MIN = '3';
    try {
      const { svc, req } = setup();
      for (let i = 0; i < 3; i++) await svc.authenticate(req({ org: 'tenant_a' }));
      await expect(svc.authenticate(req({ org: 'tenant_a' }))).rejects.toMatchObject({ status: 429, response: { code: 'PARTNER_RATE_LIMITED' } });
      await svc.authenticate(req({ org: 'tenant_b' })); // another organisation has its own bucket
    } finally { delete process.env.COMMISSION_STATEMENT_RATE_PER_MIN; }
    process.env.COMMISSION_STATEMENT_RATE_IP_PER_MIN = '2';
    try {
      const { svc, req } = setup();
      await svc.authenticate(req({ org: 'tenant_a', ip: '9.9.9.9' })); await svc.authenticate(req({ org: 'tenant_b', ip: '9.9.9.9' }));
      await expect(svc.authenticate(req({ org: 'tenant_c', ip: '9.9.9.9' }))).rejects.toMatchObject({ status: 429 });
    } finally { delete process.env.COMMISSION_STATEMENT_RATE_IP_PER_MIN; }
  });
});

describe('partner statement: per-organisation Clinic credentials and the signed query string', () => {
  const MASTER = 'm'.repeat(32);
  const ENV = ['COMMISSION_STATEMENT_ORG_KEY_MASTER', 'COMMISSION_STATEMENT_ORG_SECRETS', 'COMMISSION_STATEMENT_CLINIC_AUTH', 'COMMISSION_STATEMENT_QUERY_SIGNATURE'];
  beforeAll(() => { process.env.RATE_LIMIT_STORE = 'memory'; });
  afterAll(() => { delete process.env.RATE_LIMIT_STORE; });
  afterEach(() => { for (const k of ENV) delete process.env[k]; });

  function mk() {
    const { svc } = setup();
    const build = (o: { secret?: string; org?: string; query?: Record<string, string>; rawQuery?: string; sign?: boolean | string; tamper?: string } = {}): PartnerStatementReq => {
      const s = signKiorlyRequest({ clientKey: CLINIC.key, clientSecret: o.secret ?? CLINIC.secret, method: 'GET', path: PATH });
      const headers: Record<string, string> = Object.fromEntries(Object.entries(s.headers).map(([k, v]) => [k.toLowerCase(), v as string]));
      if (o.org) headers['x-kiorly-org-ref'] = o.org;
      const q = o.query ?? {};
      if (o.sign) headers['x-kiorly-query-signature'] = typeof o.sign === 'string' ? o.sign : signStatementQuery(o.secret ?? CLINIC.secret, { timestamp: s.timestamp, nonce: s.nonce, method: 'GET', path: PATH, query: q });
      const qs = o.rawQuery ?? (Object.keys(q).length ? '?' + new URLSearchParams(o.tamper ? { ...q, ...Object.fromEntries([[o.tamper, '2099-01-01']]) } : q).toString() : '');
      return { ip: '10.0.0.2', originalUrl: PATH + qs, method: 'GET', headers, query: q };
    };
    return { svc, build };
  }

  it('derives a stable secret per organisation; none without a master; the explicit map wins; a short or malformed value is ignored', () => {
    expect(clinicOrgSecret('tenant_a')).toBeNull();
    process.env.COMMISSION_STATEMENT_ORG_KEY_MASTER = MASTER;
    const a = clinicOrgSecret('tenant_a'); const b = clinicOrgSecret('tenant_b');
    expect(a).toMatch(/^[0-9a-f]{64}$/); expect(a).not.toBe(b); expect(clinicOrgSecret('tenant_a')).toBe(a);
    process.env.COMMISSION_STATEMENT_ORG_SECRETS = JSON.stringify({ tenant_a: 'pinned-secret-0123456789', tenant_b: 'short' });
    expect(clinicOrgSecret('tenant_a')).toBe('pinned-secret-0123456789'); expect(clinicOrgSecret('tenant_b')).toBe(b);
    process.env.COMMISSION_STATEMENT_ORG_SECRETS = '{not json'; expect(clinicOrgSecret('tenant_a')).toBe(a);
    process.env.COMMISSION_STATEMENT_ORG_KEY_MASTER = 'too-short'; delete process.env.COMMISSION_STATEMENT_ORG_SECRETS; expect(clinicOrgSecret('tenant_a')).toBeNull();
  });
  it('default (either): the shared Clinic secret still works (backward compatible) and so does the organisation own secret', async () => {
    process.env.COMMISSION_STATEMENT_ORG_KEY_MASTER = MASTER;
    const { svc, build } = mk();
    expect(await svc.authenticate(build({ org: 'tenant_a' }))).toMatchObject({ orgRef: 'tenant_a', credential: 'SHARED' });
    expect(await svc.authenticate(build({ org: 'tenant_a', secret: clinicOrgSecret('tenant_a')! }))).toMatchObject({ orgRef: 'tenant_a', credential: 'ORG' });
  });
  it('an organisation secret only opens its own organisation: tenant_a key with tenant_b in the header is 401', async () => {
    process.env.COMMISSION_STATEMENT_ORG_KEY_MASTER = MASTER;
    const { svc, build } = mk();
    await expect(svc.authenticate(build({ org: 'tenant_b', secret: clinicOrgSecret('tenant_a')! }))).rejects.toMatchObject({ response: { code: 'PARTNER_UNAUTHORIZED' } });
  });
  it('per_org refuses the shared secret; shared ignores organisation secrets', async () => {
    process.env.COMMISSION_STATEMENT_ORG_KEY_MASTER = MASTER;
    process.env.COMMISSION_STATEMENT_CLINIC_AUTH = 'per_org';
    let m = mk();
    await expect(m.svc.authenticate(m.build({ org: 'tenant_a' }))).rejects.toMatchObject({ response: { code: 'PARTNER_UNAUTHORIZED' } });
    expect(await m.svc.authenticate(m.build({ org: 'tenant_a', secret: clinicOrgSecret('tenant_a')! }))).toMatchObject({ credential: 'ORG' });
    process.env.COMMISSION_STATEMENT_CLINIC_AUTH = 'shared';
    m = mk();
    await expect(m.svc.authenticate(m.build({ org: 'tenant_a', secret: clinicOrgSecret('tenant_a')! }))).rejects.toMatchObject({ response: { code: 'PARTNER_UNAUTHORIZED' } });
    expect(await m.svc.authenticate(m.build({ org: 'tenant_a' }))).toMatchObject({ credential: 'SHARED' });
  });
  it('per_org without any configured credential refuses everything (fail closed)', async () => {
    process.env.COMMISSION_STATEMENT_CLINIC_AUTH = 'per_org';
    const { svc, build } = mk();
    await expect(svc.authenticate(build({ org: 'tenant_a' }))).rejects.toMatchObject({ response: { code: 'PARTNER_UNAUTHORIZED' } });
  });

  it('canonical query is order independent and encoded', () => {
    expect(canonicalQuery('to=2026-12-31&from=2026-12-01')).toBe('from=2026-12-01&to=2026-12-31');
    expect(canonicalQuery({ to: '2026-12-31', from: '2026-12-01' })).toBe('from=2026-12-01&to=2026-12-31');
    expect(canonicalQuery('?a=b%20c&a=a')).toBe('a=a&a=b%20c'); expect(canonicalQuery(undefined)).toBe(''); expect(canonicalQuery('')).toBe('');
  });
  it('a signed query verifies, whatever the order the client sent it in', async () => {
    const { svc, build } = mk();
    expect(await svc.authenticate(build({ org: 'tenant_a', query: { from: '2026-12-01', to: '2026-12-31' }, sign: true, rawQuery: '?to=2026-12-31&from=2026-12-01' }))).toMatchObject({ orgRef: 'tenant_a' });
  });
  it('a changed query value, an added parameter or a signature of another query is 401', async () => {
    const { svc, build } = mk();
    const code = (r: PartnerStatementReq) => svc.authenticate(r).then(() => 'OK', (e) => e.getResponse().code);
    expect(await code(build({ org: 'tenant_a', query: { from: '2026-12-01' }, sign: true, tamper: 'from' }))).toBe('PARTNER_UNAUTHORIZED');
    expect(await code(build({ org: 'tenant_a', query: { from: '2026-12-01' }, sign: true, tamper: 'to' }))).toBe('PARTNER_UNAUTHORIZED');
    expect(await code(build({ org: 'tenant_a', query: { from: '2026-12-01' }, sign: 'AAAA' }))).toBe('PARTNER_UNAUTHORIZED');
    expect(await code(build({ org: 'tenant_a', query: { from: '2026-12-01' }, sign: true }))).toBe('OK');
  });
  it('optional (default): an unsigned query is still accepted; required: a missing query signature is 401', async () => {
    let m = mk();
    expect(await m.svc.authenticate(m.build({ org: 'tenant_a', query: { from: '2026-12-01' } }))).toMatchObject({ orgRef: 'tenant_a' });
    process.env.COMMISSION_STATEMENT_QUERY_SIGNATURE = 'required';
    m = mk();
    await expect(m.svc.authenticate(m.build({ org: 'tenant_a', query: { from: '2026-12-01' } }))).rejects.toMatchObject({ response: { code: 'PARTNER_UNAUTHORIZED' } });
    expect(await m.svc.authenticate(m.build({ org: 'tenant_a', query: { from: '2026-12-01' }, sign: true }))).toMatchObject({ orgRef: 'tenant_a' });
  });
  it('the query signature is bound to the secret: the shared-secret signature does not pass for an organisation-secret request', async () => {
    process.env.COMMISSION_STATEMENT_ORG_KEY_MASTER = MASTER;
    const { svc, build } = mk();
    const own = clinicOrgSecret('tenant_a')!;
    const r = build({ org: 'tenant_a', secret: own, query: { from: '2026-12-01' }, sign: true });
    expect(await svc.authenticate(r)).toMatchObject({ credential: 'ORG' });
    const bad = build({ org: 'tenant_a', secret: own, query: { from: '2026-12-01' } });
    bad.headers['x-kiorly-query-signature'] = signStatementQuery(CLINIC.secret, { timestamp: bad.headers['x-kiorly-timestamp'] as string, nonce: bad.headers['x-kiorly-nonce'] as string, method: 'GET', path: PATH, query: { from: '2026-12-01' } });
    await expect(svc.authenticate(bad)).rejects.toMatchObject({ response: { code: 'PARTNER_UNAUTHORIZED' } });
  });
});
