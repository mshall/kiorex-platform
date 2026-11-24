import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { marketOffsetMinutes } from '../common/market-time';
import type { ChannelPreference, Purpose } from '@kiorex/contracts/notify';
import type { Channel } from '@kiorex/contracts/notify';
import { OPS_ROLES, type AuthUser } from '../common/auth';
import { cfg } from '../common/config';
import { badRequest, notFound } from '../common/errors';
import { newId } from '../common/ids';
import { createPlatformNotifier, outcomeOf } from '../engagement/engagement-public';
import { MessagingHub } from '../messaging/messaging-public';
import { PrismaService } from '../prisma/prisma.service';

export const ALERT_CHANNELS = ['EMAIL', 'WHATSAPP', 'PUSH'] as const;
type AlertChannel = (typeof ALERT_CHANNELS)[number];
const ACTIVE_DAYS = 90;
const KIND_LABEL: Record<string, { en: string; ar: string }> = {
  CLINIC: { en: 'Clinic', ar: 'عيادة' }, NURSE: { en: 'Nurse', ar: 'تمريض' }, PHARMACY: { en: 'Pharmacy', ar: 'صيدلية' }, LAB: { en: 'Lab', ar: 'معمل' },
};
const only = (xs: string[] | undefined, fallback: readonly string[] = ALERT_CHANNELS) => [...new Set((xs ?? [...fallback]).filter((c): c is AlertChannel => (ALERT_CHANNELS as readonly string[]).includes(c)))];

export interface AlertLead { id: string; kind: string; orgName: string }

/**
 * "A partner lead arrived" alerts for the Kiorex team. Recipients are the active ops people (super admin / admin) the ops console has seen;
 * delivery goes through the shared notification layer (templates AR/EN, consent = the person's own opt-in, quiet hours, per-channel opt-out)
 * over the mock/real messaging adapters. One ledger row per lead event x person x channel makes repeats and retries no-ops.
 */
