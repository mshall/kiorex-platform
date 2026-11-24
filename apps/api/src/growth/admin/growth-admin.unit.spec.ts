import { GROWTH_CONFIG_SCHEMAS } from '@kiorex/contracts';
import { GROWTH_DEFAULT_PAYLOADS } from '../config/growth-defaults';
import { ConfigReaders } from '../config/config-readers';
import { GROWTH_ACCESS, GROWTH_CAPABILITIES, can, capabilitiesOf } from './growth-access';
import { diffPayload } from './config-diff';
import { evaluateGuardrails, findSecretViolations, SECRET_REF_PATTERN } from './config-guardrails';
import { siteEnvironment } from './growth-env';

describe('role matrix', () => {
  it('only super_admin writes or approves configuration; ops_admin alone only reads', () => {
    expect(can(['ops_admin'], 'read')).toBe(true);
    for (const cap of ['writeConfig', 'approveConfig', 'manage'] as const) { expect(can(['ops_admin'], cap)).toBe(false); expect(can(['ops_admin', 'finance'], cap)).toBe(false); expect(can(['ops_admin', 'support'], cap)).toBe(false); expect(can(['super_admin'], cap)).toBe(true); }
  });
  it('finance reads the money views, support reviews fraud, and not the other way round', () => {
    expect(can(['ops_admin', 'finance'], 'readFinance')).toBe(true); expect(can(['ops_admin', 'support'], 'readFinance')).toBe(false); expect(can(['ops_admin'], 'readFinance')).toBe(false);
    expect(can(['ops_admin', 'support'], 'reviewFraud')).toBe(true); expect(can(['ops_admin', 'finance'], 'reviewFraud')).toBe(false);
  });
  it('growth_admin (GRW-P2-S) reads the console and reviews promotions, and cannot write or approve configuration, review fraud or read money', () => {
    expect(can(['growth_admin'], 'read')).toBe(true); expect(can(['growth_admin'], 'reviewPromotions')).toBe(true);
    for (const cap of ['writeConfig', 'approveConfig', 'manage', 'manageCampaigns', 'manageExperiments', 'reviewFraud', 'readFinance'] as const) expect(can(['growth_admin'], cap)).toBe(false);
    expect(can(['ops_admin'], 'reviewPromotions')).toBe(false);
  });
  it('a patient has no capability at all', () => { expect(Object.values(capabilitiesOf(['patient'])).every((v) => v === false)).toBe(true); });
  it('every capability has a role list', () => { for (const c of GROWTH_CAPABILITIES) expect(GROWTH_ACCESS[c].length).toBeGreaterThan(0); });
});

describe('diffPayload', () => {
  it('lists added, removed and changed fields by path, sorted, and nothing for equal payloads', () => {
    expect(diffPayload({ a: 1, b: { c: 2, d: [1] }, e: 'x' }, { a: 1, b: { c: 3, d: [1] }, f: true })).toEqual([
      { path: '/b/c', kind: 'changed', before: 2, after: 3 }, { path: '/e', kind: 'removed', before: 'x' }, { path: '/f', kind: 'added', after: true },
    ]);
    expect(diffPayload({ a: [1, 2] }, { a: [1, 2] })).toEqual([]);
    expect(diffPayload({ a: [1, 2] }, { a: [2, 1] })).toEqual([{ path: '/a', kind: 'changed', before: [1, 2], after: [2, 1] }]);
  });
});

