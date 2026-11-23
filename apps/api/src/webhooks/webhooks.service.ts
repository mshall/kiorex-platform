import { Injectable, Logger } from '@nestjs/common';
import { validateEvent } from '@kiorex/contracts';
import { cfg } from '../common/config';
import { ApiError } from '../common/errors';
import { verifyWebhook } from '../common/hmac';
import { BookingService } from '../booking/booking-public';
import { CarePlanService, SafetyService } from '../homecare/homecare-public';
import { CatalogService } from '../catalog/catalog-public';
import { EngagementService } from '../engagement/engagement-public';
import { LabService, NurseLabRelayService } from '../lab/lab-public';
import { PharmacyService } from '../pharmacy/pharmacy-public';
import { PartnerRegistry } from '../partners/partners-public';
import { WaitlistService } from '../waitlist/waitlist-public';
import { RecordsService } from '../records/records-public';
import { PrismaService } from '../prisma/prisma.service';
import { TrustService } from '../trust/trust-public';

const BOOKING_EVENTS = new Set(['APPOINTMENT_CONFIRMED', 'RESCHEDULED', 'APPOINTMENT_RESCHEDULED', 'CANCELLED_BY_CLINIC', 'CANCELLED_BY_PATIENT', 'CHECKED_IN', 'CHECK_IN_REVERTED', 'COMPLETED', 'NO_SHOW', 'MARKETPLACE_BOOKING_CONFIRM_TIMEOUT', 'HOME_VISIT_ASSIGNED', 'HOME_VISIT_EN_ROUTE', 'HOME_VISIT_ABORTED_UNSAFE']);

/** Kiorly → Kiorex webhooks: HMAC-verified, de-duplicated on eventId, drive the KX-03 §05 transitions. */
@Injectable()
export class WebhooksService {
  private readonly log = new Logger('webhooks');
  constructor(private readonly prisma: PrismaService, private readonly booking: BookingService, private readonly catalog: CatalogService, private readonly engagement: EngagementService, private readonly trust: TrustService, private readonly records: RecordsService, private readonly waitlist: WaitlistService, private readonly pharmacy: PharmacyService, private readonly lab: LabService, private readonly partners: PartnerRegistry, private readonly safety: SafetyService, private readonly carePlans: CarePlanService, private readonly nurseLab: NurseLabRelayService) {}

  /** `source` selects the shared secret: kiorly (Clinic) | pharmacy | lab. Same signature scheme (`sha256=HMAC(ts.rawBody)`) and eventId de-duplication for all. */
  async receive(raw: string, h: { signature?: string; timestamp?: string; eventIdHeader?: string; clientKey?: string }, source: 'kiorly' | 'pharmacy' | 'lab' = 'kiorly') {
    // Partners sign with a PER-PARTNER secret selected by X-Kiorly-Client-Key (PartnerRegistry); Kiorly Clinic keeps the single global secret.
    const secret = source === 'kiorly' ? cfg().kiorlyWebhookSecret : await this.partners.webhookSecret(source === 'pharmacy' ? 'PHARMACY' : 'LAB', h.clientKey);
    if (!secret || !verifyWebhook(secret, h.signature, raw, h.timestamp)) throw new ApiError(401, 'INVALID_SIGNATURE', 'Webhook signature rejected');
    let env: any;
    try { env = JSON.parse(raw); } catch { throw new ApiError(400, 'INVALID_JSON', 'Body is not JSON'); }
    const eventId: string = env.eventId ?? h.eventIdHeader;
    if (!eventId || !env.type) throw new ApiError(400, 'INVALID_ENVELOPE', 'eventId and type required');
    if (!cfg().isProd) {
      const v = validateEvent(env.type, env); // schema drift is logged, never rejected (forward compatible)
      if (!v.valid) this.log.warn(`event ${env.type} failed contract schema: ${(v as any).errors?.slice(0, 2).join('; ')}`);
    }
    // dedupe on eventId (insert-or-ignore is the lock)
    const inserted = await this.prisma.webhookReceipt.createMany({ data: [{ eventId, source, type: env.type, aggregateId: env.aggregateId, payload: RecordsService.redactEnvelope(env) }], skipDuplicates: true });
    if (!inserted.count) return { status: 'DUPLICATE' };
    try {
      const outcome = await this.route(env);
      await this.prisma.webhookReceipt.update({ where: { eventId }, data: { status: outcome === 'IGNORED' || outcome === 'UNKNOWN_BOOKING' ? 'IGNORED' : 'PROCESSED', processedAt: new Date(), error: outcome === 'UNKNOWN_BOOKING' ? 'no matching Kiorex booking or linked patient' : null } });
      return { status: outcome };
    } catch (e) {
      // allow Kiorly's retry to re-deliver: drop the receipt so the next attempt is processed
      await this.prisma.webhookReceipt.delete({ where: { eventId } }).catch(() => undefined);
      throw new ApiError(500, 'WEBHOOK_PROCESSING_FAILED', (e as Error).message);
    }
  }

