import { validateGrowthConfig } from './growth-config.service';
import { FRAUD_RULES_DEFAULTS } from '../fraud/fraud-config';
import { SEO_AUTOMATION_DEFAULTS } from '../seo-automation/seo-automation-config';

/** The two wave 7 kinds are validated by their own validators (the contract schema joins with 1.13.0; both must pass once it does). */
describe('FRAUD_RULES and SEO_AUTOMATION payload validation', () => {
  it('the shipped defaults are valid; a bad piece is refused with a message', () => {
    expect(validateGrowthConfig('FRAUD_RULES', FRAUD_RULES_DEFAULTS()).valid).toBe(true);
    expect(validateGrowthConfig('SEO_AUTOMATION', SEO_AUTOMATION_DEFAULTS()).valid).toBe(true);
    const f = validateGrowthConfig('FRAUD_RULES', { ...FRAUD_RULES_DEFAULTS(), twoPersonOnMoney: false }); expect(f.valid).toBe(false);
    if (!f.valid) expect(f.errors.join()).toMatch(/twoPersonOnMoney/);
    const s = validateGrowthConfig('SEO_AUTOMATION', { autoNoindex: 'yes' }); expect(s.valid).toBe(false);
    expect(validateGrowthConfig('FRAUD_RULES', 'nope').valid).toBe(false); expect(validateGrowthConfig('SEO_AUTOMATION', []).valid).toBe(false);
  });
});