const att = (o: Record<string, unknown> = {}) => ({ ...(GROWTH_DEFAULT_PAYLOADS.ATTRIBUTION_POLICY as object), ...o }) as Record<string, unknown>;
describe('guardrails', () => {
  const g = (kind: string, payload: Record<string, unknown>, current?: Record<string, unknown>, o: Record<string, unknown> = {}) => evaluateGuardrails({ kind, scope: 'GLOBAL', scopeId: '', payload, current: current ?? null, ...o });
  it('an attribution window may move by at most x2 up or /2 down per version (the boundary is allowed)', () => {
    const cur = att();
    expect(g('ATTRIBUTION_POLICY', att({ providerTouchWindowDays: 60 }), cur).errors).toEqual([]);
    expect(g('ATTRIBUTION_POLICY', att({ providerTouchWindowDays: 15 }), cur).errors).toEqual([]);
    expect(g('ATTRIBUTION_POLICY', att({ providerTouchWindowDays: 61 }), cur).errors[0]).toMatch(/providerTouchWindowDays.*steps/);
    expect(g('ATTRIBUTION_POLICY', att({ providerTouchWindowDays: 14 }), cur).errors[0]).toMatch(/providerTouchWindowDays/);
    expect(g('ATTRIBUTION_POLICY', att({ campaignClickWindowDays: 1 }), cur).errors[0]).toMatch(/campaignClickWindowDays/);
  });
  it('warns (does not block) on precedence change, view-through and offline evidence', () => {
    const r = g('ATTRIBUTION_POLICY', att({ precedence: 'LAST_NON_DIRECT', campaignViewWindowHours: 24, allowOfflineEvidence: true }), att());
    expect(r.errors).toEqual([]); expect(r.warnings).toHaveLength(3);
  });
  it('consent: equal quiet hours and slow withdrawal are refused; a day cap above the week cap only warns', () => {
    const c = GROWTH_DEFAULT_PAYLOADS.CONSENT_DEFAULTS as Record<string, unknown>;
    expect(g('CONSENT_DEFAULTS', { ...c, maxMarketingPerDay: 5, maxMarketingPerWeek: 3 })).toMatchObject({ errors: [], warnings: [expect.stringMatching(/weekly cap/)] });
    expect(g('CONSENT_DEFAULTS', { ...c, quietHoursStart: '21:00', quietHoursEnd: '21:00' }).errors).toHaveLength(1);
    expect(g('CONSENT_DEFAULTS', { ...c, withdrawalPropagationSeconds: 301 }).errors).toHaveLength(1);
    expect(g('CONSENT_DEFAULTS', c).errors).toEqual([]);
  });
  it('market: confirming the marketing licence needs a ticket; a MARKET version must name its own market', () => {
    const m = { market: 'EG', currency: 'EGP', phoneCode: '+20', locales: ['ar'], canonicalSegment: 'eg', bookingLinkBaseUrl: 'https://kiorly.link', qrEnabled: true, marketingLicenceConfirmed: true, integrations: {} };
    expect(g('MARKET_GROWTH', m).errors).toHaveLength(1);
    expect(g('MARKET_GROWTH', m, undefined, { ticket: 'LEGAL-12' }).errors).toEqual([]);
    expect(g('MARKET_GROWTH', { ...m, marketingLicenceConfirmed: false }, undefined, { scope: 'MARKET', scopeId: 'AE' }).errors[0]).toMatch(/market must equal/);
  });
  it('widget localhost origins are refused in production; SEO thin-page thresholds cannot be gutted', () => {
    const w = { ...(GROWTH_DEFAULT_PAYLOADS.WIDGET_POLICY as object), allowLocalhostOrigins: true } as Record<string, unknown>;
    expect(g('WIDGET_POLICY', w).errors).toEqual([]);
    const prev = process.env.SITE_ENVIRONMENT; process.env.SITE_ENVIRONMENT = 'production';
    try { expect(siteEnvironment()).toBe('production'); expect(g('WIDGET_POLICY', w).errors).toHaveLength(1); } finally { if (prev === undefined) delete process.env.SITE_ENVIRONMENT; else process.env.SITE_ENVIRONMENT = prev; }
    const s = GROWTH_DEFAULT_PAYLOADS.SEO as Record<string, unknown>;
    expect(g('SEO', { ...s, minLiveProviders: 1 }).errors).toHaveLength(1);
    expect(g('SEO', { ...s, maxSiblingSimilarityPercent: 95 }).errors).toHaveLength(1);
    expect(g('SEO', s).errors).toEqual([]);
  });
});

