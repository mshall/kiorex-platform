import { Injectable, OnModuleInit } from '@nestjs/common';
import { OutboxService } from '../../outbox/outbox-public';
import type { Prisma } from '../../prisma/generated/client';
import type { PrismaService } from '../../prisma/prisma.service';

export const CORPORATE_EVENT_TYPES = ['CorporateAccountCreated', 'CorporateCodeRedeemed'] as const;
export type CorporateEventType = (typeof CORPORATE_EVENT_TYPES)[number];
type Db = Prisma.TransactionClient | PrismaService;

/** Kiorex-internal corporate events (the unreleased contracts set). The payload is opaque references only: never a sub, a code, a name, a phone, an e-mail or a booking. No handler delivers them to an employer. */
@Injectable()
export class CorporateEventsService implements OnModuleInit {
  constructor(private readonly outbox: OutboxService) {}
  onModuleInit() { for (const t of CORPORATE_EVENT_TYPES) this.outbox.register(t, async () => undefined); }
  async emit(db: Db, type: CorporateEventType, aggregateId: string, data: Record<string, unknown>, dedupeKey: string): Promise<void> {
    await this.outbox.enqueue(db as never, { type, aggregateType: 'CorporateAccount', aggregateId, payload: { ...data, aggregateType: 'CorporateAccount', aggregateId }, dedupeKey: `${type}:${dedupeKey}` });
  }
}
