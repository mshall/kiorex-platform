import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { BookingIntent, FamilyShare } from '../prisma/generated/client';
import { createHash, randomBytes } from 'node:crypto';
import { cfg } from '../common/config';
import { blindIndex, decryptField, encryptField } from '../common/crypto';
import { badRequest, conflict, notFound } from '../common/errors';
import { newId } from '../common/ids';
import { BookingService, HomeStatusKind } from '../booking/booking-public';
import { render, TEMPLATES } from '../engagement/engagement-public';
import { FlagsService } from '../control-plane/control-plane-public';
import { MessagingHub } from '../messaging/messaging-public';
import { PatientService } from '../patient/patient-public';
import { PrismaService } from '../prisma/prisma.service';

const STATUS_TEXT: Record<HomeStatusKind, { en: string; ar: string }> = {
  CONFIRMED: { en: 'Confirmed', ar: 'مؤكدة' }, ASSIGNED: { en: 'A clinician was assigned', ar: 'تم تعيين مقدم الرعاية' }, EN_ROUTE: { en: 'On the way', ar: 'في الطريق' },
  ARRIVED: { en: 'Arrived', ar: 'وصل' }, FINISHED: { en: 'Finished', ar: 'انتهت' }, ABORTED_UNSAFE: { en: 'Visit stopped', ar: 'تم إيقاف الزيارة' },
};
const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const maskPhone = (p: string) => (p.length > 6 ? `${p.slice(0, 4)}****${p.slice(-3)}` : '***');

/**
 * KXMHV07 / BR59: share the visit STATUS (never address, fee, phone numbers or clinical data) with up to 3 family contacts by WhatsApp link.
 * Consent twice: the patient's VISIT_STATUS_SHARING consent (consent centre, KXMAC04) and the patient's attestation that the contact agreed;
 * the contact can stop the updates from the link (STOP). Messages go through the WhatsApp adapter (MODE=mock|real).
 */
@Injectable()
export class FamilyShareService implements OnModuleInit {
  private readonly log = new Logger('family-share');
  constructor(private readonly prisma: PrismaService, private readonly booking: BookingService, private readonly patients: PatientService, private readonly hub: MessagingHub, private readonly flags: FlagsService) {}

  onModuleInit() {
    this.booking.onHomeStatus((b, kind) => this.onStatus(b, kind));
    this.patients.registerAnonymizer('familyShares', async (sub) => { await this.prisma.familyShare.updateMany({ where: { sub }, data: { phoneEnc: '', contactName: 'deleted', status: 'REVOKED' } }); });
  }

  private present(s: FamilyShare) { return { id: s.id, bookingId: s.bookingId, contactName: s.contactName, phoneMasked: s.phoneMasked, status: s.status, locale: s.locale, createdAt: s.createdAt }; }

  async create(sub: string, bookingId: string, i: { contactName: string; phone: string; locale?: string; consentAttested: boolean; visitStatusSharingConsent?: boolean }) {
    const b = await this.booking.ownedBooking(sub, bookingId);
    if (b.serviceLocation !== 'HOME') throw conflict('NOT_A_HOME_BOOKING', 'Only home visits can be shared');
    await this.flags.assertEnabled('kiorex.home_visits', { market: 'EG' });
    if (['COMPLETED', 'CANCELLED', 'NO_SHOW', 'EXPIRED'].includes(b.status)) throw conflict('BOOKING_NOT_SHAREABLE', `Booking is ${b.status}`);
    if (!i.consentAttested) throw badRequest('CONTACT_CONSENT_REQUIRED', 'Confirm that this person agreed to receive the visit status');
    if (i.visitStatusSharingConsent) await this.patients.setConsent(sub, 'VISIT_STATUS_SHARING', true, 'family-share');
    if (!(await this.patients.hasConsent(sub, 'VISIT_STATUS_SHARING'))) throw badRequest('CONSENT_REQUIRED', 'Grant the VISIT_STATUS_SHARING consent first', { purpose: 'VISIT_STATUS_SHARING' });
    const phone = i.phone.replace(/[\s-]/g, '');
    if (!/^\+?\d{9,15}$/.test(phone)) throw badRequest('INVALID_PHONE', 'phone must be an international number');
    const active = await this.prisma.familyShare.findMany({ where: { bookingId, status: 'ACTIVE' } });
    if (active.length >= cfg().familyShareMax) throw conflict('FAMILY_SHARE_LIMIT', `At most ${cfg().familyShareMax} family contacts per visit`);
    const phoneHash = blindIndex(phone);
    if (active.some((a) => a.phoneHash === phoneHash)) throw conflict('FAMILY_CONTACT_EXISTS', 'This contact already follows the visit');
    const token = randomBytes(24).toString('base64url');
    const locale = i.locale === 'en' ? 'en' : 'ar';
    const row = await this.prisma.familyShare.upsert({
      where: { bookingId_phoneHash: { bookingId, phoneHash } },
      create: { id: newId('kx_fs'), bookingId, sub, contactName: i.contactName.trim(), phoneEnc: encryptField(phone), phoneMasked: maskPhone(phone), phoneHash, tokenHash: sha(token), consentAttestedAt: new Date(), locale },
      update: { status: 'ACTIVE', stoppedAt: null, tokenHash: sha(token), contactName: i.contactName.trim(), phoneEnc: encryptField(phone), phoneMasked: maskPhone(phone), consentAttestedAt: new Date(), locale },
    });
    const link = `${cfg().appLinkBase.replace(/\/$/, '')}/visit-status/${token}`;
    const profile = await this.patients.profileBySub(sub);
    await this.send(row, phone, 'HOME_VISIT_FAMILY_INVITE', { patient: (profile?.nameEn ?? '').split(' ')[0], link }, sub);
    return { ...this.present(row), link };
  }

