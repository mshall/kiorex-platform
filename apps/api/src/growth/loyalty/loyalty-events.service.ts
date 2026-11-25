import { Injectable, OnModuleInit } from '@nestjs/common';
import { OutboxService } from '../../outbox/outbox-public';
import type { Prisma } from '../../prisma/generated/client';
import type { PrismaService } from '../../prisma/prisma.service';

export const LOYALTY_EVENT_TYPES = ['LoyaltyPointsAccrued', 'LoyaltyPointsConverted', 'PartnershipCodeRedeemed'] as const;
export type LoyaltyEventType = (typeof LOYALTY_EVENT_TYPES)[number];
type Db = Prisma.TransactionClient | PrismaService;

/** Kiorex-internal loyalty and partnership events (the unreleased contracts set). Opaque references and amounts only: never a sub, a code, a name, a phone or a booking. No handler delivers them anywhere yet; a no-op consumer keeps the outbox clean. */
@Injectable()
export class LoyaltyEventsService implements OnModuleInit {
  constructor(private readonly outbox: OutboxService) {}
  onModuleInit() { for (const t of LOYALTY_EVENT_TYPES) this.outbox.register(t, async () => undefined); }
  async emit(db: Db, type: LoyaltyEventType, aggregateType: 'LoyaltyAccount' | 'PartnershipProgram', aggregateId: string, data: Record<string, unknown>, dedupeKey: string): Promise<void> {
    await this.outbox.enqueue(db as never, { type, aggregateType, aggregateId, payload: { ...data, aggregateType, aggregateId }, dedupeKey: `${type}:${dedupeKey}` });
  }
}
