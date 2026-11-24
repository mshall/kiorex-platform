import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { assign, bucketsOf, digestOf, validateVariants } from './assignment';
import { isEligible, validateEligibility } from './eligibility';
import { assertFlagKeyAllowed, assertSurfaceAllowed, DENY_TAGS, nameHitsDenylist, SURFACES } from './surfaces';
import { cacheVaryKey, clearCookie, parseKxe, setCookieFor, variantFor } from './ssr-variant';
import { chiSquareSf } from './stats/normal';

const V = [{ key: 'control', weightBp: 5000 }, { key: 'b', weightBp: 5000 }];
const exp = (o: Record<string, unknown> = {}) => ({ variants: V, allocationBp: 10000, salt: 'salt-A', status: 'RUNNING', ...o });

describe('assignment', () => {
  it('fixed vectors: the same salt and unit always give the same variant (stickiness across sessions and devices through the same unit key)', () => {
    // buckets computed once with an independent HMAC-SHA256 (salt-A): [allocation, variant] = (7671, 9900) (5581, 3885) (1126, 56) (3578, 7823); 50/50 weights -> b, control, control, b
    const keys = ['v:kxv_aaaaaaaaaaaaaaaaaaaaaa', 's:sub_1', 's:sub_2', 'v:kxv_bbbbbbbbbbbbbbbbbbbbbb'];
    expect(keys.map((k) => bucketsOf(digestOf('salt-A', k)))).toEqual([{ allocation: 7671, variant: 9900 }, { allocation: 5581, variant: 3885 }, { allocation: 1126, variant: 56 }, { allocation: 3578, variant: 7823 }]);
    const vec = keys.map((u) => assign(exp(), u).variant);
    expect(vec).toEqual(['b', 'control', 'control', 'b']);
    for (let i = 0; i < 50; i++) expect(assign(exp(), 's:sub_1').variant).toBe(vec[1]);
    expect(bucketsOf(digestOf('salt-A', 's:sub_1'))).toEqual(bucketsOf(digestOf('salt-A', 's:sub_1')));
  });
  it('the salt decouples experiments: roughly half of the units change variant under another salt', () => {
    let same = 0; for (let i = 0; i < 4000; i++) if (assign(exp(), `s:${i}`).variant === assign(exp({ salt: 'salt-B' }), `s:${i}`).variant) same++;
    expect(same / 4000).toBeGreaterThan(0.45); expect(same / 4000).toBeLessThan(0.55);
  });
  it('uniformity: chi-square on 1,000,000 synthetic units over 3 variants (weights 40/30/30) and 80% allocation stays inside the 0.001 band', () => {
    const E = { variants: [{ key: 'control', weightBp: 4000 }, { key: 'b', weightBp: 3000 }, { key: 'c', weightBp: 3000 }], allocationBp: 8000, salt: 'uniform-salt', status: 'RUNNING' };
    const n = { control: 0, b: 0, c: 0, out: 0 } as Record<string, number>;
    for (let i = 0; i < 1_000_000; i++) { const a = assign(E, `v:kxv_${i}`); if (a.enrolled) n[a.variant]!++; else n.out!++; }
    const enrolled = n.control! + n.b! + n.c!;
    const exp_ = { control: enrolled * 0.4, b: enrolled * 0.3, c: enrolled * 0.3 };
    const chi2 = (['control', 'b', 'c'] as const).reduce((a, k) => a + (n[k]! - exp_[k]) ** 2 / exp_[k], 0);
    expect(chiSquareSf(chi2, 2)).toBeGreaterThan(0.001);
    expect(Math.abs(enrolled / 1_000_000 - 0.8)).toBeLessThan(0.004);
  }, 60_000);
  it('holdback and status: outside the allocation, or not RUNNING, is control with no unit hash (nothing is recorded)', () => {
    const h = assign(exp({ allocationBp: 0 }), 's:x'); expect(h).toMatchObject({ enrolled: false, variant: 'control', unitHash: null, reason: 'HOLDBACK' });
    for (const status of ['DRAFT', 'PENDING_APPROVAL', 'STOPPED', 'CONCLUDED', 'ARCHIVED']) expect(assign(exp({ status }), 's:x')).toMatchObject({ enrolled: false, variant: 'control', unitHash: null, reason: 'NOT_RUNNING' });
  });
  it('variant rules: control first, weights sum to 10000, no payload keys, unique keys, 2 to 5', () => {
    expect(validateVariants(V)).toBeNull();
    expect(validateVariants([{ key: 'b', weightBp: 5000 }, { key: 'control', weightBp: 5000 }])).toMatch(/first variant/);
    expect(validateVariants([{ key: 'control', weightBp: 5000 }, { key: 'b', weightBp: 4000 }])).toMatch(/sum to 10000/);
    expect(validateVariants([{ key: 'control', weightBp: 5000 }, { key: 'b', weightBp: 5000, discountMinor: 100 }])).toMatch(/only key and weightBp/);
    expect(validateVariants([{ key: 'control', weightBp: 5000 }, { key: 'control', weightBp: 5000 }])).toMatch(/duplicate/);
    expect(validateVariants([{ key: 'control', weightBp: 10000 }])).toMatch(/2 to 5/);
    expect(validateVariants([{ key: 'control', weightBp: 0 }, { key: 'b', weightBp: 10000 }])).toMatch(/positive/);
  });
});

