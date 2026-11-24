import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { sha } from './assistant.audit';
import { LIMITS } from './assistant.policy';

export type ConfirmKind = 'BOOK' | 'RESCHEDULE' | 'CANCEL';
export const BUTTON_RE = /^(CONFIRM|DECLINE):([A-Za-z0-9_-]{6,64}):([A-Za-z0-9_-]{16,48})$/;
export interface ParsedButton { decision: 'CONFIRM' | 'DECLINE'; targetRef: string; nonce: string }
export function parseButton(payload: string | undefined | null): ParsedButton | null {
  if (!payload) return null;
  const m = BUTTON_RE.exec(payload.trim());
  return m ? { decision: m[1] as 'CONFIRM' | 'DECLINE', targetRef: m[2], nonce: m[3] } : null;
}
export type ConsumeResult =
  | { ok: true; id: string; kind: ConfirmKind; targetRef: string; payload: Record<string, any> }
  | { ok: false; code: 'INVALID' | 'EXPIRED' | 'FOREIGN' | 'USED'; kind?: ConfirmKind; resultRef?: string | null; outcome?: string | null };

/**
 * One-time confirmation nonces behind the Confirm and Cancel buttons. A nonce is bound to one session, one verified subject and one target; only its sha256 is stored. Whether a booking, a
 * reschedule or a cancellation runs is decided by this table and the exact button payload of the CURRENT inbound message: it is code, never a model choice. A second press of the same button
 * is idempotent (`USED`, no second action); a payload issued for another subject or session is `FOREIGN` and runs nothing.
 */
@Injectable()
export class ConfirmationStore {
  constructor(private readonly prisma: PrismaService) {}

  async issue(o: { sessionId: string; sub: string; kind: ConfirmKind; targetRef: string; payload?: Record<string, unknown>; ttlMinutes?: number }) {
    const nonce = randomBytes(18).toString('base64url');
    await this.prisma.assistantConfirmation.create({ data: { sessionId: o.sessionId, sub: o.sub, kind: o.kind, targetRef: o.targetRef, payload: (o.payload ?? {}) as object, nonceHash: sha(nonce), expiresAt: new Date(Date.now() + (o.ttlMinutes ?? LIMITS.confirmTtlMinutes) * 60_000) } });
    return { confirmId: `CONFIRM:${o.targetRef}:${nonce}`, declineId: `DECLINE:${o.targetRef}:${nonce}`, nonceHash: sha(nonce) };
  }

  async consume(b: ParsedButton, who: { sessionId: string; sub: string }, now = new Date()): Promise<ConsumeResult> {
    const row = await this.prisma.assistantConfirmation.findUnique({ where: { nonceHash: sha(b.nonce) } });
    if (!row || row.targetRef !== b.targetRef) return { ok: false, code: 'INVALID' };
    if (row.sub !== who.sub || row.sessionId !== who.sessionId) return { ok: false, code: 'FOREIGN' };
    if (row.usedAt) return { ok: false, code: 'USED', kind: row.kind as ConfirmKind, resultRef: row.resultRef, outcome: row.outcome };
    if (row.expiresAt <= now) return { ok: false, code: 'EXPIRED', kind: row.kind as ConfirmKind };
    const claimed = await this.prisma.assistantConfirmation.updateMany({ where: { id: row.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now, outcome: b.decision === 'CONFIRM' ? 'CONFIRMED' : 'DECLINED' } });
    if (claimed.count !== 1) return { ok: false, code: 'USED', kind: row.kind as ConfirmKind, resultRef: row.resultRef };
    return { ok: true, id: row.id, kind: row.kind as ConfirmKind, targetRef: row.targetRef, payload: (row.payload ?? {}) as Record<string, any> };
  }
  async setResult(id: string, resultRef: string) { await this.prisma.assistantConfirmation.update({ where: { id }, data: { resultRef: resultRef.slice(0, 80) } }).catch(() => undefined); }
  /** A pending nonce is revoked when its hold is released or replaced, so a stale button can never act. */
  async revokeFor(sessionId: string, targetRef: string) { await this.prisma.assistantConfirmation.updateMany({ where: { sessionId, targetRef, usedAt: null }, data: { usedAt: new Date(), outcome: 'DECLINED' } }); }
  async revokeAllPending(sessionId: string) { await this.prisma.assistantConfirmation.updateMany({ where: { sessionId, usedAt: null }, data: { usedAt: new Date(), outcome: 'DECLINED' } }); }
}
