import { Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { growthKey } from '../../common/privacy-hash';
import { PrismaService } from '../../prisma/prisma.service';
import { LIMITS } from './assistant.policy';
import { emptyContext, type SessionContext, type SessionState } from './assistant.types';
import type { AssistantSession } from '../../prisma/generated/client';

export const phoneHashOf = (phone: string): string => createHmac('sha256', growthKey('assistant-phone')).update(phone).digest('base64url').slice(0, 40);

export interface LoadedSession { session: AssistantSession; ctx: SessionContext; created: boolean; expiredPrevious: SessionContext | null }

/**
 * `AssistantSession` lifecycle. One live session per WhatsApp conversation; it expires 24 h after the last message (the WhatsApp service window). Working memory is `context` (ids and counters only).
 * Phone numbers are stored only as a keyed hash; message text only as redacted turns.
 */
@Injectable()
export class AssistantSessionService {
  constructor(private readonly prisma: PrismaService) {}

  async load(o: { conversationId: string; phone: string; sub: string | null; market: string; language: string; now?: Date }): Promise<LoadedSession> {
    const now = o.now ?? new Date();
    const expiresAt = new Date(now.getTime() + LIMITS.sessionHours * 3_600_000);
    let s = await this.prisma.assistantSession.findUnique({ where: { channelConversationId: o.conversationId } });
    let expiredPrevious: SessionContext | null = null;
    if (s && (s.expiresAt <= now || s.closedAt)) {
      // an expired or closed session is archived under its own key (turns purge on their own schedule) and a fresh one starts
      expiredPrevious = this.ctxOf(s);
      await this.prisma.assistantSession.update({ where: { id: s.id }, data: { channelConversationId: `${o.conversationId}:old:${s.id}`, closedAt: s.closedAt ?? now, state: 'CLOSED' } });
      s = null;
    }
    if (!s) {
      s = await this.prisma.assistantSession.create({ data: { channelConversationId: o.conversationId, market: o.market, sub: o.sub, phoneHash: phoneHashOf(o.phone), state: 'GREETING', language: o.language, expiresAt, context: emptyContext() as object } });
      return { session: s, ctx: emptyContext(), created: true, expiredPrevious };
    }
    if (s.sub !== o.sub) s = await this.prisma.assistantSession.update({ where: { id: s.id }, data: { sub: o.sub } });
    return { session: s, ctx: this.ctxOf(s), created: false, expiredPrevious };
  }

  ctxOf(s: { context: unknown }): SessionContext {
    const c = (s.context ?? {}) as Partial<SessionContext>;
    const base = emptyContext();
    return { ...base, ...c, shown: { ...base.shown, ...(c.shown ?? {}) }, idsSeen: Array.isArray(c.idsSeen) ? c.idsSeen.slice(-200) : [] };
  }

  async save(id: string, patch: { state?: SessionState; ctx?: SessionContext; language?: string; touch?: boolean; escalatedAt?: Date | null; closedAt?: Date | null; turnsIncrement?: boolean; lastToolAt?: Date }, now = new Date()) {
    return this.prisma.assistantSession.update({
      where: { id },
      data: {
        ...(patch.state ? { state: patch.state } : {}), ...(patch.ctx ? { context: patch.ctx as object } : {}), ...(patch.language ? { language: patch.language } : {}),
        ...(patch.touch !== false ? { expiresAt: new Date(now.getTime() + LIMITS.sessionHours * 3_600_000) } : {}),
        ...(patch.escalatedAt !== undefined ? { escalatedAt: patch.escalatedAt } : {}), ...(patch.closedAt !== undefined ? { closedAt: patch.closedAt } : {}),
        ...(patch.turnsIncrement ? { turns: { increment: 1 } } : {}), ...(patch.lastToolAt ? { lastToolAt: patch.lastToolAt } : {}),
      },
    });
  }

  /** One inbound row and (later) one outbound row per turn; `seq` is the session's turn counter. Outbound bodies are NOT stored (template key only): bookings and doctors are health context. */
  async addTurn(o: { sessionId: string; seq: number; direction: 'IN' | 'OUT'; redactedText?: string; intent?: string; toolName?: string; modelMode?: string; tokensIn?: number; tokensOut?: number; costMinor?: number; latencyMs?: number; outcome?: string; retentionDays: number }) {
    return this.prisma.assistantTurn.upsert({
      where: { sessionId_seq_direction: { sessionId: o.sessionId, seq: o.seq, direction: o.direction } },
      create: { sessionId: o.sessionId, seq: o.seq, direction: o.direction, redactedText: o.redactedText ?? '', intent: o.intent, toolName: o.toolName, modelMode: o.modelMode ?? 'mock', tokensIn: o.tokensIn ?? 0, tokensOut: o.tokensOut ?? 0, costMinor: o.costMinor ?? 0, latencyMs: o.latencyMs ?? 0, outcome: o.outcome ?? 'OK', purgeAfter: new Date(Date.now() + o.retentionDays * 86_400_000) },
      update: { ...(o.intent !== undefined ? { intent: o.intent } : {}), ...(o.toolName !== undefined ? { toolName: o.toolName } : {}), ...(o.tokensIn !== undefined ? { tokensIn: o.tokensIn } : {}), ...(o.tokensOut !== undefined ? { tokensOut: o.tokensOut } : {}), ...(o.costMinor !== undefined ? { costMinor: o.costMinor } : {}), ...(o.latencyMs !== undefined ? { latencyMs: o.latencyMs } : {}), ...(o.outcome !== undefined ? { outcome: o.outcome } : {}), ...(o.modelMode ? { modelMode: o.modelMode } : {}) },
    });
  }

  async addToolCall(o: { turnId: string; tool: string; argsRedacted: Record<string, unknown>; resultKind: string; resultRef?: string; confirmNonceHash?: string }) {
    return this.prisma.assistantToolCall.create({ data: { turnId: o.turnId, tool: o.tool, argsRedacted: o.argsRedacted as object, resultKind: o.resultKind, resultRef: o.resultRef?.slice(0, 80), confirmNonceHash: o.confirmNonceHash } });
  }

  /** Transcript for a human: the redacted inbound turns plus the template keys of what the assistant answered. */
  async transcript(sessionId: string) {
    const rows = await this.prisma.assistantTurn.findMany({ where: { sessionId }, orderBy: [{ seq: 'asc' }, { direction: 'asc' }], take: 120 });
    return rows.map((t) => ({ seq: t.seq, direction: t.direction, text: t.direction === 'IN' ? t.redactedText : '', template: t.direction === 'OUT' ? t.intent : t.intent, outcome: t.outcome, at: t.createdAt }));
  }
}
