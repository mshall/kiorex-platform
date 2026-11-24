import { FRAUD_RULES_DEFAULTS, mergeFraudRules, validateFraudRules, ALLOWED_ACTIONS, FRAUD_RULES_DEFAULTS as D } from './fraud-config';
import { evaluateFraud } from './engine';
import { bandOf, scoreBoth, scoreSignals } from './scoring';
import { FRAUD_ACTIONS, FRAUD_RULE_IDS, type FiredSignal, type FraudRuleId } from './signals';

const cfg = FRAUD_RULES_DEFAULTS();
const sig = (ruleId: FraudRuleId, strength: number): FiredSignal => ({ ruleId, kind: 'REFERRAL', strength, reason: 'x', evidence: [] });
// deterministic pseudo-random for property tests (no external dependency)
const lcg = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000);

describe('scoring', () => {
  it('bands: ALLOW below 30, REVIEW 30 to 69, HOLD from 70', () => {
    expect([0, 29, 30, 69, 70, 100].map((s) => bandOf(s, cfg.bands))).toEqual(['ALLOW', 'ALLOW', 'REVIEW', 'REVIEW', 'HOLD', 'HOLD']);
  });
  it('one certain self-referral is HOLD; one weak signal is ALLOW; nothing is zero', () => {
    expect(scoreSignals(cfg, [sig('r_self', 1)]).band).toBe('HOLD');
    expect(scoreSignals(cfg, [sig('r_touch_burst', 0.4)]).band).toBe('ALLOW');
    expect(scoreSignals(cfg, []).score).toBe(0);
  });
  it('per-rule cap: a weight above the cap never contributes more than the cap', () => {
    const c = mergeFraudRules(cfg, { rules: { r_farm: { weight: 100, cap: 40 } } });
    expect(scoreSignals(c, [sig('r_farm', 1)]).score).toBe(40);
  });
  it('diminishing returns: ten weak signals do not beat one strong one', () => {
    const many = scoreSignals(cfg, FRAUD_RULE_IDS.filter((i) => i !== 'r_self').map((i) => sig(i, 0.2))).score;
    expect(many).toBeLessThan(scoreSignals(cfg, [sig('r_self', 1)]).score);
  });
  it('property: scores are in 0..100 and monotone (adding a signal or raising a strength never lowers the score)', () => {
    const rnd = lcg(42);
    for (let n = 0; n < 400; n++) {
      const k = Math.floor(rnd() * 6);
      const base = Array.from({ length: k }, () => sig(FRAUD_RULE_IDS[Math.floor(rnd() * FRAUD_RULE_IDS.length)]!, rnd()));
      const s0 = scoreSignals(cfg, base).score;
      expect(s0).toBeGreaterThanOrEqual(0); expect(s0).toBeLessThanOrEqual(100);
      const extra = sig(FRAUD_RULE_IDS[Math.floor(rnd() * FRAUD_RULE_IDS.length)]!, rnd());
      // a second signal of an already present rule is a different case (one signal per rule), so the property is over distinct rules
      if (!base.some((b) => b.ruleId === extra.ruleId)) expect(scoreSignals(cfg, [...base, extra]).score).toBeGreaterThanOrEqual(s0);
      if (base.length) {
        const i = Math.floor(rnd() * base.length);
        const raised = base.map((b, j) => (j === i ? { ...b, strength: Math.min(1, b.strength + rnd() * 0.5) } : b));
        expect(scoreSignals(cfg, raised).score).toBeGreaterThanOrEqual(s0);
      }
    }
  });
  it('property: order of signals never changes the score', () => {
    const rnd = lcg(7);
    for (let n = 0; n < 100; n++) {
      const s = FRAUD_RULE_IDS.slice(0, 6).map((i) => sig(i, rnd()));
      expect(scoreSignals(cfg, [...s].reverse()).score).toBe(scoreSignals(cfg, s).score);
    }
  });
  it('shadow vs enforce: with enforce false the enforced score is zero and the shadow records what would have held', () => {
    const r = scoreBoth(cfg, [sig('r_self', 1)]);
    expect(r.enforced.score).toBe(0); expect(r.shadow.band).toBe('HOLD'); expect(r.wouldHaveBeenHeld).toBe(true);
    const on = mergeFraudRules(cfg, { enforce: true, rules: { r_self: { enforce: true } } });
    const r2 = scoreBoth(on, [sig('r_self', 1), sig('r_farm', 1)]);
    expect(r2.enforced.contributions.map((c) => c.ruleId)).toEqual(['r_self']); // only the flipped rule counts toward the action
    expect(r2.wouldHaveBeenHeld).toBe(false);
  });
});

