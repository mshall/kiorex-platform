/**
 * Notification hook of a new join request, over the shared messaging hub (mock or real by MESSAGING_MODE; mock writes the dev inbox only).
 *  - applicant acknowledgement (EMAIL, only when an address was given and the notification switch is on);
 *  - team alert (EMAIL) to the Ops staff who opted in to lead alerts (their own consent and channel choice).
 * Draft wording: every template id is a TODO_NEEDS_HUMAN placeholder until copy and (for WhatsApp) Meta templates are approved. Never throws: a failed message must not fail the applicant's request.
 * The bodies carry the reference and the provider type only: no contact details.
 */
import { Injectable, Logger } from '@nestjs/common';
import { newId } from '../common/ids';
import { MessagingHub } from '../messaging/messaging-public';
import { PrismaService } from '../prisma/prisma.service';
import type { LeadConfig } from './lead-config';

export interface NewLeadNotice { id: string; ref: string; providerType: string; mode: string; locale: 'ar' | 'en'; email?: string }

export const ACK_TEMPLATE_ID = 'TODO_NEEDS_HUMAN_site_lead_ack';
export const ONBOARDING_ASSIGNED_TEMPLATE_ID = 'TODO_NEEDS_HUMAN_site_lead_onboarding_assigned';
export const TEAM_TEMPLATE_ID = 'TODO_NEEDS_HUMAN_site_lead_team_alert';
export const REMINDER_TEMPLATE_ID = 'TODO_NEEDS_HUMAN_site_lead_reminder';
export const ESCALATION_TEMPLATE_ID = 'TODO_NEEDS_HUMAN_site_lead_escalation';

export interface LeadReminderNotice { leadId: string; ref: string; providerType: string; mode: string; since: Date; level: 'REMIND' | 'ESCALATE'; target: 'owner' | 'super_admins' | 'super_admins_unassigned' }
export interface ReminderRecipient { sub: string; email: string | null; locale: string }

export const ackMessage = (n: NewLeadNotice) => n.locale === 'ar'
  ? { subject: `استلمنا طلب انضمامك إلى كيورلي (${n.ref})`, body: `شكرا لاهتمامك بكيورلي. رقم طلبك ${n.ref}. سيتواصل معك فريقنا قريبا عبر وسيلة التواصل التي اخترتها. هذه رسالة تلقائية: لا ترد عليها. (نص مبدئي قيد المراجعة)` }
  : { subject: `We received your Kiorly request (${n.ref})`, body: `Thank you for your interest in Kiorly. Your reference is ${n.ref}. Our team will contact you soon through the channel you chose. This is an automatic message, please do not reply. (Draft wording under review)` };

@Injectable()
export class LeadNotifier {
  private readonly log = new Logger('leads');
  constructor(private readonly hub: MessagingHub, private readonly prisma: PrismaService) {}

  async onNewLead(n: NewLeadNotice, cfg: LeadConfig): Promise<{ ack: boolean; team: number }> {
    let ack = false; let team = 0;
    try {
      if (cfg.notifications.applicantAck && n.email) {
        const m = ackMessage(n);
        const r = await this.hub.send({ channel: 'EMAIL', to: n.email, templateId: ACK_TEMPLATE_ID, locale: n.locale, subject: m.subject, body: m.body, messageClass: 'TRANSACTIONAL' });
        ack = r.ok;
        await this.event(n.id, 'NOTIFY', { to: 'applicant', channel: 'EMAIL', ok: r.ok });
      }
      if (cfg.notifications.teamAlert) {
        const staff = await this.prisma.opsStaffContact.findMany({ where: { leadAlerts: true, email: { not: null }, channels: { has: 'EMAIL' }, lastSeenAt: { gte: new Date(Date.now() - 90 * 86_400_000) } }, take: 20 });
        for (const s of staff) {
          const ar = s.locale === 'ar';
          const r = await this.hub.send({
            channel: 'EMAIL', to: s.email!, sub: s.sub, templateId: TEAM_TEMPLATE_ID, locale: ar ? 'ar' : 'en', messageClass: 'TRANSACTIONAL',
            subject: ar ? `طلب انضمام جديد ${n.ref}` : `New join request ${n.ref}`,
            body: ar ? `طلب انضمام جديد ${n.ref} (${n.providerType}، ${n.mode}). افتح لوحة الإدارة، طلبات الانضمام.` : `New join request ${n.ref} (${n.providerType}, ${n.mode}). Open the admin console, Join requests.`,
          });
          if (r.ok) team++;
        }
        await this.event(n.id, 'NOTIFY', { to: 'team', channel: 'EMAIL', sent: team });
      }
    } catch (e) { this.log.warn(`notification failed lead=${n.id}: ${(e as Error).message}`); }
    return { ack, team };
  }

