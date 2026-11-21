import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { cfg } from '../common/config';
import { ApiError, notFound } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { channelMode, createMessagingAdapter } from './adapters';
import { providerEnv } from '../common/providers/env';
import { messagingKindOf, MESSAGING_MAPPINGS } from '../common/providers/real-adapters';
import { InboundHandler, InboundMessage, maskRecipient, MessagingAdapter, MSG_CHANNELS, MsgChannel, MsgStatus, OutboundMessage, SIMULATABLE_STATES } from './messaging.types';

const ORDER: MsgStatus[] = ['QUEUED', 'SENT', 'DELIVERED', 'READ'];

/**
 * One hub for EMAIL / WHATSAPP / SMS / PUSH. Every send and every inbound is a MessageLog row (the "dev inbox" in mock mode).
 * Logs never carry bodies in real mode; console logs never carry recipients or bodies in any mode (PHI).
 */
@Injectable()
export class MessagingHub implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('messaging');
  private adapters = new Map<MsgChannel, MessagingAdapter>();
  private inbound = new Map<MsgChannel, InboundHandler>();
  private timer?: NodeJS.Timeout;
  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (!cfg().jobsEnabled) return;
    this.timer = setInterval(() => void this.simulateDeliveries().catch(() => undefined), 5_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  mode() { return cfg().messagingMode; }
  channelMode(channel: MsgChannel) { return this.adapters.get(channel)?.mode ?? channelMode(channel); }
  adapter(channel: MsgChannel): MessagingAdapter {
    return this.adapters.get(channel) ?? createMessagingAdapter(channel);
  }
  /** Tests / go-live wiring can replace an adapter. */
  setAdapter(a: MessagingAdapter) { this.adapters.set(a.channel, a); }
  onInbound(channel: MsgChannel, h: InboundHandler) { this.inbound.set(channel, h); }

  async send(m: OutboundMessage) {
    const adapter = this.adapter(m.channel);
    const mock = adapter.mode === 'mock';
    const row = await this.prisma.messageLog.create({
      data: { messageId: m.messageId, channel: m.channel, direction: 'OUT', mode: adapter.mode, sub: m.sub, recipient: mock ? m.to : null, recipientMasked: maskRecipient(m.channel, m.to), templateId: m.templateId, locale: m.locale, body: mock ? m.body : null, status: 'QUEUED' },
    });
    try {
      const r = await adapter.send(m);
      if (!r.ok) {
        const failed = await this.prisma.messageLog.update({ where: { id: row.id }, data: { status: 'FAILED', error: r.error ?? 'SEND_FAILED', failedAt: new Date() } });
        this.log.warn(`[${m.channel}] ${m.templateId} log=${row.id} FAILED ${r.error ?? ''}`);
        return { ...failed, ok: false };
      }
      const sent = await this.prisma.messageLog.update({ where: { id: row.id }, data: { status: 'SENT', providerRef: r.providerRef, sentAt: new Date() } });
      this.log.log(`[${m.channel}] ${m.templateId} log=${row.id} SENT`);
      return { ...sent, ok: true };
    } catch (e) {
      const failed = await this.prisma.messageLog.update({ where: { id: row.id }, data: { status: 'FAILED', error: String(e instanceof Error ? e.message : e).slice(0, 200), failedAt: new Date() } });
      this.log.warn(`[${m.channel}] ${m.templateId} log=${row.id} FAILED (adapter error)`);
      return { ...failed, ok: false };
    }
  }

  /** Simulated patient message (dev inbox) or, in real mode, the verified provider webhook payload. */
  async receive(m: InboundMessage) {
    const row = await this.prisma.messageLog.create({
      data: { channel: m.channel, direction: 'IN', mode: this.channelMode(m.channel), recipient: m.from, recipientMasked: maskRecipient(m.channel, m.from), body: this.channelMode(m.channel) === 'mock' ? (m.text ?? m.buttonPayload ?? '') : null, status: 'RECEIVED', providerRef: m.providerRef, sentAt: new Date() },
    });
    const h = this.inbound.get(m.channel);
    if (h) await h({ ...m, logId: row.id });
    return row;
  }

  /** Delivery-state simulation: SENT -> DELIVERED (tick); READ / FAILED on demand. Never touches real-mode rows. */
  async simulateDeliveries() {
    const r = await this.prisma.messageLog.updateMany({ where: { mode: 'mock', direction: 'OUT', status: 'SENT' }, data: { status: 'DELIVERED', deliveredAt: new Date() } });
    return { delivered: r.count };
  }

  async simulate(id: string, state: MsgStatus) {
    if (!SIMULATABLE_STATES.includes(state)) throw notFound('UNSUPPORTED_STATE', `state must be one of ${SIMULATABLE_STATES.join('|')}`);
    const row = await this.prisma.messageLog.findUnique({ where: { id } });
    if (!row || row.mode !== 'mock' || row.direction !== 'OUT') throw notFound('MESSAGE_NOT_SIMULATABLE', 'Only mock outbound messages can be simulated');
    const now = new Date();
    if (state !== 'FAILED' && ORDER.indexOf(row.status as MsgStatus) >= ORDER.indexOf(state)) return row; // states only move forward
    const data = state === 'FAILED' ? { status: 'FAILED', failedAt: now, error: 'SIMULATED_FAILURE' } : state === 'DELIVERED' ? { status: 'DELIVERED', deliveredAt: now } : { status: 'READ', readAt: now, deliveredAt: row.deliveredAt ?? now };
    return this.prisma.messageLog.update({ where: { id }, data });
  }

  /**
   * Provider delivery-status webhook (SMS / EMAIL / WHATSAPP). Signature is verified with <KIND>_WEBHOOK_SECRET through the vendor
   * mapping; statuses are persisted on the MessageLog row found by providerRef, move forward only (so retries / out-of-order
   * deliveries are idempotent), and a FAILED delivery also fails the linked notification so the failure is visible to ops.
   */
  async handleStatusWebhook(channel: string, rawBody: string, headers: Record<string, unknown>) {
    const ch = channel.toUpperCase();
    const kind = messagingKindOf(ch);
    if (!kind || (providerEnv(kind).mode === 'mock' && cfg().isProd)) throw notFound('NOT_FOUND', 'Not found');
    const env = providerEnv(kind);
    const mapping = MESSAGING_MAPPINGS[kind];
    if (!mapping.verifyWebhook({ secret: env.webhookSecret, rawBody, headers })) throw new ApiError(401, 'INVALID_SIGNATURE', 'Signature rejected');
    let applied = 0; let ignored = 0;
    for (const ev of mapping.parseStatusWebhook(rawBody)) {
      const row = await this.prisma.messageLog.findFirst({ where: { channel: ch, direction: 'OUT', providerRef: ev.providerRef } });
      if (!row) { ignored++; continue; }
      const at = ev.occurredAt && !Number.isNaN(Date.parse(ev.occurredAt)) ? new Date(ev.occurredAt) : new Date();
      if (ev.status === 'FAILED') {
        if (row.status === 'FAILED' || row.status === 'READ') { ignored++; continue; }
        await this.prisma.messageLog.update({ where: { id: row.id }, data: { status: 'FAILED', failedAt: at, error: ev.error ?? 'DELIVERY_FAILED' } });
        if (row.messageId) await this.prisma.message.updateMany({ where: { id: row.messageId }, data: { status: 'FAILED', reason: (ev.error ?? 'DELIVERY_FAILED').slice(0, 200) } });
        applied++; continue;
      }
      if (row.status === 'FAILED' || ORDER.indexOf(row.status as MsgStatus) >= ORDER.indexOf(ev.status)) { ignored++; continue; }
      const data = ev.status === 'READ' ? { status: 'READ', readAt: at, deliveredAt: row.deliveredAt ?? at } : ev.status === 'DELIVERED' ? { status: 'DELIVERED', deliveredAt: at } : { status: ev.status, sentAt: row.sentAt ?? at };
      await this.prisma.messageLog.update({ where: { id: row.id }, data });
      applied++;
    }
    return { applied, ignored };
  }

  // ── views ──
  async list(q: { channel?: string; status?: string; direction?: string; to?: string; since?: Date; limit?: number }) {
    return this.prisma.messageLog.findMany({
      where: { ...(q.channel ? { channel: q.channel.toUpperCase() } : {}), ...(q.status ? { status: q.status.toUpperCase() } : {}), ...(q.direction ? { direction: q.direction.toUpperCase() } : {}), ...(q.to ? { recipient: q.to } : {}), ...(q.since ? { createdAt: { gte: q.since } } : {}) },
      orderBy: { createdAt: 'desc' }, take: Math.min(q.limit ?? 100, 500),
    });
  }
  async stats() {
    const rows = await this.prisma.messageLog.groupBy({ by: ['channel', 'direction', 'status'], _count: true });
    return { mode: cfg().messagingMode, channels: MSG_CHANNELS, counts: rows.map((r) => ({ channel: r.channel, direction: r.direction, status: r.status, count: r._count })) };
  }
  async clear(channel?: string) {
    if (cfg().messagingMode !== 'mock') throw notFound('NOT_FOUND', 'Not found');
    return this.prisma.messageLog.deleteMany({ where: channel ? { channel: channel.toUpperCase() } : {} });
  }
}
