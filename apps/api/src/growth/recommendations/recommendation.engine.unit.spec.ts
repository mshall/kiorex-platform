import { runRules } from './recommendation.engine';
import { checkAggregateOnly } from './assert-aggregate-only';
import { RECOMMENDATION_KINDS, type RecommendationInputs } from './recommendation.types';
import { budgetRule, campaignRule, contentRule, holdoutRule, seoRule } from './rules';

const base = (o: Partial<RecommendationInputs> = {}): RecommendationInputs => ({ market: 'EG', window: { from: '2027-01-01', to: '2027-01-28' }, channels: [], campaigns: [], landings: [], seo: [], holdouts: [], ...o });
const ch = (channel: string, spendMinor: number, attendedNew: number, ltvMinor: number | null = null) => ({ channel, campaigns: 2, spendMinor, attendedNew, cacMinor: attendedNew ? Math.round(spendMinor / attendedNew) : null, ltvMinor });
const camp = (label: string, o: Partial<RecommendationInputs['campaigns'][number]> = {}) => ({ campaignId: 'x', label, status: 'ACTIVE', channel: 'PAID_SEARCH', activeDays: 20, spendMinor: 200_000, attendedNew: 20, cacMinor: 10_000, ...o });

describe('recommendation rules (GRW-P3-E vectors)', () => {
  describe('budget', () => {
    it('no proposal with fewer than two usable channels, under k, or under the spend floor', () => {
      expect(budgetRule(base({ channels: [ch('REFERRAL', 100_000, 50)] }))).toEqual([]);
      expect(budgetRule(base({ channels: [ch('REFERRAL', 100_000, 9), ch('PAID_SEARCH', 400_000, 40)] }))).toEqual([]);
      expect(budgetRule(base({ channels: [ch('REFERRAL', 10_000, 50), ch('PAID_SEARCH', 400_000, 40)] }))).toEqual([]);
    });
    it('no proposal when the channels are within 1.5x of each other', () => { expect(budgetRule(base({ channels: [ch('REFERRAL', 100_000, 50), ch('PAID_SEARCH', 120_000, 50)] }))).toEqual([]); });
    it('proposes moving spend from the costly channel to the cheap one, capped at 20 percent', () => {
      const [p] = budgetRule(base({ channels: [ch('REFERRAL', 100_000, 50), ch('PAID_SEARCH', 800_000, 40), ch('EMAIL', 200_000, 60)] }));
      expect(p).toMatchObject({ kind: 'REALLOCATE_BUDGET', payload: { fromChannel: 'PAID_SEARCH', toChannel: 'REFERRAL', basis: 'CAC' } });
      expect(p!.payload.shiftBp).toBeLessThanOrEqual(2000); expect(p!.payload.shiftBp).toBeGreaterThanOrEqual(500);
      expect(p!.payload.shiftMinor).toBe(Math.floor((800_000 * (p!.payload.shiftBp as number)) / 10_000));
    });
    it('uses LTV to CAC when every channel has an estimate, with higher confidence', () => {
      const a = budgetRule(base({ channels: [ch('REFERRAL', 100_000, 50), ch('PAID_SEARCH', 800_000, 40)] }))[0]!; const b = budgetRule(base({ channels: [ch('REFERRAL', 100_000, 50, 300_000), ch('PAID_SEARCH', 800_000, 40, 250_000)] }))[0]!;
      expect(b.payload.basis).toBe('LTV_CAC'); expect(b.confidence).toBeGreaterThan(a.confidence);
    });
    it('is deterministic', () => { const i = base({ channels: [ch('B', 100_000, 50), ch('A', 800_000, 40)] }); expect(JSON.stringify(budgetRule(i))).toBe(JSON.stringify(budgetRule(i))); });
  });
  describe('campaign', () => {
    it('flags an active campaign that spent twice the floor over 14 days with nobody attended', () => {
      const r = campaignRule(base({ campaigns: [camp('quiet-one', { attendedNew: 0, cacMinor: null })] }));
      expect(r).toHaveLength(1); expect(r[0]!.payload.finding).toBe('NO_ATTENDED_PATIENTS');
    });
    it('flags a campaign whose CAC is at least twice the median of comparable ones', () => {
      const r = campaignRule(base({ campaigns: [camp('a'), camp('b', { cacMinor: 11_000 }), camp('c', { cacMinor: 9_000 }), camp('pricey', { cacMinor: 30_000, spendMinor: 600_000 })] }));
      expect(r.map((x) => x.payload.campaignKey)).toEqual(['pricey']);
    });
    it('ignores paused, young, cheap or low-sample campaigns', () => {
      expect(campaignRule(base({ campaigns: [camp('p', { status: 'PAUSED', attendedNew: 0, cacMinor: null }), camp('y', { activeDays: 13, attendedNew: 0, cacMinor: null }), camp('c', { spendMinor: 50_000, attendedNew: 0, cacMinor: null })] }))).toEqual([]);
    });
  });
  describe('content', () => {
    const l = (landingKind: string, views: number, registrations: number) => ({ landingKind, views, registrations });
    it('suggests a copy experiment on a surface of the closed registry for a page type under half the others', () => {
      const r = contentRule(base({ landings: [l('HOME', 10_000, 400), l('SEARCH', 8_000, 100), l('PROVIDER', 5_000, 250)] }));
      expect(r).toHaveLength(1); expect(r[0]!.payload).toMatchObject({ landingKind: 'SEARCH', surface: 'landing.search.empty_state', action: 'COPY_EXPERIMENT' });
    });
    it('needs 1000 views and k registrations everywhere', () => { expect(contentRule(base({ landings: [l('HOME', 900, 40), l('SEARCH', 8_000, 100)] }))).toEqual([]); expect(contentRule(base({ landings: [l('HOME', 10_000, 400), l('SEARCH', 8_000, 5)] }))).toEqual([]); });
  });
  describe('seo', () => {
    const s = (o = {}) => ({ templateKind: 'city', locale: 'ar', pages: 100, failingPages: 30, topFailedChecks: ['thin-content', 'title-meta'], submitted: null, indexed: null, ...o });
    it('flags a quality-gate failure share of 20 percent and k pages', () => { const r = seoRule(base({ seo: [s()] })); expect(r[0]!.payload).toMatchObject({ pageGroup: 'city', finding: 'QUALITY_GATE', failingBp: 3000 }); });
    it('flags low indexation only when the figure is measured', () => {
      expect(seoRule(base({ seo: [s({ failingPages: 0, submitted: 200, indexed: 100 })] }))[0]!.payload.finding).toBe('LOW_INDEXATION');
      expect(seoRule(base({ seo: [s({ failingPages: 0 })] }))).toEqual([]);
    });
    it('skips groups under k pages', () => { expect(seoRule(base({ seo: [s({ pages: 9, failingPages: 9 })] }))).toEqual([]); });
  });
  describe('holdout', () => {
    const h = (o = {}) => ({ journey: 'reengagement', sent: 600, holdout: 120, sentBookedBp: 420, holdoutBookedBp: 400, ...o });
    it('suggests switching off a journey with no lift', () => { expect(holdoutRule(base({ holdouts: [h()] }))[0]!.payload).toMatchObject({ action: 'DISABLE_JOURNEY', liftBp: 20 }); });
    it('suggests keeping one with a lift of three points or more', () => { expect(holdoutRule(base({ holdouts: [h({ sentBookedBp: 800 })] }))[0]!.payload.action).toBe('KEEP_JOURNEY'); });
    it('says nothing in between or with a small holdout', () => { expect(holdoutRule(base({ holdouts: [h({ sentBookedBp: 600 })] }))).toEqual([]); expect(holdoutRule(base({ holdouts: [h({ holdout: 40 })] }))).toEqual([]); });
  });

  describe('engine', () => {
    const full = base({
      channels: [ch('REFERRAL', 100_000, 50), ch('PAID_SEARCH', 800_000, 40)], campaigns: [camp('quiet-one', { attendedNew: 0, cacMinor: null })],
      landings: [{ landingKind: 'HOME', views: 10_000, registrations: 400 }, { landingKind: 'SEARCH', views: 8_000, registrations: 100 }, { landingKind: 'PROVIDER', views: 5_000, registrations: 250 }],
      seo: [{ templateKind: 'city', locale: 'ar', pages: 100, failingPages: 30, topFailedChecks: ['thin-content'], submitted: null, indexed: null }], holdouts: [{ journey: 'reengagement', sent: 600, holdout: 120, sentBookedBp: 420, holdoutBookedBp: 400 }],
    });
    it('every proposal is in the closed vocabulary and every payload and evidence is aggregate-only', () => {
      const r = runRules(full);
      expect(r.proposals.length).toBe(5); expect(r.dropped).toEqual([]);
      for (const p of r.proposals) { expect(RECOMMENDATION_KINDS).toContain(p.kind); expect(checkAggregateOnly({ payload: p.payload, evidence: p.evidenceRefs })).toEqual([]); expect(p.rationale.en.length).toBeGreaterThan(20); expect(p.rationale.ar.length).toBeGreaterThan(20); expect(p.confidence).toBeGreaterThanOrEqual(0); expect(p.confidence).toBeLessThanOrEqual(100); }
    });
    it('sorts by confidence then fingerprint and is deterministic', () => { expect(JSON.stringify(runRules(full))).toBe(JSON.stringify(runRules(full))); const c = runRules(full).proposals.map((p) => p.confidence); expect([...c].sort((a, b) => b - a)).toEqual(c); });
    it('drops a proposal that would carry a person or a health word (a rule bug cannot leak)', () => {
      const poisoned = base({ campaigns: [camp('cardiology-promo', { attendedNew: 0, cacMinor: null })] });
      const r = runRules(poisoned); expect(r.proposals).toEqual([]); expect(r.dropped[0]!.reason).toMatch(/HEALTH_WORD/);
    });
    it('denylist: no proposal targets by health condition or builds an audience (kind, payload keys, text)', () => {
      for (const p of runRules(full).proposals) {
        const text = JSON.stringify([p.kind, Object.keys(p.payload), p.rationale]).toLowerCase();
        for (const bad of ['audience', 'lookalike', 'retarget', 'condition', 'diagnos', 'symptom', 'specialty', 'patient list', 'recipients', 'target ']) expect(text).not.toContain(bad);
      }
    });
    it('keeps at most ten', () => {
      const many = base({ campaigns: Array.from({ length: 30 }, (_, i) => camp(`dead-${String(i).padStart(2, '0')}`, { attendedNew: 0, cacMinor: null })) });
      expect(runRules(many).proposals.length).toBe(10);
    });
    it('no input, no proposal', () => { expect(runRules(base()).proposals).toEqual([]); });
  });
});