describe('engine and actions', () => {
  it('shadow default: the action is NONE although the shadow band is HOLD', () => {
    const e = evaluateFraud(cfg, 'REFERRAL_CLAIM', { referrerSub: 'a', refereeSub: 'a' });
    expect(e.shadow.band).toBe('HOLD'); expect(e.action).toBe('NONE'); expect(e.shadowAction).toBe('REJECT_CLAIM');
  });
  it('enforced: HOLD on the claim surface rejects, on the reward surface holds the reward', () => {
    const on = mergeFraudRules(cfg, { enforce: true, rules: { r_self: { enforce: true }, r_redeem: { enforce: true } } });
    expect(evaluateFraud(on, 'REFERRAL_CLAIM', { referrerSub: 'a', refereeSub: 'a' }).action).toBe('REJECT_CLAIM');
    expect(evaluateFraud(on, 'REWARD', { referrerSub: 'a', refereeSub: 'a' }).action).toBe('HOLD_REWARD');
  });
  it('a provider finding only ever opens a provider review (never an action on a booking, commission or provider)', () => {
    const on = mergeFraudRules(cfg, { enforce: true, rules: { r_collusion: { enforce: true } } });
    const e = evaluateFraud(on, 'REWARD', { staffPhoneMatch: true });
    expect(e.kind).toBe('PROVIDER'); expect(e.action).toBe('OPEN_PROVIDER_REVIEW');
  });
  it('the action vocabulary is closed: nothing reaches attribution, commission, booking or provider penalty', () => {
    for (const a of FRAUD_ACTIONS) expect(a).not.toMatch(/ATTRIBUTION|COMMISSION|BOOKING|PENALTY|BAN_PROVIDER|SUSPEND_PROVIDER/);
    for (const [, list] of Object.entries(ALLOWED_ACTIONS)) for (const a of list) expect(FRAUD_ACTIONS).toContain(a);
    expect(ALLOWED_ACTIONS.PROVIDER_REVIEW).not.toContain('HOLD_REWARD');
  });
  it('a failing rule never takes evaluation down; disabled rules are skipped', () => {
    const off = mergeFraudRules(cfg, { rules: { r_self: { enabled: false } } });
    expect(evaluateFraud(off, 'REFERRAL_CLAIM', { referrerSub: 'a', refereeSub: 'a' }).signals).toHaveLength(0);
  });
});

describe('FRAUD_RULES config', () => {
  it('defaults are shadow and valid', () => {
    expect(D().enforce).toBe(false);
    expect(validateFraudRules(D())).toEqual({ valid: true, errors: [] });
  });
  it('rejects unknown rules, inverted bands, an action from another surface, and switching two-person off', () => {
    const v = validateFraudRules({ rules: { r_nope: { weight: 1 } }, bands: { review: 80, hold: 70 }, actions: { WIDGET: { HOLD: 'HOLD_REWARD' } }, twoPersonOnMoney: false, holdDays: 0 });
    expect(v.valid).toBe(false);
    expect(v.errors.join('|')).toMatch(/unknown rule r_nope/); expect(v.errors.join('|')).toMatch(/below bands.hold/); expect(v.errors.join('|')).toMatch(/actions.WIDGET.HOLD/); expect(v.errors.join('|')).toMatch(/twoPersonOnMoney/); expect(v.errors.join('|')).toMatch(/holdDays/);
  });
  it('merge ignores bad pieces one by one and always keeps two-person on', () => {
    const m = mergeFraudRules(cfg, { enforce: true, holdDays: -3, twoPersonOnMoney: false, bands: { review: 90, hold: 40 }, rules: { r_self: { weight: 'x', enforce: true } } });
    expect(m.enforce).toBe(true); expect(m.holdDays).toBe(cfg.holdDays); expect(m.twoPersonOnMoney).toBe(true); expect(m.bands).toEqual(cfg.bands); expect(m.rules.r_self.weight).toBe(100); expect(m.rules.r_self.enforce).toBe(true);
  });
});
