import { Injectable } from '@nestjs/common';
import { JourneyRunnerService, type EnrolResult } from './journey-runner.service';

/** What other modules (rewards, referral) tell the lifecycle layer. Ids only; no amounts, no clinical value. */
export type LifecycleSignal =
  | { kind: 'REWARD_ISSUED' | 'REWARD_REDEEMED' | 'REWARD_REVERSED'; sub: string; rewardId: string; at?: Date }
  | { kind: 'REWARD_EXPIRING'; sub: string; rewardId: string; expiresAt: Date }
  | { kind: 'REGISTERED'; sub: string; confirmationRequested: boolean; at?: Date };

/**
 * The façade other modules call (GRW-P2-E): `ReferralQualified`, `Reward*` outcomes and a registration that asked for a confirmation. Idempotent per (person, journey, anchor), so an event that is
 * delivered twice enrols once. A caller never sends a message itself: it says what happened, the journey layer decides (consent, caps, quiet hours) and writes the decision.
 */
@Injectable()
export class LifecycleService {
  constructor(private readonly runner: JourneyRunnerService) {}
  signal(s: LifecycleSignal): Promise<EnrolResult> {
    if (s.kind === 'REGISTERED') return this.runner.enrol({ sub: s.sub, journeyKey: 'welcome', anchorAt: s.at, params: { confirmationRequested: s.confirmationRequested } });
    const event = s.kind.slice('REWARD_'.length);
    if (s.kind === 'REWARD_EXPIRING') return this.runner.enrol({ sub: s.sub, journeyKey: 'reward-notice', anchorId: `${s.rewardId}:EXPIRING`, anchorAt: new Date(s.expiresAt.getTime() - 14 * 86_400_000), params: { event, date: s.expiresAt.toISOString().slice(0, 10) } });
    return this.runner.enrol({ sub: s.sub, journeyKey: 'reward-notice', anchorId: `${s.rewardId}:${event}`, anchorAt: s.at, params: { event } });
  }
}
