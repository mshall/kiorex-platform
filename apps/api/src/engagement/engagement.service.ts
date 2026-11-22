import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { cfg } from '../common/config';
import { notFound } from '../common/errors';
import { MessagingAdapter, MessagingHub, MsgChannel } from '../messaging/messaging-public';
import { PatientService } from '../patient/patient-public';
import { PrismaService } from '../prisma/prisma.service';
import { newId } from '../common/ids';
import { NotifyKind, render, TEMPLATES } from './templates';
import { createPlatformNotifier, outcomeOf, PlatformPreferenceStore } from './notification.layer';

export const DEVICE_PLATFORMS = ['IOS', 'ANDROID', 'WEB'] as const;

export const CHANNELS = ['WHATSAPP', 'PUSH', 'SMS', 'EMAIL'] as const;

@Injectable()
export class EngagementService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  /** Every channel send goes through the shared notification layer (@kiorex/contracts/notify); the hub stays the transport + MessageLog. */
  private readonly notifier: ReturnType<typeof createPlatformNotifier>;
  constructor(private readonly prisma: PrismaService, private readonly patients: PatientService, private readonly hub: MessagingHub) {
    this.notifier = createPlatformNotifier(hub, new PlatformPreferenceStore({
      hasConsent: (sub, purpose) => this.patients.hasConsent(sub, purpose),
      preference: (sub, channel) => this.prisma.notificationPreference.findUnique({ where: { sub_channel: { sub, channel } } }),
    }));
  }

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
        const finish = (status: string, reason?: string) => this.prisma.message.update({ where: { id }, data: { status, reason, ...(status === 'SENT' ? { sentAt: new Date() } : {}) } }).then(() => status);
    const purpose = t.reminder ? 'REMINDER' as const : 'TRANSACTIONAL' as const; // consent (KXM-NT-02): reminders need REMINDERS; transactional need MARKETPLACE_PROCESSING
    const channel = m.channel as 'INAPP' | MsgChannel;
    const profile = channel === 'INAPP' ? null : await this.patients.profileBySub(m.sub);
    // PUSH goes to every active registered device (token registry); in MOCK mode an account without a device still gets the dev-inbox push so flows stay testable
    const devices = channel === 'PUSH' ? await this.activeDevices(m.sub) : [];
    const deviceIds = channel === 'PUSH' ? (devices.length ? devices.map((d) => d.token) : this.hub.channelMode('PUSH') === 'mock' ? [`device:${m.sub}`] : []) : undefined;
    const allowed = this.notifier.registry.get(params.kind as string)?.allowedParams ?? [];
    const intentParams = Object.fromEntries(Object.entries(params).filter(([k, v]) => allowed.includes(k) && (typeof v === 'string' || typeof v === 'number'))) as Record<string, string | number>; // PHI-free guard: only declared params reach a template
    try {
      const state = await this.notifier.service.dispatch({
        type: params.kind as string, severity: t.reminder ? 'ROUTINE' : 'IMPORTANT',
        recipient: { id: m.sub, phone: profile?.phone ?? undefined, email: profile?.email ?? undefined, deviceIds, locale: m.locale === 'en' ? 'en' : 'ar' },
        params: intentParams, channels: [channel],
        idempotencyKey: `${m.id}:${m.scheduledFor.getTime()}`, // a quiet-hours deferral moves scheduledFor, so the retry is a new key
        metadata: { messageId: m.id, sub: m.sub, templateId: m.templateId },
      });
      const o = outcomeOf(state, channel, purpose);
      switch (o.kind) {
        case 'SENT': return finish('SENT');
        case 'DEFERRED':
          await this.prisma.message.update({ where: { id }, data: { scheduledFor: o.until, reason: 'QUIET_HOURS_DEFERRED' } });
          return 'DEFERRED';
        case 'SKIPPED_CONSENT': return finish('SKIPPED_CONSENT', o.purpose);
        case 'SKIPPED_OPTOUT': return finish('SKIPPED_OPTOUT', m.channel);
        case 'FAILED': return finish('FAILED', o.reason);
      }
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
        const item = this.notifier.registry.render(p.kind as string, 'INAPP', m.locale === 'en' ? 'en' : 'ar', Object.fromEntries(Object.entries(p).filter(([k, v]) => (this.notifier.registry.get(p.kind as string)?.allowedParams ?? []).includes(k) && (typeof v === 'string' || typeof v === 'number'))) as Record<string, string | number>);
        // first-class in-app item from the notify registry; falls back to the legacy copy if a template ever fails to render
        return { id: m.id, kind: p.kind, bookingId: m.bookingId, body: item.ok ? item.body.body : render(m.locale === 'en' ? t.en : t.ar, p), readAt: m.readAt, createdAt: m.createdAt };
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