  async list(sub: string, bookingId: string) {
    await this.booking.ownedBooking(sub, bookingId);
    return (await this.prisma.familyShare.findMany({ where: { bookingId }, orderBy: { createdAt: 'asc' } })).map((s) => this.present(s));
  }
  async revoke(sub: string, bookingId: string, id: string) {
    await this.booking.ownedBooking(sub, bookingId);
    const r = await this.prisma.familyShare.updateMany({ where: { id, bookingId, status: 'ACTIVE' }, data: { status: 'REVOKED', stoppedAt: new Date() } });
    if (!r.count) throw notFound('SHARE_NOT_FOUND', 'Share not found');
    return { ok: true };
  }
  async activeCount(bookingId: string) { return this.prisma.familyShare.count({ where: { bookingId, status: 'ACTIVE' } }); }

  /** Public link (no login): status only. Expires 24 h after the visit ended or when stopped. */
  async publicStatus(token: string) {
    const s = await this.prisma.familyShare.findUnique({ where: { tokenHash: sha(token) } });
    if (!s || s.status !== 'ACTIVE') throw notFound('LINK_NOT_FOUND', 'This link is no longer active');
    const b = await this.booking.byId(s.bookingId);
    if (!b) throw notFound('LINK_NOT_FOUND', 'This link is no longer active');
    if (b.terminalAt && b.terminalAt.getTime() + cfg().addressMaskHours * 3600_000 < Date.now()) throw notFound('LINK_NOT_FOUND', 'This link is no longer active');
    const prog = await this.booking.homeProgress(b);
    const profile = await this.patients.profileBySub(b.sub);
    return {
      patientFirstName: (profile?.nameEn ?? '').split(' ')[0] || null, startsAt: b.startsAt, status: b.status, subState: prog.subState, steps: prog.steps, eta: prog.eta,
      provider: prog.assignee ? { displayName: prog.assignee.displayName, badge: prog.assignee.badge } : null, stopped: prog.aborted, // never the reason, address, fee or phone
    };
  }
  async stop(token: string) {
    const r = await this.prisma.familyShare.updateMany({ where: { tokenHash: sha(token), status: 'ACTIVE' }, data: { status: 'STOPPED', stoppedAt: new Date() } });
    if (!r.count) throw notFound('LINK_NOT_FOUND', 'This link is no longer active');
    return { ok: true };
  }

  private async send(s: FamilyShare, phone: string, kind: 'HOME_VISIT_FAMILY_INVITE' | 'HOME_VISIT_FAMILY_UPDATE', params: Record<string, unknown>, sub: string) {
    const t = TEMPLATES[kind];
    return this.hub.send({ channel: 'WHATSAPP', sub, to: phone, templateId: t.templateId, locale: s.locale, body: render(s.locale === 'en' ? t.en : t.ar, params) });
  }

  private async onStatus(b: BookingIntent, kind: HomeStatusKind) {
    const shares = await this.prisma.familyShare.findMany({ where: { bookingId: b.id, status: 'ACTIVE' } });
    if (!shares.length) return;
    if (!(await this.patients.hasConsent(b.sub, 'VISIT_STATUS_SHARING'))) { await this.prisma.familyShare.updateMany({ where: { bookingId: b.id, status: 'ACTIVE' }, data: { status: 'STOPPED', stoppedAt: new Date() } }); return; } // consent withdrawn
    if (kind === 'EN_ROUTE' && !(await this.flags.isEnabled('kiorex.visit_tracking', { market: 'EG' }))) return;
    const profile = await this.patients.profileBySub(b.sub);
    for (const s of shares) {
      if (s.lastNotifiedState === kind) continue;
      await this.prisma.familyShare.update({ where: { id: s.id }, data: { lastNotifiedState: kind } });
      const text = STATUS_TEXT[kind];
      try { await this.send(s, decryptField(s.phoneEnc), 'HOME_VISIT_FAMILY_UPDATE', { patient: (profile?.nameEn ?? '').split(' ')[0], status: s.locale === 'en' ? text.en : text.ar, link: '' }, b.sub); } catch (e) { this.log.warn(`family update failed for share ${s.id}`); }
    }
  }
}