describe('eligibility', () => {
  it('market, locale, platform and stage; unknown context never matches a named rule', () => {
    expect(isEligible({ markets: ['EG'], locales: ['ar'] }, { market: 'EG', locale: 'ar' })).toBe(true);
    expect(isEligible({ markets: ['EG'] }, { market: 'SA' })).toBe(false);
    expect(isEligible({ locales: ['ar'] }, { market: 'EG' })).toBe(false);
    expect(isEligible({ platforms: ['web'] }, { market: 'EG', platform: 'ios' })).toBe(false);
    expect(isEligible({ stage: 'new' }, { market: 'EG', stage: 'returning' })).toBe(false);
    expect(isEligible(null, { market: 'EG' })).toBe(true);
  });
  it('only non-clinical, non-personal keys are accepted', () => {
    expect(validateEligibility({ markets: ['EG'], stage: 'new' })).toBeNull();
    expect(validateEligibility({ specialty: 'cardiology' })).toMatch(/not allowed/);
    expect(validateEligibility({ diagnosis: 'x' })).toMatch(/not allowed/);
    expect(validateEligibility({ markets: ['egypt'] })).toMatch(/ISO/);
  });
});

describe('never-experiment rule (AD-8)', () => {
  const require_ = createRequire(__filename);
  const safetyFile = (): { items: { id: string; forbiddenKeyTokens: string[] }[] } => {
    const p = require_.resolve('@kiorex/contracts/package.json').replace('package.json', 'flags/safety-never-flags.json');
    return JSON.parse(readFileSync(p, 'utf8'));
  };
  const tokens = () => safetyFile().items.flatMap((i) => i.forbiddenKeyTokens);

  it('the safety file is found and enumerated (at least 20 controls)', () => { expect(safetyFile().items.length).toBeGreaterThanOrEqual(20); expect(tokens().length).toBeGreaterThan(30); });
  it('no registry surface (key, label or tag) intersects any forbidden token of safety-never-flags.json or the denylist tags', () => {
    for (const s of SURFACES) {
      expect(nameHitsDenylist(s.key, tokens())).toBeNull();
      for (const t of tokens()) { expect(s.key.toLowerCase().includes(t.toLowerCase())).toBe(false); }
      for (const t of s.tags) expect(DENY_TAGS).not.toContain(t);
      expect(() => assertSurfaceAllowed(s.key, [], tokens())).not.toThrow();
    }
  });
  it('every forbidden thing named in the plan is refused with 422 EXPERIMENT_SURFACE_FORBIDDEN', () => {
    const bad = ['emergency.guidance.banner', 'triage.symptom_checker.intro', 'safety.copy.warning', 'privacy.notice.text', 'consent.analytics.banner', 'regulatory.disclaimer', 'clinical.content.card', 'booking.price.disclosure', 'checkout.fee.disclosure', 'booking.cancellation.policy_text', 'pay.commission.rule', 'attribution.policy.window', 'landing.not_on_allowlist'];
    for (const s of bad) expect(() => assertSurfaceAllowed(s, [], tokens())).toThrow(expect.objectContaining({ response: expect.objectContaining({ code: 'EXPERIMENT_SURFACE_FORBIDDEN' }) }));
  });
  it('a claimed tag on the denylist refuses an otherwise allowed surface; tokens from the safety file refuse names', () => {
    expect(() => assertSurfaceAllowed('landing.home.hero_copy', ['consent'])).toThrow();
    expect(() => assertSurfaceAllowed('landing.home.hero_copy', ['clinical'])).toThrow();
    for (const t of tokens()) expect(() => assertSurfaceAllowed(`landing.${t}.x`, [], tokens())).toThrow();
    expect(() => assertSurfaceAllowed('landing.home.hero_copy', ['marketing-copy'], tokens())).not.toThrow();
  });
  it('a flag linked to an experiment may not be a safety, money or launch-locked key', () => {
    for (const k of ['growth.patient_credit', 'growth.sponsored_promotions', 'market.eg.live', 'kiorex.pay.deposits', 'rx_safety_checks', 'growth.marketing_messaging']) expect(() => assertFlagKeyAllowed(k, tokens())).toThrow();
    expect(() => assertFlagKeyAllowed('growth.experiments_copy_variant', tokens())).not.toThrow();
  });
  it('"feedback" is not "fee" (whole-segment words only)', () => { expect(nameHitsDenylist('landing.feedback.prompt')).toBeNull(); expect(nameHitsDenylist('checkout.fee.note')).not.toBeNull(); });
});

describe('SSR variant cookie kxe', () => {
  const e = { key: 'home-hero-1', variants: [{ key: 'control' }, { key: 'b' }] };
  it('no cookie, a tampered cookie or an unknown variant render the control', () => {
    expect(variantFor(undefined, e)).toBe('control');
    expect(variantFor('kxe=home-hero-1%3Azzz', e)).toBe('control');
    expect(variantFor('kxe=%E0%A4%A', e)).toBe('control');
    expect(variantFor('a=1; kxe=home-hero-1%3Ab', e)).toBe('b');
  });
  it('NO Set-Cookie and no cache vary key without consent; with consent at most 3 entries', () => {
    expect(setCookieFor([{ key: 'home-hero-1', variant: 'b' }], false)).toBeNull();
    expect(setCookieFor([], true)).toBeNull();
    const c = setCookieFor([1, 2, 3, 4].map((i) => ({ key: `exp-${i}`, variant: 'b' })), true)!;
    expect(decodeURIComponent(c.split(';')[0]!.split('=')[1]!).split('.')).toHaveLength(3);
    expect(c).toMatch(/SameSite=Lax/); expect(c).toMatch(/Secure/);
    expect(clearCookie()).toMatch(/Max-Age=0/);
    expect(cacheVaryKey(undefined)).toBe(''); expect(cacheVaryKey('x=1')).toBe('');
    expect(cacheVaryKey('kxe=home-hero-1%3Ab')).toBe('home-hero-1:b');
    expect(parseKxe('kxe=BAD%20ENTRY.ok-1%3Ab').size).toBe(1);
  });
});