describe('secrets never live in configuration', () => {
  it('a *Ref field must be a lowercase reference name, never a value', () => {
    expect(SECRET_REF_PATTERN.test('growth/whatsapp-phone-number-id')).toBe(true);
    expect(findSecretViolations({ whatsappPhoneNumberIdRef: 'prod/whatsapp_phone_id' })).toEqual([]);
    expect(findSecretViolations({ whatsappPhoneNumberIdRef: 'EAAGm0PX4ZCpsBA' })).toHaveLength(1);
    expect(findSecretViolations({ whatsappPhoneNumberIdRef: 'has spaces' })).toHaveLength(1);
  });
  it.each(['sk_live_51H8abcdefghijklmnop', ['AKIA', 'IOSFODNN7EXAMPLE'].join(''), 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc', ['-----BEGIN RSA ', 'PRIVATE KEY-----'].join(''), 'ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'Zm9vYmFyMTIzNDU2Nzg5MEFCQ0RFRkdISUo0'])('a credential-shaped value anywhere is refused: %s', (v) => {
    expect(findSecretViolations({ nested: { anything: v } })).toHaveLength(1);
    expect(findSecretViolations({ list: [v] })).toHaveLength(1);
  });
  it('ordinary values pass (hosts, enums, long lowercase names)', () => {
    expect(findSecretViolations({ canonicalHost: 'https://kiorex.com', precedence: 'PROVIDER_FIRST', regimeId: 'pdpl-eg-v0', geographyListRef: 'market-pack/eg/districts-v1-with-a-rather-long-name-for-testing' })).toEqual([]);
  });
  it('every shipped default payload is clean and valid-shaped', () => { for (const k of Object.keys(GROWTH_CONFIG_SCHEMAS)) expect(findSecretViolations(GROWTH_DEFAULT_PAYLOADS[k as keyof typeof GROWTH_DEFAULT_PAYLOADS])).toEqual([]); });
});

describe('ConfigReaders (propagation monitor)', () => {
  const fake = () => {
    const rows = new Map<string, Record<string, unknown>>(); let writes = 0;
    const prisma = { growthConfigReader: {
      upsert: async ({ where, create, update }: { where: { instanceId_reader_kind_scope_scopeId: Record<string, string> }; create: Record<string, unknown>; update: Record<string, unknown> }) => { writes++; const k = JSON.stringify(where.instanceId_reader_kind_scope_scopeId); rows.set(k, rows.has(k) ? { ...rows.get(k), ...update } : create); },
      findMany: async () => [...rows.values()],
    } };
    return { prisma: prisma as never, rows, writes: () => writes };
  };
  const r = (version: number) => ({ kind: 'SEO', scope: 'GLOBAL', scopeId: '', versionId: `v${version}`, version });
  it('throttles repeat reads of the same version, records a version change at once', async () => {
    const f = fake(); const rd = new ConfigReaders(f.prisma, 'i1');
    await rd.record('seo', r(1), 0); await rd.record('seo', r(1), 1000); await rd.record('seo', r(1), 29_000);
    expect(f.writes()).toBe(1);
    await rd.record('seo', r(2), 30_000); expect(f.writes()).toBe(2);
    await rd.record('seo', r(2), 61_000); expect(f.writes()).toBe(3);
  });
  it('status flags a recently seen reader on an older version as stale and the set as not converged', async () => {
    const f = fake(); const a = new ConfigReaders(f.prisma, 'i1'); const b = new ConfigReaders(f.prisma, 'i2');
    const now = Date.now();
    await a.record('seo', r(2), now); await b.record('seo', r(1), now);
    const s = await a.status('SEO', 'GLOBAL', '', { versionId: 'v2', version: 2 }, new Date(now + 1000));
    expect(s).toMatchObject({ inForceVersion: 2, liveReaders: 2, stale: 1, converged: false });
    await b.record('seo', r(2), now + 40_000);
    expect(await a.status('SEO', 'GLOBAL', '', { versionId: 'v2', version: 2 }, new Date(now + 41_000))).toMatchObject({ stale: 0, converged: true });
  });
  it('a database failure never reaches the reader', async () => {
    const rd = new ConfigReaders({ growthConfigReader: { upsert: async () => { throw new Error('db down'); } } } as never, 'i1');
    await expect(rd.record('seo', r(1))).resolves.toBeUndefined();
  });
});
