import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { cfg } from '../common/config';
import { notFound } from '../common/errors';
import { MessagingAdapter, MessagingHub, MsgChannel } from '../messaging/messaging-public';
import { PatientService } from '../patient/patient-public';
import { PrismaService } from '../prisma/prisma.service';
import { newId } from '../common/ids';
import { NotifyKind, render, TEMPLATES } from './templates';

export const DEVICE_PLATFORMS = ['IOS', 'ANDROID', 'WEB'] as const;

export const CHANNELS = ['WHATSAPP', 'PUSH', 'SMS', 'EMAIL'] as const;

@Injectable()
export class EngagementService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  constructor(private readonly prisma: PrismaService, private readonly patients: PatientService, private readonly hub: MessagingHub) {}

  onModuleInit() {
    if (!cfg().jobsEnabled) return;
    this.timer = setInterval(() => void this.processDue().catch(() => undefined), 60_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  setAdapter(a: MessagingAdapter) { this.hub.setAdapter(a); }

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
    const profile = await this.patients.profileBySub(m.sub);
    // PUSH goes to every active registered device (token registry); in MOCK mode an account without a device still gets the dev-inbox push so flows stay testable
    const devices = m.channel === 'PUSH' ? await this.activeDevices(m.sub) : [];
    const targets: string[] = m.channel === 'PUSH'
      ? (devices.length ? devices.map((d) => d.token) : this.hub.mode() === 'mock' ? [`device:${m.sub}`] : [])
      : [(m.channel === 'EMAIL' ? profile?.email : profile?.phone) ?? ''].filter((x): x is string => !!x);
    if (!targets.length) return finish('FAILED', m.channel === 'PUSH' ? 'NO_DEVICE' : 'NO_RECIPIENT');
    try {
      let okCount = 0; let lastError: string | undefined;
      for (const to of targets) {
        const r = await this.hub.send({ messageId: m.id, channel: m.channel as MsgChannel, sub: m.sub, to, templateId: m.templateId, locale: m.locale, body });
        if (r.ok) okCount++; else lastError = r.error ?? undefined;
      }
      return okCount ? finish('SENT') : finish('FAILED', (lastError ?? 'SEND_FAILED').slice(0, 200));
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

  // ── push device registry ──
  activeDevices(sub: string) { return this.prisma.deviceToken.findMany({ where: { sub, revokedAt: null }, orderBy: { lastSeenAt: 'desc' }, take: 10 }); }
  private presentDevice(d: { id: string; platform: string; appVersion: string | null; locale: string | null; createdAt: Date; lastSeenAt: Date }) {
    return { id: d.id, platform: d.platform, appVersion: d.appVersion, locale: d.locale, createdAt: d.createdAt.toISOString(), lastSeenAt: d.lastSeenAt.toISOString() }; // the token itself is never echoed
  }
  /** Idempotent on the token: a token that moves to another account (re-login on the same phone) is re-owned, never duplicated. */
  async registerDevice(sub: string, i: { platform: string; token: string; appVersion?: string; locale?: string }) {
    const row = await this.prisma.deviceToken.upsert({
      where: { token: i.token },
      create: { id: newId('kx_dev'), sub, platform: i.platform, token: i.token, appVersion: i.appVersion, locale: i.locale },
      update: { sub, platform: i.platform, appVersion: i.appVersion, locale: i.locale, revokedAt: null, lastSeenAt: new Date() },
    });
    // keep the registry small: at most 10 active devices per account, oldest revoked
    const active = await this.prisma.deviceToken.findMany({ where: { sub, revokedAt: null }, orderBy: { lastSeenAt: 'desc' } });
    if (active.length > 10) await this.prisma.deviceToken.updateMany({ where: { id: { in: active.slice(10).map((d) => d.id) } }, data: { revokedAt: new Date() } });
    return this.presentDevice(row);
  }
  async listDevices(sub: string) { return (await this.activeDevices(sub)).map((d) => this.presentDevice(d)); }
  async removeDevice(sub: string, id: string) {
    const r = await this.prisma.deviceToken.updateMany({ where: { id, sub, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!r.count) throw notFound('DEVICE_NOT_FOUND', 'Device not found');
    return { ok: true };
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
