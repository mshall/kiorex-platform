import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

/** Audit rows of the assistant carry ids, counters, tool names, modes and hashes only: never message text, names, phone numbers or specialties. */
const SAFE_KEYS = new Set(['tool', 'outcome', 'mode', 'model', 'tokensIn', 'tokensOut', 'costMinor', 'kind', 'reason', 'nonceHash', 'code', 'actor', 'market', 'count', 'state', 'step', 'signals', 'targetHash', 'status', 'escalationId', 'breaker', 'turn', 'latencyMs']);
export const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

export function safeMeta(m: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(m)) {
    if (!SAFE_KEYS.has(k)) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 80);
    else if (typeof v === 'number' || typeof v === 'boolean' || v === null) out[k] = v;
    else if (Array.isArray(v)) out[k] = v.filter((x) => typeof x === 'string' || typeof x === 'number').slice(0, 20).map((x) => (typeof x === 'string' ? x.slice(0, 40) : x));
  }
  return out;
}

/** Tool arguments as stored in AssistantToolCall.argsRedacted: opaque ids are kept (provider, hold, booking), the specialty and every free value is replaced by a marker. */
export function redactToolArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (['providerId', 'holdId', 'bookingId'].includes(k) && typeof v === 'string') out[k] = v.slice(0, 40);
    else if (k === 'startsAt' && typeof v === 'string') out[k] = v.slice(0, 16);
    else if (typeof v === 'boolean' || typeof v === 'number') out[k] = typeof v === 'number' ? '[number]' : v;
    else out[k] = '[set]';
  }
  return out;
}

@Injectable()
export class AssistantAudit {
  constructor(private readonly prisma: PrismaService) {}
  async record(action: string, sessionId: string | null, meta: Record<string, unknown>, actor = 'system:assistant') {
    await this.prisma.auditLog.create({ data: { actor, action: `assistant.${action}`, resource: 'AssistantSession', resourceId: sessionId, metadata: safeMeta(meta) as object } }).catch(() => undefined);
  }
}
