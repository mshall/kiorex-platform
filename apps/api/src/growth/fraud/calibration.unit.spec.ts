import { encodeDecision, parseDecision, rescore } from './case.service';
import { fairnessRows, proposeWeights, shadowReport, MIN_LABELLED } from './calibration';
import { FRAUD_RULES_DEFAULTS } from './fraud-config';

const cfg = FRAUD_RULES_DEFAULTS();

describe('case helpers', () => {
  it('decision text round-trips and unknown text is harmless', () => {
    expect(parseDecision(encodeDecision({ decision: 'CONFIRM', reverse: true, suspendDays: 30 }))).toEqual({ decision: 'CONFIRM', reverse: true, suspendDays: 30 });
    expect(parseDecision(encodeDecision({ decision: 'CONFIRM' }))).toEqual({ decision: 'CONFIRM', reverse: false, suspendDays: 0 });
    expect(parseDecision('DISMISS').decision).toBe('DISMISS'); expect(parseDecision(null).decision).toBeNull(); expect(parseDecision('garbage;x=1').decision).toBeNull();
  });
  it('rescore uses the strongest weight per rule with diminishing returns, like live scoring', () => {
    expect(rescore([{ ruleId: 'r_self', weight: 40 }, { ruleId: 'r_self', weight: 50 }], cfg)).toMatchObject({ score: 50 });
    expect(rescore([{ ruleId: 'r_self', weight: 50 }, { ruleId: 'r_dup', weight: 50 }], cfg).score).toBe(80); // 50 + 50 x 0.6
    expect(rescore([], cfg)).toEqual({ score: 0, band: 'ALLOW' });
  });
});

describe('calibration', () => {
  it('the shadow report hides precision under the label minimum and shows it above', () => {
    const r = shadowReport(cfg, { r_farm: { flagged: 30, confirmed: 18, dismissed: 2 }, r_self: { flagged: 5, confirmed: 3, dismissed: 1 } });
    expect(r.find((x) => x.ruleId === 'r_farm')).toMatchObject({ labelled: 20, precision: 0.9, pending: 10 });
    expect(r.find((x) => x.ruleId === 'r_self')!.precision).toBeNull();
    expect(r).toHaveLength(11);
  });
  it('proposes weight changes only for rules with enough labels and never touches enforce, bands or actions', () => {
    const p = proposeWeights(cfg, { r_farm: { flagged: 40, confirmed: 5, dismissed: 25 }, r_dup: { flagged: 40, confirmed: 38, dismissed: 2 }, r_bot: { flagged: 5, confirmed: 0, dismissed: 5 }, r_self: { flagged: 40, confirmed: 40, dismissed: 0 } });
    expect(p.changes.map((c) => c.ruleId).sort()).toEqual(['r_dup', 'r_farm']);
    expect(p.changes.find((c) => c.ruleId === 'r_farm')).toMatchObject({ from: 70, to: 53 }); // precision 0.167: -25 percent
    expect(p.changes.find((c) => c.ruleId === 'r_dup')!.to).toBe(99); expect(p.changes.some((c) => c.ruleId === 'r_self')).toBe(false); // r_self is already at 100: no change
    expect(Object.keys(p.payload)).toEqual(['rules']); expect(JSON.stringify(p.payload)).not.toMatch(/enforce|bands|actions/);
    expect(MIN_LABELLED).toBe(20);
  });
  it('no labels, no change', () => { expect(proposeWeights(cfg, {}).changes).toEqual([]); });
});

describe('fairness guard', () => {
  it('masks groups under ten and flags a group held at twice the lowest visible rate', () => {
    const rows = fairnessRows([{ group: 'ar', total: 200, held: 10 }, { group: 'en', total: 100, held: 15 }, { group: 'x', total: 4, held: 3 }]);
    expect(rows.find((r) => r.group === 'x')).toMatchObject({ total: '<10', held: '<10', rate: null, flagged: false });
    expect(rows.find((r) => r.group === 'ar')).toMatchObject({ rate: 0.05, flagged: false });
    expect(rows.find((r) => r.group === 'en')).toMatchObject({ rate: 0.15, flagged: true });
  });
  it('a single visible group and all-zero rates flag nothing', () => {
    expect(fairnessRows([{ group: 'ar', total: 50, held: 25 }]).every((r) => !r.flagged)).toBe(true);
    expect(fairnessRows([{ group: 'ar', total: 50, held: 0 }, { group: 'en', total: 50, held: 0 }]).every((r) => !r.flagged)).toBe(true);
  });
});