  /**
   * The assignee of a new onboarding draft gets ONE e-mail through the same hub (mock unless MESSAGING_MODE says otherwise): only the console user's own consent and channel
   * choice (lead alerts on, an e-mail address, the e-mail channel, seen in the last 90 days) are used; the body carries the reference and the type only. Never throws.
   */
  async onOnboardingAssigned(n: { leadId: string; requestId: string; ref: string; assigneeSub: string; providerType: string; mode: string }): Promise<{ sent: boolean }> {
    try {
      const s = await this.prisma.opsStaffContact.findFirst({ where: { sub: n.assigneeSub, leadAlerts: true, email: { not: null }, channels: { has: 'EMAIL' }, lastSeenAt: { gte: new Date(Date.now() - 90 * 86_400_000) } } });
      if (!s) { await this.event(n.leadId, 'NOTIFY', { to: 'assignee', channel: 'EMAIL', sent: 0, reason: 'no_opt_in' }); return { sent: false }; }
      const ar = s.locale === 'ar';
      const r = await this.hub.send({
        channel: 'EMAIL', to: s.email!, sub: s.sub, templateId: ONBOARDING_ASSIGNED_TEMPLATE_ID, locale: ar ? 'ar' : 'en', messageClass: 'TRANSACTIONAL',
        subject: ar ? `طلب انضمام مسند إليك ${n.ref}` : `Onboarding request assigned to you ${n.ref}`,
        body: ar ? `أصبح طلب الانضمام ${n.ref} (${n.providerType}، ${n.mode}) مسودة انضمام مسندة إليك. افتح لوحة الإدارة، طلبات الانضمام.` : `Join request ${n.ref} (${n.providerType}, ${n.mode}) has an onboarding draft assigned to you. Open the admin console, Join requests.`,
      });
      await this.event(n.leadId, 'NOTIFY', { to: 'assignee', channel: 'EMAIL', sent: r.ok ? 1 : 0, requestId: n.requestId });
      return { sent: r.ok };
    } catch (e) { this.log.warn(`assignment notice failed lead=${n.leadId}: ${(e as Error).message}`); return { sent: false }; }
  }

  /**
   * Reminder for a join request that is still NEW and untouched (owner after the first threshold, the super admins after the second). One EMAIL per recipient through the shared hub (mock unless
   * MESSAGING_MODE says otherwise); only people who opted in to lead alerts are passed in. The body carries the reference and the type only. The trail always gets a REMINDER line (the in-app
   * record), even when nobody could be e-mailed. Never throws.
   */
  async onLeadReminder(n: LeadReminderNotice, to: ReminderRecipient[]): Promise<{ sent: number }> {
    let sent = 0;
    try {
      for (const s of to) {
        if (!s.email) continue;
        const ar = s.locale === 'ar'; const esc = n.level === 'ESCALATE';
        const r = await this.hub.send({
          channel: 'EMAIL', to: s.email, sub: s.sub, templateId: esc ? ESCALATION_TEMPLATE_ID : REMINDER_TEMPLATE_ID, locale: ar ? 'ar' : 'en', messageClass: 'TRANSACTIONAL',
          subject: esc ? (ar ? `طلب انضمام لم يُعالج ${n.ref}` : `Join request still untouched ${n.ref}`) : (ar ? `تذكير: طلب انضمام جديد ${n.ref}` : `Reminder: new join request ${n.ref}`),
          body: esc
            ? (ar ? `طلب الانضمام ${n.ref} (${n.providerType}، ${n.mode}) ما زال جديدا دون أي إجراء. افتح لوحة الإدارة، طلبات الانضمام.` : `Join request ${n.ref} (${n.providerType}, ${n.mode}) is still new and nobody has touched it. Open the admin console, Join requests.`)
            : (ar ? `طلب الانضمام ${n.ref} (${n.providerType}، ${n.mode}) ما زال جديدا دون أي إجراء. افتح لوحة الإدارة، طلبات الانضمام.` : `Join request ${n.ref} (${n.providerType}, ${n.mode}) is still new and untouched. Open the admin console, Join requests.`),
        });
        if (r.ok) sent++;
      }
    } catch (e) { this.log.warn(`reminder failed lead=${n.leadId}: ${(e as Error).message}`); }
    await this.event(n.leadId, 'REMINDER', { level: n.level, target: n.target, recipients: to.length, sent, since: n.since.toISOString() });
    return { sent };
  }

  private event(leadId: string, kind: string, data: Record<string, unknown>) {
    return this.prisma.leadEvent.create({ data: { id: newId('le'), leadId, kind, actor: 'system', data: data as never } }).catch(() => undefined);
  }
}
