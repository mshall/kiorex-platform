import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { BookingService } from '../../booking/booking-public';
import { cfg } from '../../common/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AssistantAudit } from './assistant.audit';
import { AssistantSessionService } from './assistant.session.service';

/**
 * Hourly housekeeping of the assistant: (1) sessions past their 24 h window release their hold, revoke pending buttons and close; (2) expired nonces and one-time links are deleted after a day;
 * (3) turns past `purgeAfter` (policy retentionDays, default 30), tool calls older than 12 months and finished sessions are removed by the SECURITY DEFINER `growth_purge_expired_v2` (the retention job of
 * the growth module calls it every 6 hours; this job does not duplicate that). Subject erasure is `growth_erase_subject` (sessions, turns, tool calls, confirmations and escalations cascade).
 */
@Injectable()
export class AssistantRetentionJob implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('assistant-retention');
  private timer?: NodeJS.Timeout;
  constructor(private readonly prisma: PrismaService, private readonly booking: BookingService, private readonly audit: AssistantAudit, private readonly sessions: AssistantSessionService) {}
  onModuleInit() { if (!cfg().jobsEnabled) return; this.timer = setInterval(() => void this.runOnce().catch((e) => this.log.warn(`assistant retention failed: ${(e as Error).message}`)), 3_600_000); this.timer.unref(); }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async runOnce(now = new Date()) {
    let released = 0;
    const stale = await this.prisma.assistantSession.findMany({ where: { closedAt: null, expiresAt: { lt: now } }, take: 200 });
    for (const s of stale) {
      const ctx = this.sessions.ctxOf(s);
      if (ctx.pendingHold && s.sub) { await this.booking.release(s.sub, ctx.pendingHold.bookingId).catch(() => undefined); released++; }
      await this.prisma.assistantConfirmation.updateMany({ where: { sessionId: s.id, usedAt: null }, data: { usedAt: now, outcome: 'DECLINED' } });
      await this.prisma.assistantSession.update({ where: { id: s.id }, data: { closedAt: now, state: 'CLOSED', context: { ...ctx, pendingHold: undefined, shown: { providers: [], slots: [], bookings: [], specialties: [], lastList: null }, idsSeen: [] } as object } });
    }
    const cut = new Date(now.getTime() - 86_400_000);
    const confs = await this.prisma.assistantConfirmation.deleteMany({ where: { expiresAt: { lt: cut } } });
    const links = await this.prisma.assistantLink.deleteMany({ where: { expiresAt: { lt: cut } } });
    if (stale.length) await this.audit.record('sessions_expired', null, { count: stale.length });
    return { sessionsClosed: stale.length, holdsReleased: released, confirmationsDeleted: confs.count, linksDeleted: links.count };
  }
}
