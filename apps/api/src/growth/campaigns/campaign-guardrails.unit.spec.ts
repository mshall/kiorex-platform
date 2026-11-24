import { GROWTH_DEFAULT_PAYLOADS } from '../config/growth-defaults';
import { approvalRequired, budgetExhausted, budgetIncreaseNeedsApproval, ceilingBreach, dailyCapReached, plannedInMonth, thresholdsToFire, utilisationBp, validateAssetRef, validatePlan, validateSpendLine, type CampaignPolicy } from './campaign-guardrails';

const policy = GROWTH_DEFAULT_PAYLOADS.CAMPAIGN_POLICY as unknown as CampaignPolicy;
const Z = 'Africa/Cairo';
const plan = (o: Record<string, unknown> = {}) => ({ budgetTotalMinor: 1_000_000, budgetDailyMinor: 100_000, currency: 'EGP', channels: ['EMAIL'], startsAt: new Date('2027-01-01T00:00:00Z'), endsAt: new Date('2027-01-31T00:00:00Z'), ...o }) as Parameters<typeof validatePlan>[0];

describe('campaign guardrails (GRW-P2-A)', () => {
  it('validatePlan: caps required and positive, daily within total, currency equals the market currency, channels allowed, window ordered', () => {
    expect(validatePlan(plan(), policy, 'EGP')).toEqual([]);
    const paths = (p: Parameters<typeof validatePlan>[0]) => validatePlan(p, policy, 'EGP').map((e) => e.path);
    expect(paths(plan({ budgetTotalMinor: 0 }))).toContain('/budgetTotalMinor');
    expect(paths(plan({ budgetDailyMinor: 0 }))).toContain('/budgetDailyMinor');
    expect(paths(plan({ budgetTotalMinor: -5 }))).toContain('/budgetTotalMinor');
    expect(paths(plan({ budgetTotalMinor: 10.5 }))).toContain('/budgetTotalMinor');
    expect(paths(plan({ budgetDailyMinor: 2_000_000 }))).toContain('/budgetDailyMinor');
    expect(paths(plan({ currency: 'USD' }))).toContain('/currency');
    expect(validatePlan(plan(), policy, '')).toEqual([{ path: '/currency', message: 'The market has no currency configured' }]);
    expect(paths(plan({ channels: [] }))).toContain('/channels');
    expect(paths(plan({ channels: ['TELEPATHY'] }))).toContain('/channels');
    expect(paths(plan({ channels: ['EMAIL', 'EMAIL'] }))).toContain('/channels');
    expect(paths(plan({ startsAt: new Date('2027-02-01'), endsAt: new Date('2027-01-01') }))).toContain('/endsAt');
    expect(validatePlan(plan({ channels: ['PAID_SEARCH'] }), { ...policy, allowedChannels: ['EMAIL'] }, 'EGP')[0]?.message).toMatch(/not allowed/);
  });
  it('approval is needed above the threshold, for a sensitive channel, or when the policy flag is ON; OFF never lifts the first two', () => {
    expect(approvalRequired({ budgetTotalMinor: 1_000, channels: ['EMAIL'] }, policy, false)).toEqual({ required: false, reasons: [] });
    expect(approvalRequired({ budgetTotalMinor: 2_000_000, channels: ['EMAIL'] }, policy, false).required).toBe(false); // at the threshold, not above
    expect(approvalRequired({ budgetTotalMinor: 2_000_001, channels: ['EMAIL'] }, policy, false).reasons).toEqual(['BUDGET_ABOVE_THRESHOLD']);
    expect(approvalRequired({ budgetTotalMinor: 1_000, channels: ['EMAIL', 'WHATSAPP'] }, policy, false).reasons).toEqual(['SENSITIVE_CHANNEL']);
    expect(approvalRequired({ budgetTotalMinor: 1_000, channels: ['SMS'] }, policy, false).required).toBe(true);
    expect(approvalRequired({ budgetTotalMinor: 1_000, channels: ['EMAIL'] }, policy, true).reasons).toEqual(['POLICY_FLAG']);
    expect(approvalRequired({ budgetTotalMinor: 9_000_000, channels: ['WHATSAPP'] }, policy, true).reasons).toEqual(['BUDGET_ABOVE_THRESHOLD', 'SENSITIVE_CHANNEL', 'POLICY_FLAG']);
  });
  it('a budget increase over the policy percent needs its own approval; decreases and small increases do not', () => {
    expect(budgetIncreaseNeedsApproval(1000, 1200, policy)).toBe(false); // exactly 20 %
    expect(budgetIncreaseNeedsApproval(1000, 1201, policy)).toBe(true);
    expect(budgetIncreaseNeedsApproval(1000, 500, policy)).toBe(false);
    expect(budgetIncreaseNeedsApproval(1000, 1000, policy)).toBe(false);
  });
  it('utilisation rounds down; alerts fire once per threshold in ascending order; 100 percent means exhausted', () => {
    expect(utilisationBp(499_999, 1_000_000)).toBe(4999); expect(utilisationBp(500_000, 1_000_000)).toBe(5000); expect(utilisationBp(1_000_000, 1_000_000)).toBe(10_000); expect(utilisationBp(5, 0)).toBe(0);
    expect(thresholdsToFire(4999, policy.budgetAlertThresholdsBp, [])).toEqual([]);
    expect(thresholdsToFire(5000, policy.budgetAlertThresholdsBp, [])).toEqual([5000]);
    expect(thresholdsToFire(8200, policy.budgetAlertThresholdsBp, [5000])).toEqual([8000]);
    expect(thresholdsToFire(10_000, policy.budgetAlertThresholdsBp, [])).toEqual([5000, 8000, 10_000]); // a jump over several fires them all, once
    expect(thresholdsToFire(10_000, policy.budgetAlertThresholdsBp, [5000, 8000, 10_000])).toEqual([]);
    expect(budgetExhausted(999_999, 1_000_000)).toBe(false); expect(budgetExhausted(1_000_000, 1_000_000)).toBe(true); expect(dailyCapReached(100_000, 100_000)).toBe(true); expect(dailyCapReached(99_999, 100_000)).toBe(false);
  });
  it('spend lines: positive, whole, not in the market-local future (Cairo midnight, not UTC), not before the campaign, not on DRAFT or ARCHIVED', () => {
    const c = { startsAt: new Date('2027-01-10T00:00:00Z'), status: 'ACTIVE' as const };
    const now = new Date('2027-01-15T22:30:00Z'); // 00:30 on the 16th in Cairo (UTC+2)
    expect(validateSpendLine({ day: '2027-01-16', amountMinor: 100 }, c, now, Z)).toEqual([]); // local today even though UTC says the 15th
    expect(validateSpendLine({ day: '2027-01-17', amountMinor: 100 }, c, now, Z)).toEqual(['Spend cannot be dated in the future']);
    expect(validateSpendLine({ day: '2027-01-15', amountMinor: -1 }, c, now, Z)[0]).toMatch(/positive/);
    expect(validateSpendLine({ day: '2027-01-15', amountMinor: 1.5 }, c, now, Z)[0]).toMatch(/positive/);
    expect(validateSpendLine({ day: '2027-01-01', amountMinor: 100 }, c, now, Z)).toEqual(['Spend cannot be dated before the campaign starts']);
    expect(validateSpendLine({ day: 'nope', amountMinor: 100 }, c, now, Z)[0]).toMatch(/YYYY-MM-DD/);
    expect(validateSpendLine({ day: '2027-01-15', amountMinor: 100 }, { ...c, status: 'DRAFT' }, now, Z)[0]).toMatch(/cannot receive spend/);
    expect(validateSpendLine({ day: '2027-01-15', amountMinor: 100 }, { ...c, status: 'ARCHIVED' }, now, Z)[0]).toMatch(/cannot receive spend/);
  });
  it('monthly ceiling: pro rata by month, ACTIVE and SCHEDULED only, the candidate counts, the first breached month is reported', () => {
    const p = { ...policy, monthlyCeilingMinor: 1_000_000 };
    const jan = { budgetTotalMinor: 600_000, startsAt: new Date('2026-12-31T22:00:00Z'), endsAt: new Date('2027-01-31T22:00:00Z') }; // Jan 1 to Jan 31 Cairo
    expect(plannedInMonth(jan, '2027-01', Z)).toBe(600_000); expect(plannedInMonth(jan, '2027-02', Z)).toBe(0);
    const split = { budgetTotalMinor: 600_000, startsAt: new Date('2027-01-16T22:00:00Z'), endsAt: new Date('2027-02-15T22:00:00Z') }; // Jan 17 to Feb 15 Cairo: 15 days in Jan, 15 in Feb
    expect(plannedInMonth(split, '2027-01', Z) + plannedInMonth(split, '2027-02', Z)).toBeGreaterThanOrEqual(600_000);
    expect(ceilingBreach(jan, [], p, Z)).toBeNull();
    expect(ceilingBreach({ ...jan, budgetTotalMinor: 500_000 }, [{ status: 'ACTIVE', ...jan }], p, Z)).toEqual({ month: '2027-01', plannedMinor: 1_100_000, ceilingMinor: 1_000_000 });
    expect(ceilingBreach({ ...jan, budgetTotalMinor: 500_000 }, [{ status: 'PAUSED', ...jan }, { status: 'DRAFT', ...jan }, { status: 'COMPLETED', ...jan }], p, Z)).toBeNull(); // only ACTIVE and SCHEDULED count
    expect(ceilingBreach({ ...jan, budgetTotalMinor: 400_000 }, [{ status: 'SCHEDULED', ...jan }], p, Z)).toBeNull(); // exactly at the ceiling is allowed
    expect(ceilingBreach({ budgetTotalMinor: 5, startsAt: null, endsAt: null }, [], p, Z)).toBeNull();
  });
  it('creative asset references: an object key under the campaign prefix or an allowlisted https host; never http, data, file, traversal or credentials', () => {
    const id = 'cmp_123';
    expect(validateAssetRef(`growth/creatives/eg/${id}/banner.png`, 'EG', id, policy)).toBeNull();
    expect(validateAssetRef('https://cdn.kiorex.com/a/b.png', 'EG', id, policy)).toBeNull();
    for (const bad of ['http://cdn.kiorex.com/a.png', 'https://evil.example/a.png', 'https://user:pw@cdn.kiorex.com/a.png', 'data:image/png;base64,AAAA', 'file:///etc/passwd', '../etc/passwd', '/abs/path.png', `growth/creatives/eg/other/banner.png`, `growth/creatives/sa/${id}/banner.png`, `growth/creatives/eg/${id}/../x.png`, 'a', 'javascript:alert(1)'])
      expect(validateAssetRef(bad, 'EG', id, policy)).not.toBeNull();
  });
});