  private async route(env: { type: string; aggregateId?: string; data?: Record<string, any> }): Promise<string> {
    const data = env.data ?? {};
    const type = env.type;
    if (BOOKING_EVENTS.has(type)) return this.booking.applyEvent({ type, aggregateId: env.aggregateId, data });
    if (type.toLowerCase().startsWith('telehealth.')) return this.booking.applyTelehealthEvent({ type, aggregateId: env.aggregateId, data }); // Clinic-owned P2P visit; unknown subtypes are ignored inside
    switch (type) {
      case 'SLOTS_CHANGED': // aggregateId = clinicianId
        this.catalog.invalidateSlots(data.clinicianId ?? env.aggregateId);
        await this.waitlist.onSlotsChanged(data.clinicianId ?? env.aggregateId); // BK-12: fill freed capacity from the waitlist
        return 'APPLIED';
      case 'PROVIDER_PROFILE_UPDATED':
      case 'LISTING_STATUS_CHANGED': // reindex; PAUSED listings are hidden by the sync (status column)
        this.catalog.invalidateSlots(data.clinicianId);
        await this.catalog.syncOnce();
        return 'APPLIED';
      case 'SAFETY_ALERT_RAISED': return this.safety.onAlertRaised(data, (env as any).eventId); // KXMOP12 (60 s SLO)
      case 'CARE_PLAN_CONFIRMED': return this.carePlans.onConfirmed(data);
      case 'CARE_PLAN_ENDED': return this.carePlans.onEnded(data);
      case 'ReferralIssued': case 'MedicationOrderShared': return 'IGNORED'; // Kiorly-to-Kiorly via patient consent; Kiorex does not relay these yet
      case 'REVIEW_INVITATION_ELIGIBLE': return this.trust.onInvitationEligible(data);
      case 'REVIEW_REPLY_POSTED': return this.trust.onReply(data);
      case 'VISIT_SUMMARY_SHARED':
      case 'PRESCRIPTION_SHARED':
      case 'RECORD_SHARE_REVOKED': { // KX-11 record shares: consent-based, signed, content never logged
        const o = await this.records.onKiorlyEvent({ type, aggregateId: env.aggregateId, eventId: (env as any).eventId, data });
        return o === 'APPLIED' ? 'APPLIED' : o === 'UNMAPPED_PATIENT' ? 'UNKNOWN_BOOKING' : 'IGNORED';
      }
      case 'LabOrderPlaced': { // KNLAB01: Kiorly Nurse (edition of Kiorly Clinic) hands a collected sample to a lab; Kiorex relays it (Clinic-edition hand-offs are acknowledged and ignored)
        const o = await this.nurseLab.onOrderPlaced({ ...(data as any), orderId: data.orderId ?? (env as any).aggregateId });
        return o === 'APPLIED' || o === 'REFUSED' ? 'APPLIED' : 'IGNORED';
      }
      case 'LabResultReleased': {
        const nurse = await this.nurseLab.onResultReleased({ orderId: data.orderId, reportId: data.reportId, reportVersion: data.reportVersion, signedAt: data.signedAt, secureLink: data.secureLink });
        const o = await this.lab.onResultReleased({ patientRef: data.patientRef, reportId: data.reportId, orderId: data.orderId, labId: data.labId, reportVersion: data.reportVersion, signedAt: data.signedAt, secureLink: data.secureLink, channels: data.channels }); // vault link for a linked Kiorex patient (consented channel only)
        if (nurse === 'APPLIED') return 'APPLIED';
        return o === 'APPLIED' ? 'APPLIED' : o === 'UNMAPPED_PATIENT' ? 'UNKNOWN_BOOKING' : 'IGNORED';
      }
      case 'LabOrderStatusChanged': {
        const nurse = await this.nurseLab.onStatusChanged({ orderId: data.orderId, sourceRef: data.sourceRef, nextStatus: data.nextStatus });
        if (nurse !== 'UNKNOWN_ORDER') return nurse; // a Nurse hand-off: never also a Kiorex booking
        const o = await this.lab.onStatusChanged({ orderId: data.orderId, sourceRef: data.sourceRef, nextStatus: data.nextStatus });
        return o === 'APPLIED' ? 'APPLIED' : o === 'UNKNOWN_ORDER' ? 'UNKNOWN_BOOKING' : 'IGNORED';
      }
      case 'OrderReady':
      case 'OrderOutForDelivery': // 1.8.0, additive: READY -> OUT_FOR_DELIVERY (DELIVERY orders)
      case 'DispenseCompleted':
      case 'OrderRejected': { // Kiorly Pharmacy (kiorex-contracts v2-draft); pharmacist sign-off enforced in the module
        const o = await this.pharmacy.onPartnerEvent(type, data);
        return o === 'APPLIED' ? 'APPLIED' : o === 'UNKNOWN_ORDER' ? 'UNKNOWN_BOOKING' : 'IGNORED';
      }
      case 'COMMISSION_CHARGE_CREATED':
      case 'COMMISSION_CHARGE_REVERSED': // reporting only: Kiorly decides attendance/commission (KX-09 §06)
        await this.prisma.auditLog.create({ data: { actor: 'kiorly', action: `finance.${type.toLowerCase()}`, resource: 'Appointment', resourceId: env.aggregateId, metadata: data as any } });
        return 'APPLIED';
      default:
        return 'IGNORED'; // unknown / v2 events: acknowledge for forward compatibility
    }
  }
}
