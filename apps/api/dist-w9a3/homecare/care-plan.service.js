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
exports.CarePlanService = void 0;
const common_1 = require("@nestjs/common");
const growth_ports_public_1 = require("../growth/growth-ports-public");
const crypto_1 = require("../common/crypto");
const errors_1 = require("../common/errors");
const ids_1 = require("../common/ids");
const address_public_1 = require("../address/address-public");
const booking_public_1 = require("../booking/booking-public");
const catalog_public_1 = require("../catalog/catalog-public");
const control_plane_public_1 = require("../control-plane/control-plane-public");
const engagement_public_1 = require("../engagement/engagement-public");
const kiorly_public_1 = require("../kiorly/kiorly-public");
const patient_public_1 = require("../patient/patient-public");
const prisma_service_1 = require("../prisma/prisma.service");
let CarePlanService = class CarePlanService {
    prisma;
    kiorly;
    flags;
    catalog;
    addresses;
    patients;
    booking;
    engagement;
    growth;
    constructor(prisma, kiorly, flags, catalog, addresses, patients, booking, engagement, growth) {
        this.prisma = prisma;
        this.kiorly = kiorly;
        this.flags = flags;
        this.catalog = catalog;
        this.addresses = addresses;
        this.patients = patients;
        this.booking = booking;
        this.engagement = engagement;
        this.growth = growth;
    }
    async request(sub, i, via = {}) {
        await this.flags.assertEnabled('kiorex.home_visits', { market: 'EG' });
        await this.flags.assertEnabled('nurse.care_plans', { market: 'EG' });
        const p = await this.catalog.getRow(i.providerId);
        if (p.status !== 'LIVE')
            throw (0, errors_1.conflict)('LISTING_NOT_LIVE', 'Unverified or paused listings are not bookable');
        if (!this.catalog.isHomeEnabled(p))
            throw (0, errors_1.conflict)('HOME_NOT_OFFERED', 'This provider does not offer home visits');
        const { row, visit } = await this.addresses.resolveForBooking(sub, i.addressId);
        if (!this.catalog.coversDistrict(p, row.district))
            throw await this.catalog.outOfCoverage(p, row.district);
        const identity = await this.patients.bookingIdentity(sub);
        const id = (0, ids_1.newId)('kx_cp');
        const plan = await this.prisma.carePlanBooking.create({ data: { id, sub, providerId: p.id, clinicId: p.clinicId, typeId: i.typeId, visitDistrict: row.district, visitAddressId: row.id, preferredStartDate: i.preferredStartDate ? new Date(i.preferredStartDate) : null, notesEnc: i.notes ? (0, crypto_1.encryptField)(i.notes) : null } });
        await this.growth?.decide({ product: 'NURSE', factKind: 'CARE_PLAN_BOOKING', factId: id, sub, orgRef: p.tenantId ?? null, createdAt: plan.createdAt, continuity: { entryId: via.continuityId ?? null } });
        try {
            await this.kiorly.createCarePlanRequest({ requestRef: id, clinicId: p.clinicId, clinicianId: p.clinicianId, typeId: i.typeId, preferredStartDate: i.preferredStartDate, notes: i.notes, visitAddress: visit, patient: { phone: identity.phone, firstNameEn: identity.firstNameEn, lastNameEn: identity.lastNameEn } });
        }
        catch (e) {
            await this.prisma.carePlanBooking.update({ where: { id }, data: { status: 'REJECTED', endedReason: e instanceof kiorly_public_1.KiorlyHttpError ? e.code ?? `KIORLY_${e.status}` : 'CLINIC_SYSTEM_BUSY' } });
            if (e instanceof kiorly_public_1.KiorlyHttpError && e.body?.code === 'OUT_OF_COVERAGE')
                throw await this.catalog.outOfCoverage(p, row.district);
            if (e instanceof kiorly_public_1.KiorlyHttpError)
                throw (0, errors_1.badRequest)(e.code ?? 'CARE_PLAN_REJECTED', 'The provider cannot accept this care plan request');
            if (e instanceof kiorly_public_1.KiorlyTransientError)
                throw (0, errors_1.unavailable)('CLINIC_SYSTEM_BUSY', 'Clinic system busy, try again shortly', { retryable: true });
            throw e;
        }
        return this.view(plan);
    }
    async view(plan) {
        const visits = await this.prisma.bookingIntent.findMany({ where: { carePlanId: plan.id }, orderBy: { startsAt: 'asc' } });
        return {
            id: plan.id, providerId: plan.providerId, status: plan.status, district: plan.visitDistrict, confirmedAt: plan.confirmedAt, endedAt: plan.endedAt, endedReason: plan.endedReason, createdAt: plan.createdAt,
            visits: visits.map((v) => ({ bookingId: v.id, startsAt: v.startsAt, endsAt: v.endsAt, status: v.status, homeState: v.homeState })),
            completedVisits: visits.filter((v) => v.status === 'COMPLETED').length,
        };
    }
    async list(sub) { return Promise.all((await this.prisma.carePlanBooking.findMany({ where: { sub }, orderBy: { createdAt: 'desc' }, take: 50 })).map((p) => this.view(p))); }
    async get(sub, id) {
        const p = await this.prisma.carePlanBooking.findFirst({ where: { id, sub } });
        if (!p)
            throw (0, errors_1.notFound)('CARE_PLAN_NOT_FOUND', 'Care plan not found');
        return this.view(p);
    }
    async onConfirmed(data) {
        const plan = data.requestRef ? await this.prisma.carePlanBooking.findUnique({ where: { id: String(data.requestRef) } }) : null;
        if (!plan || plan.status === 'ENDED')
            return 'IGNORED';
        await this.prisma.carePlanBooking.update({ where: { id: plan.id }, data: { status: 'CONFIRMED', kiorlyCarePlanId: data.carePlanId, confirmedAt: new Date() } });
        for (const v of data.visits ?? []) {
            const startsAt = new Date(v.startsAt);
            await this.booking.createConfirmedVisit({ sub: plan.sub, planId: plan.id, providerId: plan.providerId, typeId: plan.typeId ?? '', appointmentId: v.appointmentId, startsAt, endsAt: v.endsAt ? new Date(v.endsAt) : new Date(startsAt.getTime() + 45 * 60_000), district: plan.visitDistrict, addressId: plan.visitAddressId });
        }
        const p = await this.catalog.getRow(plan.providerId);
        await this.engagement.notify(plan.sub, { kind: 'CARE_PLAN_CONFIRMED', params: { doctor: p.nameAr ?? p.nameEn ?? '', count: (data.visits ?? []).length }, dedupeKey: `care-plan-confirmed:${plan.id}` }).catch(() => undefined);
        return 'APPLIED';
    }
    async onEnded(data) {
        const plan = (data.requestRef ? await this.prisma.carePlanBooking.findUnique({ where: { id: String(data.requestRef) } }) : null) ?? (data.carePlanId ? await this.prisma.carePlanBooking.findFirst({ where: { kiorlyCarePlanId: String(data.carePlanId) } }) : null);
        if (!plan || plan.status === 'ENDED')
            return 'IGNORED';
        await this.prisma.carePlanBooking.update({ where: { id: plan.id }, data: { status: 'ENDED', endedAt: new Date(), endedReason: data.reason } });
        for (const appt of data.cancelledAppointmentIds ?? [])
            await this.booking.applyEvent({ type: 'CANCELLED_BY_CLINIC', data: { appointmentId: appt, cancelledBy: 'CLINIC', depositRefundable: true } });
        const last = await this.prisma.bookingIntent.findFirst({ where: { carePlanId: plan.id, status: 'COMPLETED' }, orderBy: { startsAt: 'desc' } });
        if (last)
            await this.engagement.scheduleReviewInvite({ id: last.id, sub: last.sub }, { doctor: '', time: last.startsAt.toISOString() }).catch(() => undefined);
        return 'APPLIED';
    }
};
exports.CarePlanService = CarePlanService;
exports.CarePlanService = CarePlanService = __decorate([
    (0, common_1.Injectable)(),
    __param(8, (0, common_1.Optional)()),
    __param(8, (0, common_1.Inject)(growth_ports_public_1.PRODUCT_GROWTH)),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, kiorly_public_1.KiorlyClient, control_plane_public_1.FlagsService, catalog_public_1.CatalogService, address_public_1.AddressService, patient_public_1.PatientService, booking_public_1.BookingService, engagement_public_1.EngagementService, Object])
], CarePlanService);
//# sourceMappingURL=care-plan.service.js.map