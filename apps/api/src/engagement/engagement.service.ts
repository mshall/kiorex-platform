import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { cfg } from '../common/config';
import { PatientService } from '../patient/patient-public';
import { PrismaService } from '../prisma/prisma.service';
import { NotifyKind, render, TEMPLATES } from './templates';

export const CHANNELS = ['WHATSAPP', 'PUSH', 'SMS', 'EMAIL'] as const;

export interface ChannelAdapter { channel: string; send(m: { id: string; templateId: string; locale: string; body: string; sub: string }): Promise<void> }

/** MESSAGING_MODE=log: adapters write to console (no PHI: template id + message id only). Real senders: NEEDS_HUMAN (Meta, SMS, FCM). */
class LogAdapter implements ChannelAdapter {
  private readonly log = new Logger('messaging');
  constructor(public channel: string) {}
  async send(m: { id: string; templateId: string }) {
    this.log.log(`[${this.channel}] ${m.templateId} msg=${m.id}`);
  }
}

@Injectable()
export class EngagementService implements OnModuleInit, OnModuleDestroy {
  private adapters = new Map<string, ChannelAdapter>(CHANNELS.map((c) => [c, new LogAdapter(c)]));
  private timer?: NodeJS.Timeout;
  constructor(private readonly prisma: PrismaService, private readonly patients: PatientService) {}

