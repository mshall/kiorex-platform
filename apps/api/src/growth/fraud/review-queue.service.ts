import { Injectable } from '@nestjs/common';
import { ApiError } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { FraudCaseService } from './case.service';
import type { FraudRulesConfig } from './fraud-config';

const BULK_MAX = 100;

/** The review queue (GRW-P3-D): SLA timers, assignment, bulk dismiss with a reason. Evidence is hashes and check rows only. */
@Injectable()
export class FraudReviewQueueService {
  constructor(private readonly prisma: PrismaService, private readonly cases: FraudCaseService) {}

  async list(q: { status?: string; kind?: string; band?: string; breached?: boolean; take?: number; market?: string }, now = new Date()) {
    const where = {
      market: q.market ?? 'EG', ...(q.status ? { status: q.status } : { status: { in: ['OPEN', 'IN_REVIEW', 'APPEALED'] } }), ...(q.kind ? { kind: q.kind } : {}), ...(q.band ? { band: q.band } : {}),
      ...(q.breached ? { slaDueAt: { lt: now } } : {}),
    };
    const rows = await this.prisma.fraudCase.findMany({ where, orderBy: [{ band: 'desc' }, { slaDueAt: 'asc' }], take: Math.min(Math.max(q.take ?? 50, 1), 200) });
    return rows.map((c) => ({ id: c.id, kind: c.kind, score: c.score, band: c.band, status: c.status, mode: c.mode, slaDueAt: c.slaDueAt, breached: !!c.slaDueAt && c.slaDueAt < now && ['OPEN', 'IN_REVIEW', 'APPEALED'].includes(c.status), assignedTo: c.assignedTo, createdAt: c.createdAt, subjectRef: c.subjectHash.slice(0, 12) }));
  }

  async summary(now = new Date(), market = 'EG') {
    const open = await this.prisma.fraudCase.groupBy({ by: ['kind', 'band', 'mode'], where: { market, status: { in: ['OPEN', 'IN_REVIEW', 'APPEALED'] } }, _count: { _all: true } });
    const breached = await this.prisma.fraudCase.count({ where: { market, status: { in: ['OPEN', 'IN_REVIEW', 'APPEALED'] }, slaDueAt: { lt: now } } });
    return { open: open.map((r) => ({ kind: r.kind, band: r.band, mode: r.mode, count: r._count._all })), breached };
  }

  /** Dismiss many low-risk cases at once, with one reason (at least 10 characters). Only OPEN or IN_REVIEW cases of band LOW or MEDIUM: a HIGH case is never bulk-dismissed. */
  async bulkDismiss(ids: string[], actor: string, reason: string, cfg: FraudRulesConfig) {
    if (!reason || reason.trim().length < 10) throw new ApiError(400, 'REASON_REQUIRED', 'A bulk dismissal needs a reason (at least 10 characters)');
    if (!ids.length || ids.length > BULK_MAX) throw new ApiError(400, 'GROWTH_INVALID_REQUEST', `Send 1 to ${BULK_MAX} case ids`);
    const rows = await this.prisma.fraudCase.findMany({ where: { id: { in: ids }, status: { in: ['OPEN', 'IN_REVIEW'] }, band: { in: ['LOW', 'MEDIUM'] } }, select: { id: true } });
    let done = 0;
    for (const r of rows) { try { await this.cases.decide(r.id, actor, { decision: 'DISMISS', note: reason }, cfg); done++; } catch { /* state moved: skipped */ } }
    return { requested: ids.length, dismissed: done, skipped: ids.length - done };
  }

  /** SLA sweep: a breached case writes ONE audit row (the ops item) and shows as breached in the queue. Idempotent per case. */
  async slaSweep(now = new Date()): Promise<{ breached: number; raised: number }> {
    const late = await this.prisma.fraudCase.findMany({ where: { status: { in: ['OPEN', 'IN_REVIEW', 'APPEALED'] }, slaDueAt: { lt: now } }, select: { id: true, kind: true, band: true } });
    let raised = 0;
    for (const c of late) {
      if (await this.prisma.auditLog.findFirst({ where: { action: 'growth.fraud.sla_breached', resourceId: c.id }, select: { id: true } })) continue;
      await this.prisma.auditLog.create({ data: { actor: 'system:fraud', action: 'growth.fraud.sla_breached', resource: 'FraudCase', resourceId: c.id, metadata: { kind: c.kind, band: c.band } } });
      raised++;
    }
    return { breached: late.length, raised };
  }
}
