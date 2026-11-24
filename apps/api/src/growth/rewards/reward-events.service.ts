import { Injectable, OnModuleInit } from '@nestjs/common';
import { OutboxService } from '../../outbox/outbox-public';
import type { Db } from './reward-ledger.service';

/** Contract events of the referral and reward engine (kiorex-contracts events/*.schema.json). The payload is the event `data`: opaque references, amounts, reason codes. Never a sub, phone, name or booking id. */
export const REWARD_EVENT_TYPES = [
  'ReferralCodeIssued', 'ReferralRelationshipCreated', 'ReferralQualified', 'ReferralRejected',
  'RewardIssued', 'RewardRedeemed', 'RewardReversed', 'RewardExpired', 'RewardHeld', 'RewardRestored', 'GoodwillGranted', 'RefundDestinationChosen',
] as const;
export type RewardEventType = (typeof REWARD_EVENT_TYPES)[number];

@Injectable()
export class RewardEventsService implements OnModuleInit {
  constructor(private readonly outbox: OutboxService) {}
  /** These events have no consumer in this repository yet (lifecycle journeys and analytics read the tables): a no-op handler keeps the outbox clean instead of dead-lettering them. */
  onModuleInit() { for (const t of REWARD_EVENT_TYPES) this.outbox.register(t, async () => undefined); }
  async emit(db: Db, type: RewardEventType, aggregateType: string, aggregateId: string, data: Record<string, unknown>, dedupeKey: string): Promise<void> {
    await this.outbox.enqueue(db as never, { type, aggregateType, aggregateId, payload: { ...data, aggregateType, aggregateId }, dedupeKey: `${type}:${dedupeKey}` });
  }
}