  onModuleInit() {
    if (!cfg().jobsEnabled) return;
    this.timer = setInterval(() => void this.processDue().catch(() => undefined), 60_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  setAdapter(a: ChannelAdapter) { this.adapters.set(a.channel, a); }

  /** Local-hour quiet window check (KXM-NT-02). Returns the end of the window as a Date if inside it. */
  quietUntil(at: Date, startH: number, endH: number): Date | null {
    const off = cfg().tzOffsetHours;
    const local = new Date(at.getTime() + off * 3600_000);
    const h = local.getUTCHours();
    const inside = startH > endH ? h >= startH || h < endH : h >= startH && h < endH;
    if (!inside) return null;
    const end = new Date(local);
    end.setUTCHours(endH, 0, 0, 0);
    if (end <= local) end.setUTCDate(end.getUTCDate() + 1);
    return new Date(end.getTime() - off * 3600_000);
  }

  async notify(sub: string, o: { kind: NotifyKind; bookingId?: string; params?: Record<string, unknown>; scheduledFor?: Date; dedupeKey: string; channels?: string[] }) {
    const channels = ['INAPP', ...(o.channels ?? ['WHATSAPP', 'PUSH'])];
    const profile = await this.patients.profileBySub(sub);
    const locale = profile?.preferredLocale ?? 'ar';
    const t = TEMPLATES[o.kind];
    const created: string[] = [];
    for (const channel of channels) {
      const dedupeKey = `${o.dedupeKey}:${channel}`;
      const exists = await this.prisma.message.findUnique({ where: { dedupeKey } });
      if (exists) continue;
      const m = await this.prisma.message.create({ data: { sub, bookingId: o.bookingId, channel, templateId: t.templateId, locale, params: { kind: o.kind, ...(o.params ?? {}) } as any, scheduledFor: o.scheduledFor ?? new Date(), dedupeKey } });
      created.push(m.id);
      if (m.scheduledFor <= new Date()) await this.deliver(m.id);
    }
    return created;
  }

  async deliver(id: string): Promise<string> {
    const m = await this.prisma.message.findUnique({ where: { id } });
    if (!m || m.status !== 'SCHEDULED') return m?.status ?? 'MISSING';
    const params = (m.params ?? {}) as Record<string, unknown>;
    const t = TEMPLATES[params.kind as NotifyKind];
    const body = render(m.locale === 'en' ? t.en : t.ar, params);
    const finish = (status: string, reason?: string) => this.prisma.message.update({ where: { id }, data: { status, reason, ...(status === 'SENT' ? { sentAt: new Date() } : {}) } }).then(() => status);
    if (m.channel === 'INAPP') return finish('SENT'); // in-app inbox is always available
    // consent (KXM-NT-02): reminders need REMINDERS; transactional need MARKETPLACE_PROCESSING
    const purpose = t.reminder ? 'REMINDERS' : 'MARKETPLACE_PROCESSING';
    if (!(await this.patients.hasConsent(m.sub, purpose))) return finish('SKIPPED_CONSENT', purpose);
    const pref = await this.prisma.notificationPreference.findUnique({ where: { sub_channel: { sub: m.sub, channel: m.channel } } });
    if (pref && !pref.enabled) return finish('SKIPPED_OPTOUT', m.channel);
    if (!t.bypassQuiet) {
      const until = this.quietUntil(new Date(), pref?.quietStart ?? cfg().quietStart, pref?.quietEnd ?? cfg().quietEnd);
      if (until) {
        await this.prisma.message.update({ where: { id }, data: { scheduledFor: until, reason: 'QUIET_HOURS_DEFERRED' } });
        return 'DEFERRED';
      }
    }
    try {
      await this.adapters.get(m.channel)!.send({ id: m.id, templateId: m.templateId, locale: m.locale, body, sub: m.sub });
      return finish('SENT');
    } catch (e) {
      return finish('FAILED', String(e).slice(0, 200));
    }
  }

  async processDue(limit = 100) {
    const due = await this.prisma.message.findMany({ where: { status: 'SCHEDULED', scheduledFor: { lte: new Date() } }, orderBy: { scheduledFor: 'asc' }, take: limit });
    for (const m of due) await this.deliver(m.id);
    return { processed: due.length };
  }

  // ── booking-linked helpers ──
  async scheduleBookingReminders(b: { id: string; sub: string; startsAt: Date }, params: Record<string, unknown>) {
    const rem: [NotifyKind, number][] = [['REMINDER_24H', 24], ['REMINDER_2H', 2]];
    for (const [kind, h] of rem) {
      const at = new Date(b.startsAt.getTime() - h * 3600_000);
      if (at <= new Date()) continue;
      await this.notify(b.sub, { kind, bookingId: b.id, params, scheduledFor: at, dedupeKey: `${kind}:${b.id}:${b.startsAt.getTime()}` });
    }
  }
  async cancelBookingMessages(bookingId: string) {
    return this.prisma.message.updateMany({ where: { bookingId, status: 'SCHEDULED' }, data: { status: 'CANCELLED', reason: 'BOOKING_CHANGED' } });
  }
  /** KXM-NT-03: review invitation at T+2h after completion. */
  async scheduleReviewInvite(b: { id: string; sub: string }, params: Record<string, unknown>, completedAt = new Date()) {
    return this.notify(b.sub, { kind: 'REVIEW_INVITATION', bookingId: b.id, params, scheduledFor: new Date(completedAt.getTime() + 2 * 3600_000), dedupeKey: `REVIEW_INVITATION:${b.id}` });
  }

  // ── inbox & preferences ──
  inbox(sub: string) {
    return this.prisma.message.findMany({ where: { sub, channel: 'INAPP', status: 'SENT' }, orderBy: { createdAt: 'desc' }, take: 100 }).then((rows) =>
      rows.map((m) => {
        const p = (m.params ?? {}) as Record<string, unknown>;
        const t = TEMPLATES[p.kind as NotifyKind];
        return { id: m.id, kind: p.kind, bookingId: m.bookingId, body: render(m.locale === 'en' ? t.en : t.ar, p), readAt: m.readAt, createdAt: m.createdAt };
      }),
    );
  }
  async markRead(sub: string, id: string) {
    await this.prisma.message.updateMany({ where: { id, sub }, data: { readAt: new Date() } });
    return { ok: true };
  }
  async preferences(sub: string) {
    const rows = await this.prisma.notificationPreference.findMany({ where: { sub } });
    return CHANNELS.map((c) => rows.find((r) => r.channel === c) ?? { sub, channel: c, enabled: true, quietStart: null, quietEnd: null });
  }
  async setPreference(sub: string, channel: string, p: { enabled?: boolean; quietStart?: number | null; quietEnd?: number | null }) {
    return this.prisma.notificationPreference.upsert({ where: { sub_channel: { sub, channel } }, create: { sub, channel, ...p }, update: p });
  }
  /** Ops view */
  messageLog(limit = 100) {
    return this.prisma.message.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
  }
}
