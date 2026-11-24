import { Inject, Injectable, Logger } from '@nestjs/common';
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
import { PublicSiteCache } from '../public-site/public-site-public';
import { WidgetRegistrationService } from '../widget/widget-public';
import { VerificationUpdateService } from '../partner-onboarding/partner-onboarding-public';
import { GROWTH_REVENUE, LINK_REGISTRY, type GrowthRevenuePort, type LinkRegistryPort } from '../growth/growth-ports-public';

const BOOKING_EVENTS = new Set(['APPOINTMENT_CONFIRMED', 'RESCHEDULED', 'APPOINTMENT_RESCHEDULED', 'CANCELLED_BY_CLINIC', 'CANCELLED_BY_PATIENT', 'CHECKED_IN', 'CHECK_IN_REVERTED', 'COMPLETED', 'NO_SHOW', 'MARKETPLACE_BOOKING_CONFIRM_TIMEOUT', 'HOME_VISIT_ASSIGNED', 'HOME_VISIT_EN_ROUTE', 'HOME_VISIT_ABORTED_UNSAFE']);

/** Kiorly → Kiorex webhooks: HMAC-verified, de-duplicated on eventId, drive the KX-03 §05 transitions. */
@Injectable()
export class WebhooksService {
  private readonly log = new Logger('webhooks');
  constructor(private readonly prisma: PrismaService, private readonly booking: BookingService, private readonly catalog: CatalogService, private readonly engagement: EngagementService, private readonly trust: TrustService, private readonly records: RecordsService, private readonly waitlist: WaitlistService, private readonly pharmacy: PharmacyService, private readonly lab: LabService, private readonly partners: PartnerRegistry, private readonly safety: SafetyService, private readonly carePlans: CarePlanService, private readonly nurseLab: NurseLabRelayService, private readonly publicSite: PublicSiteCache, private readonly widgets: WidgetRegistrationService, @Inject(GROWTH_REVENUE) private readonly revenue: GrowthRevenuePort, @Inject(LINK_REGISTRY) private readonly linkRegistry: LinkRegistryPort, private readonly verificationUpdates: VerificationUpdateService) {}

  /** `source` selects the shared secret: kiorly (Clinic) | pharmacy | lab. Same signature scheme (`sha256=HMAC(ts.rawBody)`) and eventId de-duplication for all. */
  async receive(raw: string, h: { signature?: string; timestamp?: string; eventIdHeader?: string; clientKey?: string }, source: 'kiorly' | 'pharmacy' | 'lab' = 'kiorly') {
    // Partners sign with a PER-PARTNER secret selected by X-Kiorly-Client-Key (PartnerRegistry); Kiorly Clinic keeps the single global secret.
    const auth = source === 'kiorly' ? { secret: cfg().kiorlyWebhookSecret, registrationId: null as string | null } : await this.partners.webhookAuth(source === 'pharmacy' ? 'PHARMACY' : 'LAB', h.clientKey);
    const secret = auth?.secret; const registrationId = auth?.registrationId ?? null; // the registration whose secret verified this event: it may only touch its own orders / bookings
    if (!secret || !verifyWebhook(secret, h.signature, raw, h.timestamp)) throw new ApiError(401, 'INVALID_SIGNATURE', 'Webhook signature rejected');
    let env: any;
    try { env = JSON.parse(raw); } catch { throw new ApiError(400, 'INVALID_JSON', 'Body is not JSON'); }
    // A signed sender is trusted, but a malformed envelope (null, array, numeric eventId, object type, 5 kB id) must be a 400 the sender can see, not a TypeError / Prisma
    // validation error that answers 500 and is retried forever (poison message).
    if (!env || typeof env !== 'object' || Array.isArray(env)) throw new ApiError(400, 'INVALID_ENVELOPE', 'Body must be a JSON object');
    const eventId: string = env.eventId ?? h.eventIdHeader;
    if (typeof eventId !== 'string' || !eventId || eventId.length > 200 || typeof env.type !== 'string' || !env.type || env.type.length > 120) throw new ApiError(400, 'INVALID_ENVELOPE', 'eventId and type required (strings)');
    if (env.data !== undefined && env.data !== null && (typeof env.data !== 'object' || Array.isArray(env.data))) throw new ApiError(400, 'INVALID_ENVELOPE', 'data must be an object');
    if (env.aggregateId !== undefined && env.aggregateId !== null && (typeof env.aggregateId !== 'string' || env.aggregateId.length > 200)) throw new ApiError(400, 'INVALID_ENVELOPE', 'aggregateId must be a string');
    if (!cfg().isProd) {
      const v = validateEvent(env.type, env); // schema drift is logged, never rejected (forward compatible)
      if (!v.valid) this.log.warn(`event ${env.type} failed contract schema: ${(v as any).errors?.slice(0, 2).join('; ')}`);
    }
    // dedupe on eventId (insert-or-ignore is the lock)
    const inserted = await this.prisma.webhookReceipt.createMany({ data: [{ eventId, source, type: env.type, aggregateId: env.aggregateId, payload: RecordsService.redactEnvelope(env) }], skipDuplicates: true });
    if (!inserted.count) return { status: 'DUPLICATE' };
    try {
      const outcome = await this.route(env, { registrationId });
      await this.prisma.webhookReceipt.update({ where: { eventId }, data: { status: outcome === 'IGNORED' || outcome === 'UNKNOWN_BOOKING' ? 'IGNORED' : 'PROCESSED', processedAt: new Date(), error: outcome === 'UNKNOWN_BOOKING' ? 'no matching Kiorex booking or linked patient' : null } });
      return { status: outcome };
    } catch (e) {
      // allow Kiorly's retry to re-deliver: drop the receipt so the next attempt is processed
      await this.prisma.webhookReceipt.delete({ where: { eventId } }).catch(() => undefined);
      throw new ApiError(500, 'WEBHOOK_PROCESSING_FAILED', (e as Error).message);
    }
  }

