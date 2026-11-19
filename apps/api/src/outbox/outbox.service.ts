import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { cfg } from '../common/config';
import { PrismaService, Tx } from '../prisma/prisma.service';

export const OUTBOX_MAX_ATTEMPTS = 8;
export type OutboxHandler = (event: { id: string; type: string; aggregateId: string; target: string; payload: any; attempts: number }) => Promise<void>;

export interface EnqueueInput {
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  target?: string;
  dedupeKey?: string;
}

export const backoffMs = (attempts: number) => Math.min(300_000, 1_000 * 2 ** Math.max(0, attempts));

/**
 * Transactional outbox (KX-09 §01): rows are written in the same DB transaction as the state change
 * (pass the `tx`), dispatched by a 5 s loop with exponential backoff, DEAD after 8 attempts.
 */
@Injectable()
export class OutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('outbox');
  private handlers = new Map<string, OutboxHandler>();
  private timer?: NodeJS.Timeout;
  constructor(private readonly prisma: PrismaService) {}

  register(type: string, handler: OutboxHandler) {
    this.handlers.set(type, handler);
  }

  async enqueue(client: Tx | PrismaService, e: EnqueueInput) {
    try {
      return await client.outboxEvent.create({
        data: { type: e.type, aggregateType: e.aggregateType, aggregateId: e.aggregateId, target: e.target ?? 'INTERNAL', payload: e.payload as Prisma.InputJsonValue, dedupeKey: e.dedupeKey },
      });
    } catch (err) {
      if (e.dedupeKey && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null; // already enqueued
      throw err;
    }
  }

  async processBatch(limit = 50): Promise<{ processed: number; sent: number; failed: number; dead: number }> {
    const rows = await this.prisma.outboxEvent.findMany({
      where: { status: { in: ['PENDING', 'FAILED'] }, nextAttemptAt: { lte: new Date() } },
      orderBy: [{ aggregateId: 'asc' }, { createdAt: 'asc' }],
      take: limit,
    });
    let sent = 0, failed = 0, dead = 0;
    for (const row of rows) {
      const r = await this.deliverOne(row);
      if (r === 'sent') sent++;
      else if (r === 'dead') dead++;
      else failed++;
    }
    return { processed: rows.length, sent, failed, dead };
  }

  private async deliverOne(row: { id: string; type: string; aggregateId: string; target: string; payload: unknown; attempts: number }): Promise<'sent' | 'failed' | 'dead'> {
    const handler = this.handlers.get(row.type);
    try {
      if (!handler) throw new Error(`no handler registered for ${row.type}`);
      await handler({ ...row, payload: row.payload });
      await this.prisma.outboxEvent.update({ where: { id: row.id }, data: { status: 'SENT', sentAt: new Date(), attempts: row.attempts + 1, lastError: null } });
      return 'sent';
    } catch (err) {
      const attempts = row.attempts + 1;
      const isDead = attempts >= OUTBOX_MAX_ATTEMPTS;
      await this.prisma.outboxEvent.update({
        where: { id: row.id },
        data: { status: isDead ? 'DEAD' : 'FAILED', attempts, lastError: String(err instanceof Error ? err.message : err).slice(0, 500), nextAttemptAt: new Date(Date.now() + backoffMs(attempts)) },
      });
      if (isDead) this.log.error(`outbox ${row.id} ${row.type} DEAD after ${attempts} attempts`);
      return isDead ? 'dead' : 'failed';
    }
  }

  /** Ops replay (KXM-OP-03). Resets DEAD/FAILED rows and delivers immediately. */
  async replay(id: string): Promise<{ ok: boolean; status?: string }> {
    const row = await this.prisma.outboxEvent.findUnique({ where: { id } });
    if (!row) return { ok: false };
    await this.prisma.outboxEvent.update({ where: { id }, data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date() } });
    const fresh = await this.prisma.outboxEvent.findUniqueOrThrow({ where: { id } });
    await this.deliverOne(fresh);
    const after = await this.prisma.outboxEvent.findUniqueOrThrow({ where: { id } });
    return { ok: true, status: after.status };
  }

  list(q: { status?: string; type?: string; take?: number }) {
    return this.prisma.outboxEvent.findMany({ where: { ...(q.status ? { status: q.status } : {}), ...(q.type ? { type: q.type } : {}) }, orderBy: { createdAt: 'desc' }, take: Math.min(q.take ?? 50, 200) });
  }

  async stats() {
    const [pending, failed, dead, oldest] = await Promise.all([
      this.prisma.outboxEvent.count({ where: { status: 'PENDING' } }),
      this.prisma.outboxEvent.count({ where: { status: 'FAILED' } }),
      this.prisma.outboxEvent.count({ where: { status: 'DEAD' } }),
      this.prisma.outboxEvent.findFirst({ where: { status: { in: ['PENDING', 'FAILED'] } }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
    ]);
    const lagMs = oldest ? Date.now() - oldest.createdAt.getTime() : 0;
    return { pending, failed, dead, lagMs, lagAlert: lagMs > 2 * 60_000 };
  }

  onModuleInit() {
    if (!cfg().jobsEnabled) return;
    this.timer = setInterval(() => void this.processBatch().catch((e) => this.log.error(e)), 5_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
