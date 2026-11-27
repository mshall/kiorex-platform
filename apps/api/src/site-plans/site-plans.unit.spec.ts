import { contentToPublic, DEFAULT_CONTENT, mapClinicPlans, validateContent } from './site-plans.catalog';
import { plansPublicCors, plansPublicOrigins } from './site-plans-cors';

const ent = (o: Record<string, unknown>) => Object.entries(o).map(([key, value]) => ({ key, value }));

describe('site plans catalogue', () => {
  it('maps limits (including unlimited) and only allow-listed true features, in a fixed order', () => {
    const r = mapClinicPlans({ market: { code: 'eg', currency: 'egp' }, plans: [{ key: 'CLINIC', nameEn: 'Clinic', nameAr: 'عيادة', sortOrder: 30, entitlements: ent({ max_clinicians: -1, max_branches: 25, max_assistant_seats: 30, ai_scribe: true, mod_clinical: true, unknown_thing: true, eta_receipts: true }), prices: [] }] });
    expect(r.market).toEqual({ code: 'EG', currency: 'EGP' });
    const p = r.plans[0]!;
    expect(p.limits.en).toEqual(['Unlimited clinicians', 'Up to 25 branches', 'Up to 30 assistant seats']);
    expect(p.features.en).toEqual(['Clinical records', 'AI note scribe']); // no unknown key, no tax receipt claim
    expect(p.features.ar).toHaveLength(p.features.en.length);
    expect(p.limits.ar).toHaveLength(p.limits.en.length);
  });
  it('drops malformed rows instead of guessing and never invents a price', () => {
    const r = mapClinicPlans({ market: { code: 'EG', currency: 'EGP' }, plans: [null, { key: 'bad key' }, { key: 'PRO', nameEn: 'Pro', entitlements: [], prices: [{ interval: 'MONTHLY', unit: 'PER_TENANT', amount: 'free', currency: 'EGP' }, { interval: 'WEEKLY', unit: 'PER_TENANT', amount: '1', currency: 'EGP' }, { interval: 'MONTHLY', unit: 'PER_TENANT', amount: '10', currency: 'EGP', cohortKey: 'x' }] }] });
    expect(r.plans).toHaveLength(1);
    expect(r.plans[0]).toMatchObject({ priceStatus: 'TO_BE_ANNOUNCED', prices: [] });
    expect(mapClinicPlans('nonsense')).toEqual({ market: null, plans: [] });
  });
  it('shipped defaults validate, are bilingual with equal list lengths and carry no price key', () => {
    const v = validateContent(JSON.parse(JSON.stringify(DEFAULT_CONTENT)));
    expect(v.ok).toBe(true);
    expect(JSON.stringify(DEFAULT_CONTENT)).not.toMatch(/\d{3,}|EGP/i);
    for (const m of ['pharmacy', 'lab'] as const) for (const p of DEFAULT_CONTENT[m].plans) { expect(p.features.en.length).toBe(p.features.ar.length); expect(p.limits.en.length).toBe(p.limits.ar.length); }
  });
  it('validation refuses unknown modules and fields, price-like keys, markup, oversize and duplicate ids', () => {
    const base = () => JSON.parse(JSON.stringify(DEFAULT_CONTENT));
    const bad = (mut: (c: any) => void) => { const c = base(); mut(c); return validateContent(c); };
    expect(bad((c) => { c.clinic = { plans: [] }; }).ok).toBe(false);
    expect(bad((c) => { c.lab.plans[0].extra = 1; }).ok).toBe(false);
    expect(bad((c) => { c.lab.plans[0].monthlyPrice = 1; }).ok).toBe(false);
    expect(bad((c) => { c.lab.plans[0].name.en = '<b>x</b>'; }).ok).toBe(false);
    expect(bad((c) => { c.lab.plans[0].name.en = 'x'.repeat(201); }).ok).toBe(false);
    expect(bad((c) => { c.lab.plans[1].id = c.lab.plans[0].id; }).ok).toBe(false);
    expect(bad((c) => { c.lab.plans[0].visible = 'yes'; }).ok).toBe(false);
    expect(validateContent(null).ok).toBe(false);
  });
  it('only visible plans are public and none has a price', () => {
    const c = JSON.parse(JSON.stringify(DEFAULT_CONTENT)); c.pharmacy.plans[1].visible = false;
    const out = contentToPublic('pharmacy', c);
    expect(out.map((p) => p.id)).toEqual(['lite', 'chain']);
    expect(out.every((p) => p.priceStatus === 'TO_BE_ANNOUNCED' && p.prices.length === 0)).toBe(true);
  });
});

describe('plans public CORS', () => {
  const run = (env: Record<string, string>, headers: Record<string, string>, method = 'GET') => {
    const set: Record<string, string> = {}; let status = 0; let nexted = false;
    plansPublicCors(env)({ method, headers }, { setHeader: (k, v) => { set[k] = v; }, status(n) { status = n; return this; }, end() { /* */ } }, () => { nexted = true; });
    return { set, status, nexted };
  };
  it('allows the site origin from PLANS_PUBLIC_ORIGINS or LEADS_PUBLIC_ORIGINS, GET only, no credentials', () => {
    expect(plansPublicOrigins({ LEADS_PUBLIC_ORIGINS: 'https://a.example/', PLANS_PUBLIC_ORIGINS: 'https://b.example' })).toEqual(['https://a.example', 'https://b.example']);
    const ok = run({ LEADS_PUBLIC_ORIGINS: 'https://a.example' }, { origin: 'https://a.example' });
    expect(ok.set['Access-Control-Allow-Origin']).toBe('https://a.example');
    expect(ok.set['Access-Control-Allow-Methods']).toBe('GET, OPTIONS');
    expect(ok.set['Access-Control-Allow-Credentials']).toBeUndefined();
    expect(ok.nexted).toBe(true);
  });
  it('gives a foreign origin no headers and answers a preflight itself', () => {
    expect(run({ LEADS_PUBLIC_ORIGINS: 'https://a.example' }, { origin: 'https://evil.example' }).set['Access-Control-Allow-Origin']).toBeUndefined();
    const pre = run({ LEADS_PUBLIC_ORIGINS: 'https://a.example' }, { origin: 'https://a.example' }, 'OPTIONS');
    expect(pre.status).toBe(204); expect(pre.nexted).toBe(false);
  });
});
