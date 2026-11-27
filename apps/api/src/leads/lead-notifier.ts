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
export const TEAM_TEMPLATE_ID = 'TODO_NEEDS_HUMAN_site_lead_team_alert';

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

  private event(leadId: string, kind: string, data: Record<string, unknown>) {
    return this.prisma.leadEvent.create({ data: { id: newId('le'), leadId, kind, actor: 'system', data: data as never } }).catch(() => undefined);
  }
}
