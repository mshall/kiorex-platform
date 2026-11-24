"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhooksService = void 0;
const common_1 = require("@nestjs/common");
const contracts_1 = require("@kiorex/contracts");
const config_1 = require("../common/config");
const errors_1 = require("../common/errors");
const hmac_1 = require("../common/hmac");
const booking_public_1 = require("../booking/booking-public");
const homecare_public_1 = require("../homecare/homecare-public");
const catalog_public_1 = require("../catalog/catalog-public");
const engagement_public_1 = require("../engagement/engagement-public");
const lab_public_1 = require("../lab/lab-public");
const pharmacy_public_1 = require("../pharmacy/pharmacy-public");
const partners_public_1 = require("../partners/partners-public");
const waitlist_public_1 = require("../waitlist/waitlist-public");
const records_public_1 = require("../records/records-public");
const prisma_service_1 = require("../prisma/prisma.service");
const trust_public_1 = require("../trust/trust-public");
const public_site_public_1 = require("../public-site/public-site-public");
const widget_public_1 = require("../widget/widget-public");
const partner_onboarding_public_1 = require("../partner-onboarding/partner-onboarding-public");
const growth_ports_public_1 = require("../growth/growth-ports-public");
const growth_public_1 = require("../growth/growth-public");
const BOOKING_EVENTS = new Set(['APPOINTMENT_CONFIRMED', 'RESCHEDULED', 'APPOINTMENT_RESCHEDULED', 'CANCELLED_BY_CLINIC', 'CANCELLED_BY_PATIENT', 'CHECKED_IN', 'CHECK_IN_REVERTED', 'COMPLETED', 'NO_SHOW', 'MARKETPLACE_BOOKING_CONFIRM_TIMEOUT', 'HOME_VISIT_ASSIGNED', 'HOME_VISIT_EN_ROUTE', 'HOME_VISIT_ABORTED_UNSAFE']);
let WebhooksService = class WebhooksService {
    prisma;
    booking;
    catalog;
    engagement;
    trust;
    records;
    waitlist;
    pharmacy;
    lab;
    partners;
    safety;
    carePlans;
    nurseLab;
    publicSite;
    widgets;
    revenue;
    linkRegistry;
    verificationUpdates;
    promotionProjection;
    promotionReviews;
    sponsoredDiscounts;
    log = new common_1.Logger('webhooks');
    constructor(prisma, booking, catalog, engagement, trust, records, waitlist, pharmacy, lab, partners, safety, carePlans, nurseLab, publicSite, widgets, revenue, linkRegistry, verificationUpdates, promotionProjection, promotionReviews, sponsoredDiscounts) {
        this.prisma = prisma;
        this.booking = booking;
        this.catalog = catalog;
        this.engagement = engagement;
        this.trust = trust;
        this.records = records;
        this.waitlist = waitlist;
        this.pharmacy = pharmacy;
        this.lab = lab;
        this.partners = partners;
        this.safety = safety;
        this.carePlans = carePlans;
        this.nurseLab = nurseLab;
        this.publicSite = publicSite;
        this.widgets = widgets;
        this.revenue = revenue;
        this.linkRegistry = linkRegistry;
        this.verificationUpdates = verificationUpdates;
        this.promotionProjection = promotionProjection;
        this.promotionReviews = promotionReviews;
        this.sponsoredDiscounts = sponsoredDiscounts;
    }
    async receive(raw, h, source = 'kiorly') {
        const auth = source === 'kiorly' ? { secret: (0, config_1.cfg)().kiorlyWebhookSecret, registrationId: null } : await this.partners.webhookAuth(source === 'pharmacy' ? 'PHARMACY' : 'LAB', h.clientKey);
        const secret = auth?.secret;
        const registrationId = auth?.registrationId ?? null;
        if (!secret || !(0, hmac_1.verifyWebhook)(secret, h.signature, raw, h.timestamp))
            throw new errors_1.ApiError(401, 'INVALID_SIGNATURE', 'Webhook signature rejected');
        let env;
        try {
            env = JSON.parse(raw);
        }
        catch {
            throw new errors_1.ApiError(400, 'INVALID_JSON', 'Body is not JSON');
        }
        if (!env || typeof env !== 'object' || Array.isArray(env))
            throw new errors_1.ApiError(400, 'INVALID_ENVELOPE', 'Body must be a JSON object');
        const eventId = env.eventId ?? h.eventIdHeader;
        if (typeof eventId !== 'string' || !eventId || eventId.length > 200 || typeof env.type !== 'string' || !env.type || env.type.length > 120)
            throw new errors_1.ApiError(400, 'INVALID_ENVELOPE', 'eventId and type required (strings)');
        if (env.data !== undefined && env.data !== null && (typeof env.data !== 'object' || Array.isArray(env.data)))
            throw new errors_1.ApiError(400, 'INVALID_ENVELOPE', 'data must be an object');
        if (env.aggregateId !== undefined && env.aggregateId !== null && (typeof env.aggregateId !== 'string' || env.aggregateId.length > 200))
            throw new errors_1.ApiError(400, 'INVALID_ENVELOPE', 'aggregateId must be a string');
        if (!(0, config_1.cfg)().isProd) {
            const v = (0, contracts_1.validateEvent)(env.type, env);
            if (!v.valid)
                this.log.warn(`event ${env.type} failed contract schema: ${v.errors?.slice(0, 2).join('; ')}`);
        }
        const inserted = await this.prisma.webhookReceipt.createMany({ data: [{ eventId, source, type: env.type, aggregateId: env.aggregateId, payload: records_public_1.RecordsService.redactEnvelope(env) }], skipDuplicates: true });
        if (!inserted.count)
            return { status: 'DUPLICATE' };
        try {
            const outcome = await this.route(env, { registrationId });
            await this.prisma.webhookReceipt.update({ where: { eventId }, data: { status: outcome === 'IGNORED' || outcome === 'UNKNOWN_BOOKING' ? 'IGNORED' : 'PROCESSED', processedAt: new Date(), error: outcome === 'UNKNOWN_BOOKING' ? 'no matching Kiorex booking or linked patient' : null } });
            return { status: outcome };
        }
        catch (e) {
            await this.prisma.webhookReceipt.delete({ where: { eventId } }).catch(() => undefined);
            throw new errors_1.ApiError(500, 'WEBHOOK_PROCESSING_FAILED', e.message);
        }
    }
    async route(env, ctx) {
        const data = env.data ?? {};
        const type = env.type;
        if (BOOKING_EVENTS.has(type))
            return this.booking.applyEvent({ type, aggregateId: env.aggregateId, data });
        if (type.toLowerCase().startsWith('telehealth.'))
            return this.booking.applyTelehealthEvent({ type, aggregateId: env.aggregateId, data });
        switch (type) {
            case 'SLOTS_CHANGED':
                this.catalog.invalidateSlots(data.clinicianId ?? env.aggregateId);
                await this.waitlist.onSlotsChanged(data.clinicianId ?? env.aggregateId);
                return 'APPLIED';
            case 'PROVIDER_PROFILE_UPDATED':
            case 'LISTING_STATUS_CHANGED':
                if (type === 'PROVIDER_PROFILE_UPDATED')
                    await this.widgets.upsertFromProfile(data).catch((e) => this.log.warn(`widget registration sync failed: ${e.message}`));
                this.catalog.invalidateSlots(data.clinicianId);
                await this.catalog.syncOnce();
                await this.publicSite.onListingChanged([data.listingId, data.clinicianId, data.clinicId, env.aggregateId]).catch((e) => this.log.warn(`public site purge failed: ${e.message}`));
                return 'APPLIED';
            case 'SAFETY_ALERT_RAISED': return this.safety.onAlertRaised(data, env.eventId);
            case 'CARE_PLAN_CONFIRMED': return this.carePlans.onConfirmed(data);
            case 'CARE_PLAN_ENDED': return this.carePlans.onEnded(data);
            case 'ReferralIssued':
            case 'MedicationOrderShared': return 'IGNORED';
            case 'REVIEW_INVITATION_ELIGIBLE': return this.trust.onInvitationEligible(data);
            case 'REVIEW_REPLY_POSTED': return this.trust.onReply(data);
            case 'VISIT_SUMMARY_SHARED':
            case 'PRESCRIPTION_SHARED':
            case 'RECORD_SHARE_REVOKED': {
                const o = await this.records.onKiorlyEvent({ type, aggregateId: env.aggregateId, eventId: env.eventId, data });
                return o === 'APPLIED' ? 'APPLIED' : o === 'UNMAPPED_PATIENT' ? 'UNKNOWN_BOOKING' : 'IGNORED';
            }
            case 'LabOrderPlaced': {
                const o = await this.nurseLab.onOrderPlaced({ ...data, orderId: data.orderId ?? env.aggregateId });
                return o === 'APPLIED' || o === 'REFUSED' ? 'APPLIED' : 'IGNORED';
            }
            case 'LabResultReleased': {
                const nurse = await this.nurseLab.onResultReleased({ orderId: data.orderId, reportId: data.reportId, reportVersion: data.reportVersion, signedAt: data.signedAt, secureLink: data.secureLink }, ctx);
                const o = await this.lab.onResultReleased({ patientRef: data.patientRef, reportId: data.reportId, orderId: data.orderId, labId: data.labId, reportVersion: data.reportVersion, signedAt: data.signedAt, secureLink: data.secureLink, channels: data.channels }, ctx);
                if (nurse === 'APPLIED')
                    return 'APPLIED';
                return o === 'APPLIED' ? 'APPLIED' : o === 'UNMAPPED_PATIENT' ? 'UNKNOWN_BOOKING' : 'IGNORED';
            }
            case 'LabOrderStatusChanged': {
                const nurse = await this.nurseLab.onStatusChanged({ orderId: data.orderId, sourceRef: data.sourceRef, nextStatus: data.nextStatus }, ctx);
                if (nurse !== 'UNKNOWN_ORDER')
                    return nurse;
                const o = await this.lab.onStatusChanged({ orderId: data.orderId, sourceRef: data.sourceRef, nextStatus: data.nextStatus }, ctx);
                return o === 'APPLIED' ? 'APPLIED' : o === 'UNKNOWN_ORDER' ? 'UNKNOWN_BOOKING' : 'IGNORED';
            }
            case 'OrderReady':
            case 'OrderOutForDelivery':
            case 'DispenseCompleted':
            case 'OrderRejected': {
                const o = await this.pharmacy.onPartnerEvent(type, data, ctx);
                return o === 'APPLIED' ? 'APPLIED' : o === 'UNKNOWN_ORDER' ? 'UNKNOWN_BOOKING' : 'IGNORED';
            }
            case 'COMMISSION_CHARGE_CREATED':
            case 'COMMISSION_CHARGE_REVERSED':
                await this.prisma.auditLog.create({ data: { actor: 'kiorly', action: `finance.${type.toLowerCase()}`, resource: 'Appointment', resourceId: env.aggregateId, metadata: data } });
                await this.revenue.recordFromEvent(type, data, env.occurredAt);
                return 'APPLIED';
            case 'ReferralLinkCreated':
                return (await this.linkRegistry.registerFromEvent({ ...data, orgRef: data.orgRef ?? data.tenantId ?? env.tenantId })) === 'IGNORED' ? 'IGNORED' : 'APPLIED';
            case 'ReferralLinkRevoked':
                return (await this.linkRegistry.revokeFromEvent({ ...data, orgRef: data.orgRef ?? data.tenantId ?? env.tenantId })) === 'IGNORED' ? 'IGNORED' : 'APPLIED';
            case 'ProviderVerificationUpdateRequested':
                return this.verificationUpdates.onRequested(data);
            case 'PROVIDER_PROMOTION_UPDATED': {
                const o = await this.promotionProjection.applyUpdated({ ...data, orgRef: data.orgRef ?? env.tenantId });
                if (o === 'APPLIED' && data.status === 'IN_REVIEW')
                    await this.promotionReviews.openReviews(String(data.promotionId), Number(data.version)).catch(() => undefined);
                return o;
            }
            case 'SponsoredDiscountReserved':
            case 'SponsoredDiscountDebited':
            case 'SponsoredDiscountReleased':
            case 'SponsoredDiscountReversed':
                return this.sponsoredDiscounts.applyClinicEvent(type, data);
            case 'WAITLIST_OFFER_CREATED':
            case 'WAITLIST_OFFER_EXPIRED':
                return 'IGNORED';
            default:
                return 'IGNORED';
        }
    }
};
exports.WebhooksService = WebhooksService;
exports.WebhooksService = WebhooksService = __decorate([
    (0, common_1.Injectable)(),
    __param(15, (0, common_1.Inject)(growth_ports_public_1.GROWTH_REVENUE)),
    __param(16, (0, common_1.Inject)(growth_ports_public_1.LINK_REGISTRY)),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, booking_public_1.BookingService, catalog_public_1.CatalogService, engagement_public_1.EngagementService, trust_public_1.TrustService, records_public_1.RecordsService, waitlist_public_1.WaitlistService, pharmacy_public_1.PharmacyService, lab_public_1.LabService, partners_public_1.PartnerRegistry, homecare_public_1.SafetyService, homecare_public_1.CarePlanService, lab_public_1.NurseLabRelayService, public_site_public_1.PublicSiteCache, widget_public_1.WidgetRegistrationService, Object, Object, partner_onboarding_public_1.VerificationUpdateService, growth_public_1.PromotionProjectionService, growth_public_1.PromotionReviewService, growth_public_1.SponsoredDiscountService])
], WebhooksService);
//# sourceMappingURL=webhooks.service.js.map