  private async route(env: { type: string; aggregateId?: string; data?: Record<string, any> }, ctx: { registrationId: string | null }): Promise<string> {
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
        if (type === 'PROVIDER_PROFILE_UPDATED') await this.widgets.upsertFromProfile(data).catch((e: Error) => this.log.warn(`widget registration sync failed: ${e.message}`)); // GRW-P1-G: the Clinic allow-list (widgetOrigins) -> WidgetRegistration
        this.catalog.invalidateSlots(data.clinicianId);
        await this.catalog.syncOnce();
        await this.publicSite.onListingChanged([data.listingId, data.clinicianId, data.clinicId, env.aggregateId]).catch((e) => this.log.warn(`public site purge failed: ${(e as Error).message}`)); // GRW-P1-E: pages and sitemaps within 15 min
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
        const nurse = await this.nurseLab.onResultReleased({ orderId: data.orderId, reportId: data.reportId, reportVersion: data.reportVersion, signedAt: data.signedAt, secureLink: data.secureLink }, ctx);
        const o = await this.lab.onResultReleased({ patientRef: data.patientRef, reportId: data.reportId, orderId: data.orderId, labId: data.labId, reportVersion: data.reportVersion, signedAt: data.signedAt, secureLink: data.secureLink, channels: data.channels }, ctx); // vault link for a linked Kiorex patient (consented channel only)
        if (nurse === 'APPLIED') return 'APPLIED';
        return o === 'APPLIED' ? 'APPLIED' : o === 'UNMAPPED_PATIENT' ? 'UNKNOWN_BOOKING' : 'IGNORED';
      }
      case 'LabOrderStatusChanged': {
        const nurse = await this.nurseLab.onStatusChanged({ orderId: data.orderId, sourceRef: data.sourceRef, nextStatus: data.nextStatus }, ctx);
        if (nurse !== 'UNKNOWN_ORDER') return nurse; // a Nurse hand-off: never also a Kiorex booking
        const o = await this.lab.onStatusChanged({ orderId: data.orderId, sourceRef: data.sourceRef, nextStatus: data.nextStatus }, ctx);
        return o === 'APPLIED' ? 'APPLIED' : o === 'UNKNOWN_ORDER' ? 'UNKNOWN_BOOKING' : 'IGNORED';
      }
      case 'OrderReady':
      case 'OrderOutForDelivery': // 1.8.0, additive: READY -> OUT_FOR_DELIVERY (DELIVERY orders)
      case 'DispenseCompleted':
      case 'OrderRejected': { // Kiorly Pharmacy (kiorex-contracts v2-draft); pharmacist sign-off enforced in the module
        const o = await this.pharmacy.onPartnerEvent(type, data, ctx);
        return o === 'APPLIED' ? 'APPLIED' : o === 'UNKNOWN_ORDER' ? 'UNKNOWN_BOOKING' : 'IGNORED';
      }
      case 'COMMISSION_CHARGE_CREATED':
      case 'COMMISSION_CHARGE_REVERSED': // reporting only: Kiorly decides attendance/commission (KX-09 §06)
        await this.prisma.auditLog.create({ data: { actor: 'kiorly', action: `finance.${type.toLowerCase()}`, resource: 'Appointment', resourceId: env.aggregateId, metadata: data as any } });
        await this.revenue.recordFromEvent(type, data, (env as any).occurredAt); // GRW-P1-J: Kiorex revenue facts (charges only, never booking value)
        return 'APPLIED';
      case 'ReferralLinkCreated': // link registry (contracts 1.11.0): code -> organisation mapping from the Clinic, known before the first signed token
        return (await this.linkRegistry.registerFromEvent({ ...data, orgRef: data.orgRef ?? data.tenantId ?? (env as any).tenantId })) === 'IGNORED' ? 'IGNORED' : 'APPLIED';
      case 'ReferralLinkRevoked': // link registry: a revoked code stops deciding PROVIDER_LED for new bookings (removal only; written decisions are append-only)
        return (await this.linkRegistry.revokeFromEvent({ ...data, orgRef: data.orgRef ?? data.tenantId ?? (env as any).tenantId })) === 'IGNORED' ? 'IGNORED' : 'APPLIED';
      case 'ProviderVerificationUpdateRequested': // GRW-P2-C: a provider asks ops to update a verified field; queued for ops, the value stays in the Clinic
        return this.verificationUpdates.onRequested(data);
      case 'WAITLIST_OFFER_CREATED': // GRW-GC-2: same payload as WAITLIST_OFFER (which stays the delivered event); acknowledged, no second notification
      case 'WAITLIST_OFFER_EXPIRED': // the offer lapsed or was withdrawn: nothing to deliver, the patient's offer view reads the Clinic
        return 'IGNORED';
      default:
        return 'IGNORED'; // unknown / v2 events: acknowledge for forward compatibility
    }
  }
}
