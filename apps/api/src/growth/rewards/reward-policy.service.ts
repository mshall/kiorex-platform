import { Injectable } from '@nestjs/common';
import { FlagsService } from '../../control-plane/control-plane-public';
import { GrowthConfigService } from '../config/growth-config.service';
import { GROWTH_DEFAULT_MARKET, GROWTH_FLAG } from '../growth-flags';
import { toRewardRules, type RewardRules } from './reward-rules';
import type { ReferralRulesView } from '../referral/referral-qualification';

/**
 * One place that answers "what are the rules and switches right now" for the referral and reward modules. Safety controls are never flags and none is read here: the flags only gate
 * the growth money features (ADR-023/024), and with every flag OFF nothing in this module issues, applies or reverses value.
 */
@Injectable()
export class RewardPolicyService {
  constructor(private readonly config: GrowthConfigService, private readonly flags: FlagsService) {}

  async rewardRules(market = GROWTH_DEFAULT_MARKET): Promise<{ rules: RewardRules; versionId: string; source: string }> {
    const r = await this.config.resolve('REWARD_RULES', { market });
    return { rules: toRewardRules(r.payload), versionId: r.versionId, source: r.source };
  }
  async referralRules(market = GROWTH_DEFAULT_MARKET): Promise<{ rules: ReferralRulesView; versionId: string }> {
    const r = await this.config.resolve('REFERRAL_RULES', { market });
    return { rules: r.payload as unknown as ReferralRulesView, versionId: r.versionId };
  }
  private on(key: string, market = GROWTH_DEFAULT_MARKET) { return this.flags.isEnabled(key, { market }); }
  rewardsOn(m?: string) { return this.on(GROWTH_FLAG.REWARDS, m); }
  referralOn(m?: string) { return this.on(GROWTH_FLAG.PATIENT_REFERRAL, m); }
  creditOn(m?: string) { return this.on(GROWTH_FLAG.PATIENT_CREDIT, m); }
  familyOn(m?: string) { return this.on(GROWTH_FLAG.FAMILY_CREDIT, m); }
  goodwillOn(m?: string) { return this.on(GROWTH_FLAG.SUPPORT_GOODWILL, m); }
  fraudEnforced(m?: string) { return this.on(GROWTH_FLAG.REFERRAL_FRAUD_ENFORCE, m); }
  /** The mode new lots are issued in: CREDIT only when the rules say so AND the launch-locked flag is effective; anything else is COUPON (the founder default and the lowest exposure). */
  async issueMode(rules: RewardRules, m?: string): Promise<'COUPON' | 'CREDIT'> { return rules.mode === 'CREDIT' && (await this.creditOn(m)) ? 'CREDIT' : 'COUPON'; }
  /** The 'keep as credit' option exists only when all three switches say so. */
  async refundCreditAvailable(rules?: RewardRules, m?: string): Promise<boolean> {
    const r = rules ?? (await this.rewardRules(m)).rules;
    return r.credit.refundAsCredit.enabled && (await this.creditOn(m)) && (await this.on(GROWTH_FLAG.REFUND_AS_CREDIT, m));
  }
  async familyAvailable(rules?: RewardRules, m?: string): Promise<boolean> {
    const r = rules ?? (await this.rewardRules(m)).rules;
    return r.credit.family.enabled && (await this.creditOn(m)) && (await this.familyOn(m));
  }
}
