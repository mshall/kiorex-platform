import { randomBytes } from 'node:crypto';
import { GROWTH_DEFAULT_PAYLOADS, GrowthConfigService } from '../src/growth/growth-public';
import { activateConfig, unlockFlag } from './growth-helpers';
import { TestCtx } from './harness';

export const DAY = 86_400_000;
/** REWARD_RULES with real numbers (the shipped defaults are all 0 until the founder sets pricing, AD-4). */
export const rewardRules = (o: Record<string, any> = {}) => {
  const d = GROWTH_DEFAULT_PAYLOADS.REWARD_RULES as any;
  return { ...d, amounts: { referrerMinor: 5000, refereeMinor: 3000, repeatMinor: 1000, promoMinor: 2000 }, perUserAnnualCapMinor: 100_000, perCampaignCapMinor: 1_000_000, ruleBudgetCeilingMinor: 10_000_000, ...o,
    credit: { ...d.credit, ...(o.credit ?? {}), refundAsCredit: { ...d.credit.refundAsCredit, ...(o.credit?.refundAsCredit ?? {}) }, family: { ...d.credit.family, ...(o.credit?.family ?? {}) } } };
};
export const referralRules = (o: Record<string, any> = {}) => ({ ...(GROWTH_DEFAULT_PAYLOADS.REFERRAL_RULES as any), ...o });
export const setRewardRules = async (c: TestCtx, o: Record<string, any> = {}) => { await activateConfig(c, 'REWARD_RULES', rewardRules(o), { announcement: 'Reward amounts for the test stack.' }); c.get(GrowthConfigService).invalidate(); };
export const setReferralRules = async (c: TestCtx, o: Record<string, any> = {}) => { await activateConfig(c, 'REFERRAL_RULES', referralRules(o), { announcement: 'Referral rules for the test stack.' }); c.get(GrowthConfigService).invalidate(); };
export const unlockAll = async (c: TestCtx, keys: Array<Parameters<typeof unlockFlag>[1]> = ['growth.rewards', 'growth.patient_referral']) => { for (const k of keys) await unlockFlag(c, k); };
let n = 0;
export const uid = (p: string) => `${p}_${Date.now().toString(36)}${(++n).toString(36)}${randomBytes(2).toString('hex')}`;
