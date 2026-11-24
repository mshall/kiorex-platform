import { FLAG_CATALOGUE as CONTRACT_FLAGS, FLAGS, GROWTH_CONFIG_KINDS_WITH_SCHEMA, validateGrowthConfig } from '@kiorex/contracts';
import { FLAG_CATALOGUE } from '../control-plane/flag-catalogue';
import { DEFAULT_RETENTION, GROWTH_DEFAULT_MARKET, GROWTH_DEFAULT_PAYLOADS, GROWTH_FLAG, GROWTH_LAUNCH_LOCKED_FLAGS } from './growth-public';

describe('growth PROPOSED_DEFAULT configuration', () => {
  it.each(GROWTH_CONFIG_KINDS_WITH_SCHEMA)('%s default payload validates against the contracts JSON Schema', (kind) => {
    expect(GROWTH_DEFAULT_PAYLOADS[kind]).toBeDefined();
    expect(validateGrowthConfig(kind, GROWTH_DEFAULT_PAYLOADS[kind])).toMatchObject({ valid: true });
  });
  it('attribution defaults are the documented ones (30 d provider window, 7 d campaign, PROVIDER_FIRST, 1000 ms dwell, 25/13 month retention)', () => {
    expect(GROWTH_DEFAULT_PAYLOADS.ATTRIBUTION_POLICY).toMatchObject({ providerTouchWindowDays: 30, campaignClickWindowDays: 7, precedence: 'PROVIDER_FIRST', minDwellMsForProviderTouch: 1000, newPatientLookbackMonths: 24, allowOfflineEvidence: false });
    expect(DEFAULT_RETENTION).toEqual({ linkedMonths: GROWTH_DEFAULT_PAYLOADS.ATTRIBUTION_POLICY!.touchEvidenceRetentionMonths, unlinkedMonths: GROWTH_DEFAULT_PAYLOADS.ATTRIBUTION_POLICY!.unlinkedTouchRetentionMonths });
  });
  it('the market default is a column default, and the market payload carries no secret value', () => {
    expect(GROWTH_DEFAULT_MARKET).toBe('EG');
    expect(JSON.stringify(GROWTH_DEFAULT_PAYLOADS.MARKET_GROWTH)).not.toMatch(/secret|token|password/i);
  });
});

describe('growth flags are registered (ADR-023/024/025)', () => {
  const mine = new Map(FLAG_CATALOGUE.map((f) => [f.key, f]));
  it('every GROWTH_FLAG key is in the Kiorex catalogue and in @kiorex/contracts with the same product and class', () => {
    for (const key of Object.values(GROWTH_FLAG)) {
      const m = mine.get(key); const c = (CONTRACT_FLAGS as readonly any[]).find((x) => x.key === key);
      expect(m).toBeDefined(); expect(c).toBeDefined();
      expect(m!.product).toBe(c.product);
      expect(m!.launchLocked === true).toBe(c.launchLocked);
      expect(m!.scopes.map((s) => s.toLowerCase())).toEqual(c.scopes);
      expect(m!.dependsOn).toEqual(c.dependsOn);
      expect(m!.whenOff).toBe(c.whenOff);
    }
    expect(GROWTH_FLAG.ATTRIBUTION).toBe(FLAGS.GROWTH_ATTRIBUTION);
  });
  it('only the counsel-gated flags are launch-locked; everything else ships ON', () => {
    const locked = Object.values(GROWTH_FLAG).filter((k) => mine.get(k)!.launchLocked);
    expect([...locked].sort()).toEqual([...GROWTH_LAUNCH_LOCKED_FLAGS].sort());
    expect(locked).toEqual(expect.arrayContaining(['growth.analytics_visitor', 'growth.marketing_messaging', 'growth.patient_referral', 'growth.rewards', 'kiorex.whatsapp_ai_assistant']));
    for (const k of locked) expect(mine.get(k)!.gateHint).toContain('NEEDS_HUMAN');
  });
  it('rewards is a money-path flag (two-person OFF); no safety control is a growth flag', () => {
    expect(mine.get('growth.rewards')!.moneyPath).toBe(true);
    for (const k of Object.values(GROWTH_FLAG)) expect(k).not.toMatch(/safety|emergency|sos|critical/);
  });
});