@Injectable()
export class LeadAlertsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('lead-alerts');
  private timer?: NodeJS.Timeout;
  private readonly touched = new Map<string, number>();
  private readonly notifier: ReturnType<typeof createPlatformNotifier>;
  constructor(private readonly prisma: PrismaService, private readonly hub: MessagingHub) {
    this.notifier = createPlatformNotifier(hub, {
      get: async (sub: string, ctx: { channel: Channel; purpose: Purpose }): Promise<ChannelPreference> => {
        const c = await this.prisma.opsStaffContact.findUnique({ where: { sub } });
        const q = cfg();
        return { consent: !!c?.leadAlerts, optedOut: !c || !c.channels.includes(ctx.channel), quiet: { startHour: q.quietStart, endHour: q.quietEnd, tzOffsetMinutes: marketOffsetMinutes() } };
      },
    });
  }
  onModuleInit() {
    if (!cfg().jobsEnabled) return;
    this.timer = setInterval(() => void this.processDue().catch(() => undefined), 60_000); this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  // ── who is on the Kiorex team ──
  /** Record/refresh an ops person from their verified token (throttled per process; `force` for tests and settings reads). */
  async touch(u: AuthUser, force = false) {
    if (!u.roles?.some((r) => OPS_ROLES.includes(r))) return;
    const last = this.touched.get(u.sub) ?? 0;
    if (!force && Date.now() - last < 5 * 60_000) return;
    this.touched.set(u.sub, Date.now());
    const locale = u.locale === 'ar' ? 'ar' : 'en';
    const roles = u.roles.filter((r) => OPS_ROLES.includes(r));
    await this.prisma.opsStaffContact.upsert({
      where: { sub: u.sub },
      create: { sub: u.sub, name: u.name ?? null, phone: u.phone ?? null, email: u.email ?? null, roles, locale },
      update: { name: u.name ?? undefined, phone: u.phone ?? undefined, email: u.email ?? undefined, roles, locale, lastSeenAt: new Date() },
    });
  }

  async config() {
    const c = await this.prisma.leadAlertConfig.findUnique({ where: { id: 'global' } });
    return { enabled: c?.enabled ?? true, channels: only(c?.channels), updatedBy: c?.updatedBy ?? null, updatedAt: c?.updatedAt ?? null };
  }
  async setConfig(actor: string, b: { enabled?: boolean; channels?: string[] }) {
    if (b.channels && b.channels.some((c) => !(ALERT_CHANNELS as readonly string[]).includes(c))) throw badRequest('INVALID_CHANNEL', 'Unknown channel');
    const cur = await this.config();
    const data = { enabled: b.enabled ?? cur.enabled, channels: b.channels ? only(b.channels) : cur.channels, updatedBy: actor };
    await this.prisma.leadAlertConfig.upsert({ where: { id: 'global' }, create: { id: 'global', ...data }, update: data });
    await this.prisma.auditLog.create({ data: { actor, action: 'partner_lead.alert_config_changed', resource: 'LeadAlertConfig', resourceId: 'global', metadata: { enabled: data.enabled, channels: data.channels } as never } });
    return this.config();
  }

  private activeSince() { return new Date(Date.now() - ACTIVE_DAYS * 86_400_000); }
  async recipients() {
    const rows = await this.prisma.opsStaffContact.findMany({ where: { lastSeenAt: { gte: this.activeSince() } }, orderBy: [{ name: 'asc' }, { sub: 'asc' }] });
    return rows.map((r) => ({ sub: r.sub, name: r.name, roles: r.roles, leadAlerts: r.leadAlerts, channels: only(r.channels), hasPhone: !!r.phone, hasEmail: !!r.email, lastSeenAt: r.lastSeenAt }));
  }
  async setRecipient(actor: string, sub: string, b: { leadAlerts?: boolean; channels?: string[] }) {
    if (b.channels && b.channels.some((c) => !(ALERT_CHANNELS as readonly string[]).includes(c))) throw badRequest('INVALID_CHANNEL', 'Unknown channel');
    if (!(await this.prisma.opsStaffContact.findUnique({ where: { sub } }))) throw notFound('OPS_STAFF_NOT_FOUND', 'Team member not found');
    await this.prisma.opsStaffContact.update({ where: { sub }, data: { ...(b.leadAlerts !== undefined ? { leadAlerts: b.leadAlerts } : {}), ...(b.channels ? { channels: only(b.channels) } : {}) } });
    await this.prisma.auditLog.create({ data: { actor, action: 'partner_lead.alert_recipient_changed', resource: 'OpsStaffContact', resourceId: sub, metadata: { leadAlerts: b.leadAlerts, channels: b.channels } as never } });
    return (await this.recipients()).find((r) => r.sub === sub);
  }
  async settings() { return { ...(await this.config()), availableChannels: ALERT_CHANNELS, recipients: await this.recipients() }; }

  // ── unread badge ──
  async unread(sub: string) {
    const c = await this.prisma.opsStaffContact.findUnique({ where: { sub }, select: { leadsSeenAt: true } });
    const count = await this.prisma.partnerLead.count({ where: { status: 'NEW', ...(c?.leadsSeenAt ? { OR: [{ createdAt: { gt: c.leadsSeenAt } }, { updatedAt: { gt: c.leadsSeenAt } }] } : {}) } });
    return { count };
  }
  async markSeen(u: AuthUser) {
    await this.touch(u, true);
    await this.prisma.opsStaffContact.update({ where: { sub: u.sub }, data: { leadsSeenAt: new Date() } }).catch(() => undefined);
    return { count: 0 };
  }

  // ── alerting ──
  /** Called when a lead is created or re-opened. Never throws: a failed alert must not fail the partner's request. */
  async onLead(lead: AlertLead, eventAt: Date) {
    try {
      const conf = await this.config();
      if (!conf.enabled) return { created: 0 };
      const staff = await this.prisma.opsStaffContact.findMany({ where: { leadAlerts: true, lastSeenAt: { gte: this.activeSince() } } });
      let created = 0;
      for (const s of staff) {
        if (!s.roles.some((r) => OPS_ROLES.includes(r))) continue;
        for (const ch of only(s.channels).filter((c) => (conf.channels as string[]).includes(c))) {
          const dedupeKey = `lead:${lead.id}:${eventAt.getTime()}:${s.sub}:${ch}`;
          try { await this.prisma.leadAlertDelivery.create({ data: { id: newId('la'), dedupeKey, leadId: lead.id, staffSub: s.sub, channel: ch, status: 'SCHEDULED', scheduledFor: new Date() } }); created++; } catch { /* duplicate event: already alerted */ }
        }
      }
      await this.processDue(lead);
      return { created };
    } catch (e) { this.log.warn(`lead alert failed lead=${lead.id}: ${(e as Error).message}`); return { created: 0 }; }
  }

  async processDue(known?: AlertLead) {
    const due = await this.prisma.leadAlertDelivery.findMany({ where: { status: 'SCHEDULED', scheduledFor: { lte: new Date() } }, orderBy: { scheduledFor: 'asc' }, take: 200 });
    for (const d of due) await this.deliver(d.id, known?.id === d.leadId ? known : undefined);
    return { processed: due.length };
  }

  private async deliver(id: string, known?: AlertLead) {
    const d = await this.prisma.leadAlertDelivery.findUnique({ where: { id } });
    if (!d || d.status !== 'SCHEDULED') return;
    const finish = (status: string, reason?: string) => this.prisma.leadAlertDelivery.update({ where: { id }, data: { status, reason, ...(status === 'SENT' ? { sentAt: new Date() } : {}) } });
    const s = await this.prisma.opsStaffContact.findUnique({ where: { sub: d.staffSub } });
    const lead = known ?? (await this.prisma.partnerLead.findUnique({ where: { id: d.leadId }, select: { id: true, kind: true, orgName: true } }));
    if (!s || !lead) { await finish('SKIPPED', 'GONE'); return; }
    const conf = await this.config();
    if (!conf.enabled || !(conf.channels as string[]).includes(d.channel)) { await finish('SKIPPED', 'DISABLED'); return; }
    const locale = s.locale === 'ar' ? 'ar' : 'en';
    const channel = d.channel as AlertChannel;
    const deviceIds = channel === 'PUSH' ? await this.devices(s.sub) : undefined;
    try {
      const state = await this.notifier.service.dispatch({
        type: 'OPS_LEAD_ALERT', severity: 'IMPORTANT',
        recipient: { id: s.sub, phone: s.phone ?? undefined, email: s.email ?? undefined, deviceIds, locale },
        params: { org: lead.orgName, kindLabel: (KIND_LABEL[lead.kind] ?? { en: lead.kind, ar: lead.kind })[locale] }, channels: [channel],
        idempotencyKey: `${d.id}:${d.scheduledFor.getTime()}`,
        metadata: { sub: s.sub, templateId: 'ops.lead_alert' },
      });
      const o = outcomeOf(state, channel, 'TRANSACTIONAL');
      switch (o.kind) {
        case 'SENT': await finish('SENT'); break;
        case 'DEFERRED': await this.prisma.leadAlertDelivery.update({ where: { id }, data: { scheduledFor: o.until, reason: 'QUIET_HOURS_DEFERRED' } }); break;
        case 'SKIPPED_CONSENT': await finish('SKIPPED', 'CONSENT'); break;
        case 'SKIPPED_OPTOUT': await finish('SKIPPED', 'OPT_OUT'); break;
        case 'FAILED': await finish(o.reason.startsWith('NO_') ? 'SKIPPED' : 'FAILED', o.reason); break;
      }
    } catch (e) { await finish('FAILED', String(e).slice(0, 200)); }
  }
  private async devices(sub: string) {
    const rows = await this.prisma.deviceToken.findMany({ where: { sub, revokedAt: null }, take: 10 });
    return rows.length ? rows.map((r) => r.token) : this.hub.channelMode('PUSH') === 'mock' ? [`device:${sub}`] : [];
  }
}
