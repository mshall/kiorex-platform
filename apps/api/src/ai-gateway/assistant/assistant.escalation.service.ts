import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AssistantAudit } from './assistant.audit';
import { AssistantSessionService } from './assistant.session.service';

/**
 * Human escalation. `handoff_to_human`, a trigger word or two clarify failures in a row create an `AssistantEscalation` with `slaDueAt` (policy minutes) and the REDACTED transcript. The assistant then stays
 * silent until a human closes it. Clinical emergencies never come here: they get the fixed emergency copy and nothing else.
 */
@Injectable()
export class AssistantEscalationService {
  constructor(private readonly prisma: PrismaService, private readonly sessions: AssistantSessionService, private readonly audit: AssistantAudit) {}

  async open(o: { sessionId: string; reason: string; slaMinutes: number; now?: Date }) {
    const open = await this.prisma.assistantEscalation.findFirst({ where: { sessionId: o.sessionId, status: { in: ['OPEN', 'ACKED'] } } });
    if (open) return open;
    const now = o.now ?? new Date();
    const transcript = await this.sessions.transcript(o.sessionId);
    const e = await this.prisma.assistantEscalation.create({ data: { sessionId: o.sessionId, reason: o.reason.slice(0, 40), slaDueAt: new Date(now.getTime() + o.slaMinutes * 60_000), transcript: transcript as object } });
    await this.audit.record('escalation_created', o.sessionId, { reason: o.reason, escalationId: e.id });
    return e;
  }

  async isOpen(sessionId: string): Promise<boolean> { return !!(await this.prisma.assistantEscalation.findFirst({ where: { sessionId, status: { in: ['OPEN', 'ACKED'] } }, select: { id: true } })); }

  async ack(id: string, by: string) {
    const r = await this.prisma.assistantEscalation.updateMany({ where: { id, status: 'OPEN' }, data: { status: 'ACKED', ackBy: by } });
    if (r.count) await this.audit.record('escalation_acked', null, { escalationId: id, actor: by }, by);
    return r.count === 1;
  }

  /** Closing hands the conversation back: the session leaves HANDOFF so the next message starts a normal turn. */
  async close(id: string, by: string) {
    const e = await this.prisma.assistantEscalation.findUnique({ where: { id } });
    if (!e || e.status === 'CLOSED') return false;
    await this.prisma.assistantEscalation.update({ where: { id }, data: { status: 'CLOSED', closedAt: new Date(), closedBy: by } });
    await this.sessions.save(e.sessionId, { state: 'UNDERSTAND', escalatedAt: null });
    await this.audit.record('escalation_closed', e.sessionId, { escalationId: id, actor: by }, by);
    return true;
  }
}
