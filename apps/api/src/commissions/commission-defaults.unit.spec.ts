import { RECOMMENDED_DISCLOSURE, RECOMMENDED_MARKET_SETTINGS, RECOMMENDED_RATES, SEEDED_DEFAULT, defaultsSeedEnabled, recommendedProblems } from './commission-defaults';
import { COUNSEL_DEFAULT, gateDecision } from './commission-policy';
import { computeCommissionMinor, rateProblems } from './commission-rate';
import { missingSettings, resolveSettings } from './commission-collect';

describe('recommended commission defaults (COM-4)', () => {
  it('every shipped value passes the same validators as an operator entry', () => { expect(recommendedProblems()).toEqual([]); for (const s of Object.values(RECOMMENDED_RATES)) expect(rateProblems(s)).toEqual([]); });
  it('conservative band: percent of the basis with a minimum and a cap, EGP, net from payout, no saved-method charge', () => {
    for (const [p, s] of Object.entries(RECOMMENDED_RATES)) {
      expect(s).toMatchObject({ feeType: 'PERCENT', currency: 'EGP', mode: 'NET_FROM_PAYOUT', savedMethodChargeAllowed: false });
      expect(s.percentBps).toBeLessThanOrEqual(500); expect(s.minMinor).toBeLessThan(s.maxMinor as number); expect(p).toMatch(/CLINIC|PHARMACY|LAB/);
    }
    expect(computeCommissionMinor(100_000, RECOMMENDED_RATES.CLINIC)).toBe(3000); // 3 % of 1000.00
    expect(computeCommissionMinor(10_000, RECOMMENDED_RATES.CLINIC)).toBe(1000); // floor 10.00
    expect(computeCommissionMinor(10_000_000, RECOMMENDED_RATES.CLINIC)).toBe(7500); // cap 75.00
  });
  it('market settings plus the rate leave nothing missing for automatic collection', () => {
    const r = RECOMMENDED_RATES.CLINIC; const base = resolveSettings(RECOMMENDED_MARKET_SETTINGS, null);
    expect(missingSettings({ ...base, mode: r.mode ?? base.mode })).toEqual([]);
  });
  it('disclosure: AR and EN present, marked draft pending counsel review, override reason hidden, no markup, no tax wording', () => {
    const d = RECOMMENDED_DISCLOSURE;
    for (const t of [d.rateDisclosure.en, d.rateDisclosure.ar, d.termsSummary.en, d.termsSummary.ar]) { expect(t.length).toBeGreaterThan(40); expect(t).not.toMatch(/[<>]/); }
    expect(d.rateDisclosure.en).toContain('Draft pending counsel review'); expect(d.termsSummary.en).toContain('Draft pending counsel review');
    expect(d.showOverrideReason).toBe(false);
    expect(JSON.stringify(d).toLowerCase()).not.toMatch(/\btax\b|\bvat\b/);
  });
  it('the seed has no counsel input: the gate with the default record still blocks every real-money mode', () => {
    expect(COUNSEL_DEFAULT.status).toBe('NOT_REVIEWED');
    for (const m of ['NET_FROM_PAYOUT', 'AUTO_CHARGE_SAVED_METHOD', 'INVOICE_AND_COLLECT']) expect(gateDecision(null, { kind: 'COLLECTION_MODE', key: m, market: 'EG', real: true }).allowed).toBe(false);
    expect(SEEDED_DEFAULT).toBe('SEEDED_DEFAULT');
  });
  it('COMMISSION_DEFAULTS_SEED=false skips the install', () => { expect(defaultsSeedEnabled({})).toBe(true); expect(defaultsSeedEnabled({ COMMISSION_DEFAULTS_SEED: 'false' })).toBe(false); expect(defaultsSeedEnabled({ COMMISSION_DEFAULTS_SEED: 'true' })).toBe(true); });
});
