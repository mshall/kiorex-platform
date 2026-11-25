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
exports.BookingService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("../prisma/generated/client");
const node_crypto_1 = require("node:crypto");
const config_1 = require("../common/config");
const errors_1 = require("../common/errors");
const ids_1 = require("../common/ids");
const catalog_public_1 = require("../catalog/catalog-public");
const control_plane_public_1 = require("../control-plane/control-plane-public");
const engagement_public_1 = require("../engagement/engagement-public");
const market_public_1 = require("../market/market-public");
const kiorly_public_1 = require("../kiorly/kiorly-public");
const outbox_public_1 = require("../outbox/outbox-public");
const patient_public_1 = require("../patient/patient-public");
const pay_public_1 = require("../pay/pay-public");
const growth_ports_public_1 = require("../growth/growth-ports-public");
const prisma_service_1 = require("../prisma/prisma.service");
const address_public_1 = require("../address/address-public");
const district_1 = require("../common/district");
const telehealth_1 = require("./telehealth");
const booking_state_1 = require("./booking-state");
let BookingService = class BookingService {
    prisma;
    kiorly;
    catalog;
    flags;
    patients;
    pay;
    engagement;
    outbox;
    markets;
    addresses;
    growth;
    rewards;
    sponsored;
    log = new common_1.Logger('booking');
    timer;
    homeListeners = [];
    constructor(prisma, kiorly, catalog, flags, patients, pay, engagement, outbox, markets, addresses, growth, rewards, sponsored) {
        this.prisma = prisma;
        this.kiorly = kiorly;
        this.catalog = catalog;
        this.flags = flags;
        this.patients = patients;
        this.pay = pay;
        this.engagement = engagement;
        this.outbox = outbox;
        this.markets = markets;
        this.addresses = addresses;
        this.growth = growth;
        this.rewards = rewards;
        this.sponsored = sponsored;
    }
    onHomeStatus(fn) { this.homeListeners.push(fn); }
    async emitHome(b, kind) {
        for (const fn of this.homeListeners)
            await fn(b, kind).catch((e) => this.log.warn(`home listener failed for ${b.id}: ${e.message}`));
    }
    onModuleInit() {
        this.outbox.register('pay.deposit_captured', (e) => this.onDepositCaptured(e.payload));
        this.outbox.register('pay.review_resolved', (e) => this.onReviewResolved(e.payload));
        this.patients.registerExport('bookings', async (sub) => (await this.prisma.bookingIntent.findMany({ where: { sub } })).map((b) => ({ id: b.id, status: b.status, startsAt: b.startsAt, providerId: b.providerId, depositStatus: b.depositStatus })));
        this.patients.registerAnonymizer('bookings', async (sub) => {
            const h = (0, node_crypto_1.createHash)('sha256').update(sub).digest('hex').slice(0, 10);
            await this.prisma.bookingIntent.updateMany({ where: { sub }, data: { patientSnapshot: undefined, sub: `deleted:${h}`, dependantId: null } });
        });
        if ((0, config_1.cfg)().jobsEnabled) {
            this.timer = setInterval(() => void this.expireHolds().catch((e) => this.log.warn(e.message)), 30_000);
            this.timer.unref();
            const nightly = setInterval(() => { if (new Date().getUTCHours() === 2)
                void this.reconcileNightly().catch(() => undefined); }, 3600_000);
            nightly.unref();
        }
    }
    onModuleDestroy() { if (this.timer)
        clearInterval(this.timer); }
    async ev(bookingId, kind, detail, from, to) {
        await this.prisma.bookingEvent.create({ data: { bookingId, kind, fromStatus: from, toStatus: to, detail: (detail ?? undefined) } });
    }
    async owned(sub, id) {
        const b = await this.prisma.bookingIntent.findUnique({ where: { id } });
        if (!b || b.sub !== sub)
            throw (0, errors_1.notFound)('BOOKING_NOT_FOUND', 'Booking not found');
        return b;
    }
    async move(b, to, patch = {}, detail) {
        const r = await this.prisma.bookingIntent.updateMany({ where: { id: b.id, status: b.status }, data: { ...patch, status: to, version: { increment: 1 }, ...((0, booking_state_1.isTerminal)(to) ? { terminalAt: new Date() } : {}) } });
        if (!r.count)
            return null;
        await this.ev(b.id, 'STATE', detail, b.status, to);
        await this.growthFact(b, to, detail);
        if ((0, booking_state_1.isTerminal)(to) && b.serviceLocation === 'HOME')
            await this.addresses.scheduleMask(b.id);
        return this.prisma.bookingIntent.findUniqueOrThrow({ where: { id: b.id } });
    }
    async growthFact(b, to, detail) {
        const d = (detail ?? {});
        if (to === 'CONFIRMED')
            await this.growth.fact('BookingConfirmed', b, 'EG');
        else if (to === 'CHECKED_IN' || to === 'COMPLETED') {
            if (to === 'COMPLETED')
                await this.growth.onCompleted(b.id);
            await this.growth.fact('BookingAttended', b, 'EG', d.newPatient === undefined ? {} : { bucket: d.newPatient ? 'new' : 'returning' });
        }
        else if (to === 'CANCELLED')
            await this.growth.fact('BookingCancelled', b, 'EG', { reason: d.via === 'CANCELLED_BY_PATIENT' ? 'patient' : d.via === 'CANCELLED_BY_CLINIC' ? 'clinic' : 'other' });
    }
    doctorParams(p, b) {
        return { doctor: p?.nameAr ?? p?.nameEn ?? '', time: b.startsAt.toISOString() };
    }
    async provider(b) {
        return this.prisma.provider.findUnique({ where: { id: b.providerId } });
    }
    async present(b) {
        const p = await this.provider(b);
        const raw = p?.raw ?? {};
        const timeline = (await this.prisma.bookingEvent.findMany({ where: { bookingId: b.id, kind: 'STATE' }, orderBy: { createdAt: 'asc' } })).map((e) => ({ status: e.toStatus, at: e.createdAt }));
        const pay = b.depositStatus !== 'NONE' ? await this.pay.intentForBooking(b.id) : null;
        return {
            id: b.id, status: b.status, providerId: b.providerId, clinicId: b.clinicId, typeId: b.typeId, startsAt: b.startsAt, endsAt: b.endsAt, dependantId: b.dependantId, channel: b.channel,
            holdExpiresAt: b.status === 'HELD' ? b.holdExpiresAt : null, confirmationDueAt: b.confirmationDueAt, cancelledBy: b.cancelledBy, cancellationReason: b.cancellationReason, failureCode: b.failureCode,
            callState: b.callState, depositStatus: b.depositStatus, depositAmountMinor: b.depositAmountMinor, currency: b.currency, depositRefundable: b.depositRefundable,
            deposit: pay ? { paymentId: pay.id, status: pay.status, checkoutUrl: pay.status === 'CREATED' ? pay.checkoutUrl : null } : null,
            doctor: p ? { nameEn: p.nameEn, nameAr: p.nameAr, specialty: p.specialty } : null,
            clinic: raw.clinic ? { nameEn: raw.clinic.nameEn, nameAr: raw.clinic.nameAr, addressEn: raw.clinic.addressEn, addressAr: raw.clinic.addressAr, phone: raw.clinic.phone, latitude: raw.clinic.latitude, longitude: raw.clinic.longitude } : null,
            cancellationPolicy: raw.provider?.cancellationPolicy ?? null,
            timeline, createdAt: b.createdAt,
            serviceLocation: b.serviceLocation, careType: b.careType, visitDistrict: b.visitDistrict, feeMinor: b.feeMinor,
            home: b.serviceLocation === 'HOME' ? await this.presentHome(b, p) : null,
            telehealth: (0, telehealth_1.presentTelehealth)(b.telehealth ?? null, b),
        };
    }
    async homeProgress(b, p) {
        p = p === undefined ? await this.provider(b) : p;
        const evs = await this.prisma.bookingEvent.findMany({ where: { bookingId: b.id, kind: 'STATE' }, orderBy: { createdAt: 'asc' } });
        const at = (to) => evs.find((e) => e.toStatus === to)?.createdAt ?? null;
        const done = b.status === 'COMPLETED';
        const arrived = b.homeState === 'ARRIVED' || b.status === 'CHECKED_IN' || done;
        const trackingOn = await this.flags.isEnabled('kiorex.visit_tracking', { market: p?.market ?? 'EG' });
        const aborted = b.homeState === 'ABORTED_UNSAFE';
        const confirmed = ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'].includes(b.status) || evs.some((e) => e.toStatus === 'CONFIRMED');
        const a = b.assignee ?? null;
        return {
            subState: b.homeState, trackingEnabled: trackingOn,
            steps: [
                { key: 'CONFIRMED', reached: confirmed, at: at('CONFIRMED') },
                { key: 'ON_THE_WAY', reached: !aborted && (!!b.enRouteAt || arrived), at: b.enRouteAt },
                { key: 'ARRIVED', reached: !aborted && arrived, at: b.arrivedAt ?? at('CHECKED_IN') },
                { key: 'FINISHED', reached: !aborted && done, at: done ? b.terminalAt : null },
            ],
            eta: b.homeState === 'EN_ROUTE' && b.etaMinutes != null && trackingOn ? { minutes: b.etaMinutes, shared: true } : { minutes: null, shared: false },
            assignee: a ? { displayName: a.displayName ?? null, photoUrl: a.photoUrl ?? null, badge: a.badge ?? null, profession: a.profession ?? null } : null,
            assignmentPending: !!p?.assignsClinician && !a && !(0, booking_state_1.isTerminal)(b.status),
            aborted: aborted,
        };
    }
    async presentHome(b, p) {
        const prog = await this.homeProgress(b, p);
        const addr = await this.addresses.forBooking(b.id);
        return {
            district: b.visitDistrict, subState: prog.subState, steps: prog.steps, trackingEnabled: prog.trackingEnabled, eta: prog.eta, assignee: prog.assignee, assignmentPending: prog.assignmentPending,
            fee: { visitFeeMinor: b.feeMinor, homeSurchargeMinor: b.homeSurchargeMinor, totalMinor: (b.feeMinor ?? 0) + b.homeSurchargeMinor, currency: b.currency, depositRequired: b.depositAmountMinor > 0 },
            aborted: prog.aborted ? { abortedAt: b.abortedAt, noShow: false, depositUnderReview: b.depositStatus === 'HOLD_FOR_REVIEW' } : null,
            address: addr ?? { district: b.visitDistrict, governorate: null, masked: true, maskedAt: null, address: null },
            safety: { reportProblemSlaMinutes: Math.round((0, config_1.cfg)().homeComplaintSlaMinutes), emergencyNumber: '123' },
        };
    }
    async createIntent(sub, i, g = {}) {
        const p = await this.prisma.provider.findUnique({ where: { id: i.providerId } });
        if (!p)
            throw (0, errors_1.notFound)('PROVIDER_NOT_FOUND', 'Provider not found');
        await this.markets.assertLive(p.market);
        await this.flags.assertEnabled('kiorex.marketplace', { market: p.market });
        if (p.tenantId && (await this.flags.evaluate('clinic.kiorex_listing', { market: p.market, orgId: p.tenantId })).reason === 'OFF_ORG')
            throw (0, errors_1.forbidden)('FEATURE_DISABLED', 'Listing paused', { key: 'clinic.kiorex_listing', scope: 'ORG' });
        if (p.status !== 'LIVE')
            throw (0, errors_1.conflict)('LISTING_NOT_LIVE', 'Unverified or paused listings are not bookable');
        const cat = await this.catalog.careTypeEnabled(p.careType, p.market);
        if (!cat.enabled && cat.key)
            await this.flags.assertEnabled(cat.key, { market: p.market });
        const fee = (p.raw?.provider?.fees ?? []).find((x) => x.appointmentTypeId === i.typeId);
        const location = (fee ? this.catalog.feeLocation(p, fee) : i.serviceLocation ?? 'IN_CLINIC');
        if (i.serviceLocation && i.serviceLocation !== location)
            throw (0, errors_1.badRequest)('SERVICE_LOCATION_MISMATCH', `This visit type is ${location}`, { serviceLocation: location });
        const home = location === 'HOME';
        let visit;
        let addressRow;
        if (home) {
            await this.flags.assertEnabled('kiorex.home_visits', { market: p.market });
            if (!this.catalog.isHomeEnabled(p))
                throw (0, errors_1.conflict)('HOME_NOT_OFFERED', 'This provider does not offer home visits');
            if (!i.addressId)
                throw (0, errors_1.badRequest)('ADDRESS_REQUIRED', 'Home visits need an address from your address book (addressId)');
            const r = await this.addresses.resolveForBooking(sub, i.addressId);
            visit = r.visit;
            addressRow = r.row;
            if (!this.catalog.coversDistrict(p, r.row.district))
                throw await this.catalog.outOfCoverage(p, r.row.district);
        }
        if (i.dependantId)
            await this.patients.assertGuardian(sub, i.dependantId);
        if (this.kiorly.isCircuitOpen(p.clinicId))
            throw (0, errors_1.unavailable)('CLINIC_SYSTEM_BUSY', 'Clinic system busy; new holds are paused for this clinic', { retryable: true });
        const start = new Date(i.startsAt);
        if (Number.isNaN(start.getTime()) || start <= new Date())
            throw (0, errors_1.badRequest)('INVALID_START', 'startsAt must be a future time');
        const dep = (await this.flags.isEnabled('kiorex.pay_deposits', { market: p.market })) ? this.catalog.depositFor(p, i.typeId, { home }) : { required: false, amountMinor: 0 };
        const id = (0, ids_1.newId)('kx_bk');
        const end = i.endsAt ? new Date(i.endsAt) : new Date(start.getTime() + 30 * 60_000);
        const surcharge = home && fee?.homeSurcharge ? Math.round(Number(fee.homeSurcharge) * 100) : 0;
        let b = await this.prisma.bookingIntent.create({
            data: { id, sub, dependantId: i.dependantId, providerId: p.id, clinicId: p.clinicId, clinicianId: p.clinicianId, tenantId: p.tenantId, typeId: i.typeId, startsAt: start, endsAt: end, status: 'INTENT', channel: i.channel ?? 'MARKETPLACE', currency: p.currency, feeMinor: this.catalog.feeFor(p, i.typeId), depositStatus: dep.required ? 'REQUIRED' : 'NONE', depositAmountMinor: dep.amountMinor, holdExternalRef: `${id}:hold`, patientSnapshot: i.bookingPageSlug || i.lt ? { ...(i.bookingPageSlug ? { bookingPageSlug: i.bookingPageSlug } : {}), ...(i.lt ? { growthLt: i.lt.slice(0, 600) } : {}) } : undefined,
                serviceLocation: location, careType: p.careType, visitDistrict: addressRow?.district, homeSurchargeMinor: surcharge, carePlanId: i.carePlanId },
        });
        if (home && addressRow)
            await this.addresses.snapshot(id, sub, addressRow);
        await this.ev(id, 'INTENT', { providerId: p.id, typeId: i.typeId, serviceLocation: location, ...(home ? { address: (0, district_1.addressForLog)({ district: addressRow?.district, governorate: addressRow?.governorate }) } : {}), ...(dep.policy ? { depositPolicy: dep.policy } : {}) });
        await this.growth.onIntent(b, p.market, { ...g, platform: i.channel === 'WHATSAPP' ? 'whatsapp' : g.platform });
        await this.catalog.track('hold_created', { providerId: p.id, specialtyCode: p.specialty ?? undefined, careType: p.careType, serviceLocation: location, district: addressRow?.district });
        try {
            const { data } = await this.kiorly.createHold({ clinicId: p.clinicId, clinicianId: p.clinicianId, typeId: i.typeId, startsAt: start.toISOString(), endsAt: end.toISOString(), externalRef: b.holdExternalRef, ...(visit ? { visitAddress: visit } : {}) });
            await this.ev(id, 'KIORLY_CALL', { call: 'POST /holds', holdId: data.id });
            const exp = data.expiresAt ? new Date(data.expiresAt) : new Date(Date.now() + (0, config_1.cfg)().holdMinutes * 60_000);
            b = (await this.move(b, 'HELD', { holdId: data.id, holdExpiresAt: exp }, { holdId: data.id })) ?? b;
            await this.growth.decide(id, { ...g, lt: i.lt });
        }
        catch (e) {
            if (e instanceof kiorly_public_1.KiorlyHttpError && e.status === 409) {
                await this.move(b, 'EXPIRED', { failureCode: 'SLOT_TAKEN' }, { alternatives: e.body?.alternatives });
                throw new errors_1.ApiError(409, 'SLOT_TAKEN', 'Slot taken', { bookingId: id, alternatives: e.body?.alternatives ?? e.body?.message?.alternatives ?? [] });
            }
            if (e instanceof kiorly_public_1.KiorlyHttpError && e.status === 422 && (e.code === 'OUT_OF_COVERAGE' || e.body?.code === 'OUT_OF_COVERAGE')) {
                await this.move(b, 'EXPIRED', { failureCode: 'OUT_OF_COVERAGE' }, { district: addressRow?.district });
                await this.catalog.track('home_out_of_coverage', { providerId: p.id, careType: p.careType, serviceLocation: 'HOME', district: addressRow?.district });
                throw await this.catalog.outOfCoverage(p, addressRow?.district, e.body?.alternatives);
            }
            if (e instanceof kiorly_public_1.KiorlyTransientError) {
                await this.move(b, 'EXPIRED', { failureCode: 'CLINIC_SYSTEM_BUSY' }, { error: e.kind });
                throw (0, errors_1.unavailable)('CLINIC_SYSTEM_BUSY', 'Clinic system busy, try again shortly', { retryable: true });
            }
            if (e instanceof kiorly_public_1.KiorlyHttpError) {
                await this.move(b, 'EXPIRED', { failureCode: e.code ?? `KIORLY_${e.status}` }, e.body);
                throw (0, errors_1.unprocessable)(e.code ?? 'HOLD_REJECTED', 'Clinic rejected the hold');
            }
            throw e;
        }
        return this.present(b);
    }
    async release(sub, id) {
        const b = await this.owned(sub, id);
        if (b.status !== 'HELD')
            return this.present(b);
        if (b.holdId)
            await this.kiorly.releaseHold(b.clinicId, b.holdId).catch(() => undefined);
        return this.present((await this.move(b, 'EXPIRED', { failureCode: 'RELEASED_BY_PATIENT' })) ?? b);
    }
    confirming = new Map();
    async withBookingLock(id, fn) {
        const prev = this.confirming.get(id) ?? Promise.resolve();
        const run = prev.catch(() => undefined).then(fn);
        const tail = run.catch(() => undefined);
        this.confirming.set(id, tail);
        try {
            return await run;
        }
        finally {
            if (this.confirming.get(id) === tail)
                this.confirming.delete(id);
        }
    }
    async confirm(sub, id, c, g = {}) {
        return this.withBookingLock(id, () => this.confirmLocked(sub, id, c, g));
    }
    async confirmLocked(sub, id, c, g = {}) {
        let b = await this.owned(sub, id);
        await this.flags.assertEnabled('kiorex.marketplace', { market: 'EG' });
        if (['PENDING_CLINIC', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED'].includes(b.status))
            return this.present(b);
        if (b.status !== 'HELD')
            throw (0, errors_1.conflict)('BOOKING_NOT_CONFIRMABLE', `Booking is ${b.status}`, { status: b.status, failureCode: b.failureCode });
        if (!c.marketplaceConsent)
            throw (0, errors_1.badRequest)('CONSENT_REQUIRED', 'Marketplace processing consent is required to book');
        if (b.callState === 'NONE' && b.holdExpiresAt && b.holdExpiresAt < new Date()) {
            await this.move(b, 'EXPIRED', { failureCode: 'HOLD_EXPIRED' });
            throw new errors_1.ApiError(422, 'HOLD_EXPIRED', 'Hold expired', { bookingId: id, alternatives: await this.alternatives(b) });
        }
        await this.patients.setConsent(sub, 'MARKETPLACE_PROCESSING', true, 'booking');
        if (c.remindersConsent !== undefined)
            await this.patients.setConsent(sub, 'REMINDERS', c.remindersConsent, 'booking');
        if (b.callState === 'UNCERTAIN') {
            const found = await this.lookup(b);
            if (found === 'ADOPTED')
                return this.present(await this.prisma.bookingIntent.findUniqueOrThrow({ where: { id } }));
            if (found === 'UNAVAILABLE')
                throw (0, errors_1.unavailable)('CLINIC_SYSTEM_BUSY', 'Clinic system busy; your booking is pending and will be retried', { bookingId: id, status: 'HELD', retryable: true });
        }
        const identity = await this.patients.bookingIdentity(sub, b.dependantId ?? undefined);
        await this.prisma.bookingIntent.update({ where: { id }, data: { callState: 'IN_FLIGHT', patientSnapshot: { ...(b.patientSnapshot ?? {}), forDependant: identity.forDependant } } });
        const gx = await this.growth.forConfirm(id, { ...g, lt: b.patientSnapshot?.growthLt ?? g.lt });
        const body = {
            clinicId: b.clinicId, clinicianId: b.clinicianId, typeId: b.typeId, startsAt: b.startsAt.toISOString(), endsAt: b.endsAt.toISOString(), holdId: b.holdId ?? undefined, holdExternalRef: b.holdExternalRef ?? undefined,
            patient: { phone: identity.phone, firstNameEn: identity.firstNameEn, lastNameEn: identity.lastNameEn, gender: identity.gender, nationalId: identity.nationalId, email: identity.email },
            notes: c.notes, marketplaceConsentGranted: true, remindersConsentGranted: !!c.remindersConsent, attribution: { source: b.channel === 'WHATSAPP' ? 'kiorex_whatsapp' : 'kiorex' },
            ...(gx.acquisition ? { acquisition: gx.acquisition } : {}), ...(gx.lt ? { lt: gx.lt } : {}),
            ...(b.serviceLocation === 'HOME' ? { serviceLocation: 'HOME' } : {}),
            channel: b.channel === 'CLINIC_LINK' ? 'CLINIC_LINK' : b.channel === 'WHATSAPP' && (0, config_1.cfg)().kiorlyAcceptsWhatsappChannel ? 'KIOREX_WHATSAPP' : 'MARKETPLACE', ...(b.channel === 'CLINIC_LINK' ? { bookingPageSlug: b.patientSnapshot?.bookingPageSlug } : {}),
        };
        const sd = await this.sponsored?.reserveForConfirm(b).catch(() => null);
        try {
            const { data } = await this.kiorly.createBooking(b.id, sd ? { ...body, sponsoredDiscount: sd } : body);
            await this.ev(id, 'KIORLY_CALL', { call: 'POST /bookings', status: data.status });
            if (sd)
                await this.sponsored?.onClinicAnswer(id, data?.sponsoredDiscount).catch(() => undefined);
            await this.adopt(id, data, { evidence: identity.nationalId ? 'PHONE_AND_NATIONAL_ID' : 'PHONE' });
        }
        catch (e) {
            const cur = await this.prisma.bookingIntent.findUniqueOrThrow({ where: { id } });
            if (['PENDING_CLINIC', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED'].includes(cur.status))
                return this.present(cur);
            if (sd)
                await this.sponsored?.releaseForBooking(id, 'BOOKING_CALL_FAILED').catch(() => undefined);
            await this.handleConfirmError(b, e);
        }
        return this.present(await this.prisma.bookingIntent.findUniqueOrThrow({ where: { id } }));
    }
    async handleConfirmError(b, e) {
        if (e instanceof kiorly_public_1.KiorlyHttpError) {
            await this.prisma.bookingIntent.update({ where: { id: b.id }, data: { callState: 'NONE' } });
            const cur = await this.prisma.bookingIntent.findUniqueOrThrow({ where: { id: b.id } });
            if (e.status === 409 && (e.code === 'SLOT_TAKEN' || e.body?.code === 'SLOT_TAKEN')) {
                await this.move(cur, 'EXPIRED', { failureCode: 'SLOT_TAKEN' }, { alternatives: e.body?.alternatives });
                await this.catalog.track('booking_failed', { code: 'SLOT_TAKEN' });
                throw new errors_1.ApiError(409, 'SLOT_TAKEN', 'Slot taken', { bookingId: b.id, alternatives: e.body?.alternatives ?? [] });
            }
            if (e.status === 422 && (e.code === 'OUT_OF_COVERAGE' || e.body?.code === 'OUT_OF_COVERAGE')) {
                if (cur.holdId)
                    await this.kiorly.releaseHold(cur.clinicId, cur.holdId).catch(() => undefined);
                await this.move(cur, 'EXPIRED', { failureCode: 'OUT_OF_COVERAGE' }, { district: cur.visitDistrict });
                await this.catalog.track('home_out_of_coverage', { providerId: cur.providerId, careType: cur.careType, serviceLocation: 'HOME', district: cur.visitDistrict });
                const p = await this.provider(cur);
                throw p ? await this.catalog.outOfCoverage(p, cur.visitDistrict, e.body?.alternatives) : new errors_1.ApiError(422, 'OUT_OF_COVERAGE', 'Out of coverage');
            }
            if (e.status === 409 && e.code === 'PATIENT_IDENTITY_CONFLICT') {
                await this.patients.recordIdentityConflict(b.sub, b.clinicId, 'PATIENT_IDENTITY_CONFLICT');
                await this.move(cur, 'EXPIRED', { failureCode: 'PATIENT_IDENTITY_CONFLICT' });
                throw (0, errors_1.conflict)('PATIENT_IDENTITY_CONFLICT', 'Your details match more than one clinic record; support will review (no automatic merge)');
            }
            await this.move(cur, 'EXPIRED', { failureCode: e.code ?? `KIORLY_${e.status}` }, e.body);
            await this.catalog.track('booking_failed', { code: e.code ?? String(e.status) });
            throw new errors_1.ApiError(422, e.code ?? 'BOOKING_REJECTED', 'Clinic could not accept the booking', { bookingId: b.id, alternatives: await this.alternatives(cur) });
        }
        await this.prisma.bookingIntent.update({ where: { id: b.id }, data: { callState: 'UNCERTAIN' } });
        await this.ev(b.id, 'KIORLY_CALL', { call: 'POST /bookings', outcome: 'UNKNOWN', error: e.message });
        const found = await this.lookup(b);
        if (found === 'ADOPTED')
            return undefined;
        throw (0, errors_1.unavailable)('CLINIC_SYSTEM_BUSY', 'Clinic system busy; your booking is pending and will be confirmed shortly', { bookingId: b.id, status: 'HELD', retryable: true });
    }
    async lookup(b) {
        try {
            const { data } = await this.kiorly.getBooking(b.id, b.clinicId);
            await this.ev(b.id, 'KIORLY_CALL', { call: 'GET /bookings/:ref', status: data.status });
            await this.adopt(b.id, data, { evidence: 'PHONE' });
            return 'ADOPTED';
        }
        catch (e) {
            if (e instanceof kiorly_public_1.KiorlyHttpError && e.status === 404)
                return 'NOT_CREATED';
            return 'UNAVAILABLE';
        }
    }
    async adopt(id, data, o) {
        const b = await this.prisma.bookingIntent.findUniqueOrThrow({ where: { id } });
        const target = (0, booking_state_1.fromKiorlyStatus)(data.status) ?? 'CONFIRMED';
        if (data.patientId)
            await this.patients.linkKiorlyPatient({ sub: b.sub, dependantId: b.dependantId ?? undefined, clinicId: b.clinicId, kiorlyPatientId: data.patientId, evidence: o.evidence });
        const patch = { kiorlyAppointmentId: data.appointmentId ?? b.kiorlyAppointmentId, kiorlyPatientId: data.patientId ?? b.kiorlyPatientId, confirmationDueAt: data.marketplaceConfirmationDueAt ? new Date(data.marketplaceConfirmationDueAt) : null, callState: 'NONE', failureCode: null, ...this.teleFromBookingData(b, data) };
        if (b.status === 'HELD' || b.status === 'INTENT') {
            const moved = await this.move(b, target === 'CONFIRMED' || target === 'PENDING_CLINIC' ? target : 'CONFIRMED', patch);
            if (moved)
                await this.sideEffects(moved, moved.status === 'CONFIRMED' ? 'APPOINTMENT_CONFIRMED' : 'PENDING', {});
            if (moved)
                await this.catalog.track('booking_confirmed', { providerId: moved.providerId });
            if (moved && target !== 'CONFIRMED' && target !== 'PENDING_CLINIC')
                await this.applyStatus(moved, target, 'RECONCILE', {});
        }
        else {
            await this.prisma.bookingIntent.update({ where: { id }, data: patch });
            await this.applyStatus(b, target, 'RECONCILE', {});
        }
    }
    async alternatives(b) {
        try {
            const p = await this.provider(b);
            if (!p)
                return [];
            const from = new Date();
            this.catalog.invalidateSlots(p.clinicianId);
            const home = b.serviceLocation === 'HOME';
            return (await this.catalog.slots(p, b.typeId, from, new Date(from.getTime() + 7 * 86400_000), home ? { serviceLocation: 'HOME', district: b.visitDistrict ?? undefined } : {})).slice(0, 3);
        }
        catch {
            return [];
        }
    }
    async cancel(sub, id, reason, refundDestination) {
        const b = await this.owned(sub, id);
        if (b.status === 'HELD')
            return this.release(sub, id);
        if (!['PENDING_CLINIC', 'CONFIRMED'].includes(b.status))
            throw (0, errors_1.unprocessable)('BOOKING_NOT_CHANGEABLE', `Booking is ${b.status}`);
        if (refundDestination === 'CREDIT') {
            if (!this.rewards || !(await this.rewards.refundCreditAvailable()))
                throw (0, errors_1.unprocessable)('REFUND_CREDIT_NOT_AVAILABLE', 'Keeping a refund as credit is not available');
            await this.ev(id, 'REFUND_CHOICE', { destination: 'CREDIT', source: 'PATIENT_CANCEL' });
        }
        try {
            const { data } = await this.kiorly.cancelBooking(b.id, reason, b.clinicId);
            await this.ev(id, 'KIORLY_CALL', { call: 'POST /cancel', depositRefundable: data?.depositRefundable });
            await this.applyEvent({ type: 'CANCELLED_BY_PATIENT', data: { externalReference: id, cancelledBy: 'PATIENT', cancellationReason: reason, depositRefundable: data?.depositRefundable } });
        }
        catch (e) {
            if (e instanceof kiorly_public_1.KiorlyHttpError)
                throw new errors_1.ApiError(e.status === 404 ? 404 : 422, e.code ?? e.body?.message?.code ?? (e.status === 404 ? 'BOOKING_NOT_FOUND' : 'CANCELLATION_REJECTED'), e.body?.message?.message ?? 'Cancellation rejected', { code: e.code });
            throw (0, errors_1.unavailable)('CLINIC_SYSTEM_BUSY', 'Clinic system busy', { retryable: true });
        }
        return this.present(await this.prisma.bookingIntent.findUniqueOrThrow({ where: { id } }));
    }
    async reschedule(sub, id, i) {
        const b = await this.owned(sub, id);
        if (b.status !== 'CONFIRMED')
            throw (0, errors_1.unprocessable)('BOOKING_NOT_CHANGEABLE', `Booking is ${b.status}`);
        try {
            const { data } = await this.kiorly.rescheduleBooking(b.id, i, b.clinicId);
            await this.ev(id, 'KIORLY_CALL', { call: 'POST /reschedule' });
            await this.applyEvent({ type: 'RESCHEDULED', data: { externalReference: id, startsAt: data?.startsAt ?? i.startsAt, endsAt: data?.endsAt ?? i.endsAt } });
        }
        catch (e) {
            if (e instanceof kiorly_public_1.KiorlyHttpError) {
                if (e.status === 409)
                    throw new errors_1.ApiError(409, 'SLOT_TAKEN', 'Slot taken', { alternatives: e.body?.alternatives ?? [] });
                throw new errors_1.ApiError(422, e.code ?? e.body?.message?.code ?? 'RESCHEDULE_REJECTED', 'Reschedule rejected');
            }
            throw (0, errors_1.unavailable)('CLINIC_SYSTEM_BUSY', 'Clinic system busy', { retryable: true });
        }
        return this.present(await this.prisma.bookingIntent.findUniqueOrThrow({ where: { id } }));
    }
    async depositCheckout(sub, id, o = {}) {
        const b = await this.owned(sub, id);
        if (b.depositStatus !== 'REQUIRED')
            throw (0, errors_1.conflict)('NO_DEPOSIT_DUE', 'No deposit is due for this booking');
        if (!['PENDING_CLINIC', 'CONFIRMED'].includes(b.status))
            throw (0, errors_1.conflict)('BOOKING_NOT_PAYABLE', `Booking is ${b.status}`);
        await this.flags.assertEnabled('kiorex.pay_deposits', { market: 'EG' });
        const prov = await this.provider(b);
        const r = await this.pay.createDepositIntentWithRewards({ bookingId: b.id, sub, clinicId: b.clinicId, amountMinor: b.depositAmountMinor, currency: b.currency, serviceKind: b.serviceLocation === 'HOME' ? 'HOME_VISIT' : b.telehealth ? 'VIDEO' : 'IN_CLINIC', specialty: prov?.specialty ?? null, dependantId: b.dependantId, couponCode: o.couponCode, lotId: o.lotId });
        const p = r.intent;
        await this.ev(id, 'PAYMENT', { paymentId: p.id, ...(r.rewardMinor ? { rewardMinor: r.rewardMinor } : {}), ...(r.sponsoredMinor ? { sponsoredDiscountMinor: r.sponsoredMinor } : {}) });
        return { paymentId: p.id, checkoutUrl: p.checkoutUrl, amountMinor: p.amountMinor, currency: p.currency, ...(r.rewardMinor ? { rewardMinor: r.rewardMinor } : {}), ...(r.sponsoredMinor ? { sponsoredDiscountMinor: r.sponsoredMinor } : {}), ...(r.rewardMinor || r.sponsoredMinor ? { lines: r.lines } : {}), ...(r.couponProblem ? { couponProblem: r.couponProblem } : {}) };
    }
    async list(sub, status) {
        const rows = await this.prisma.bookingIntent.findMany({ where: { sub, ...(status ? { status } : {}), NOT: { status: 'INTENT' } }, orderBy: { startsAt: 'desc' }, take: 100 });
        return Promise.all(rows.map((b) => this.present(b)));
    }
    async get(sub, id) { return this.present(await this.owned(sub, id)); }
    async telehealthVisits(sub) {
        const rows = await this.prisma.bookingIntent.findMany({ where: { sub, telehealth: { not: client_1.Prisma.DbNull } }, orderBy: { startsAt: 'desc' }, take: 50 });
        return Promise.all(rows.map(async (b) => { const p = await this.provider(b); return { bookingId: b.id, status: b.status, startsAt: b.startsAt, endsAt: b.endsAt, doctor: p ? { nameEn: p.nameEn, nameAr: p.nameAr, specialty: p.specialty } : null, telehealth: (0, telehealth_1.presentTelehealth)(b.telehealth ?? null, b) }; }));
    }
    async ics(sub, id) {
        const b = await this.owned(sub, id);
        const p = await this.provider(b);
        const f = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
        return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kiorex//Booking//EN', 'BEGIN:VEVENT', `UID:${b.id}@kiorex.com`, `DTSTAMP:${f(new Date())}`, `DTSTART:${f(b.startsAt)}`, `DTEND:${f(b.endsAt)}`, `SUMMARY:Kiorex visit ${p?.nameEn ?? ''}`.trim(), 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    }
    async applyEvent(ev) {
        const ref = ev.data.externalReference ?? ev.data.metadata?.externalReference;
        let b = ref ? await this.prisma.bookingIntent.findUnique({ where: { id: ref } }) : null;
        const apptId = ev.data.appointmentId ?? (ev.type !== 'SLOTS_CHANGED' ? ev.aggregateId : undefined);
        if (!b && apptId)
            b = await this.prisma.bookingIntent.findFirst({ where: { kiorlyAppointmentId: apptId } });
        if (!b)
            return 'UNKNOWN_BOOKING';
        const meta = { ...(ev.data.metadata ?? {}), ...ev.data };
        if ((0, booking_state_1.isHomeEvent)(ev.type))
            return this.applyHomeEvent(b, ev.type, meta);
        const beforeTele = b;
        b = await this.applyTelehealthPayload(b, meta);
        const teleApplied = b !== beforeTele;
        if (ev.type === 'RESCHEDULED' || ev.type === 'APPOINTMENT_RESCHEDULED') {
            if (b.status !== 'CONFIRMED' && b.status !== 'PENDING_CLINIC')
                return 'IGNORED';
            const startsAt = meta.startsAt ? new Date(meta.startsAt) : b.startsAt;
            const endsAt = meta.endsAt ? new Date(meta.endsAt) : new Date(startsAt.getTime() + (b.endsAt.getTime() - b.startsAt.getTime()));
            const tb = b.telehealth ?? null;
            const moved = tb && tb.state !== 'IN_PERSON' && startsAt.getTime() !== b.startsAt.getTime() ? { telehealth: { ...tb, movedFrom: tb.movedFrom ?? b.startsAt.toISOString() } } : {};
            const upd = await this.prisma.bookingIntent.update({ where: { id: b.id }, data: { startsAt, endsAt, ...moved, version: { increment: 1 } } });
            await this.ev(b.id, 'WEBHOOK', { type: ev.type, startsAt, endsAt });
            await this.sideEffects(upd, 'RESCHEDULED', {});
            return 'APPLIED';
        }
        const to = (0, booking_state_1.nextStatus)(b.status, ev.type);
        if (!to) {
            await this.ev(b.id, 'WEBHOOK', { type: ev.type, ignored: !teleApplied });
            return teleApplied ? 'APPLIED' : 'IGNORED';
        }
        await this.applyStatus(b, to, ev.type, meta);
        return 'APPLIED';
    }
    teleFromBookingData(b, data) {
        if (!data || typeof data !== 'object' || !('telehealth' in data))
            return {};
        const prev = b.telehealth ?? null;
        if (data.telehealth === null)
            return prev ? { telehealth: { ...prev, joinUrl: null, state: 'IN_PERSON' } } : {};
        const nb = (0, telehealth_1.parseTelehealth)(data.telehealth, prev);
        return nb ? { telehealth: { ...nb, state: prev && prev.state !== 'IN_PERSON' ? prev.state : 'SCHEDULED' } } : {};
    }
    async applyTelehealthPayload(b, meta) {
        let patch = this.teleFromBookingData(b, meta);
        const prev = b.telehealth ?? null;
        if (!patch.telehealth && prev && prev.state !== 'IN_PERSON' && typeof meta.serviceLocation === 'string' && !['VIDEO', 'TELEHEALTH'].includes(meta.serviceLocation.toUpperCase()))
            patch = { telehealth: { ...prev, joinUrl: null, state: 'IN_PERSON' } };
        if (!patch.telehealth)
            return b;
        await this.ev(b.id, 'TELEHEALTH', { state: patch.telehealth.state, sessionId: patch.telehealth.sessionId });
        return this.prisma.bookingIntent.update({ where: { id: b.id }, data: { telehealth: patch.telehealth } });
    }
    async applyTelehealthEvent(ev) {
        const kind = telehealth_1.TELE_EVENT_STATE[ev.type.toLowerCase()];
        if (!kind || !(0, telehealth_1.isTelehealthEvent)(ev.type))
            return 'IGNORED';
        const d = ev.data ?? {};
        const sessionId = d.telehealth?.sessionId ?? d.sessionId ?? ev.aggregateId;
        const ref = d.externalReference ?? d.metadata?.externalReference;
        let b = ref ? await this.prisma.bookingIntent.findUnique({ where: { id: ref } }) : null;
        if (!b && d.appointmentId)
            b = await this.prisma.bookingIntent.findFirst({ where: { kiorlyAppointmentId: d.appointmentId } });
        if (!b && sessionId)
            b = await this.prisma.bookingIntent.findFirst({ where: { telehealth: { path: ['sessionId'], equals: sessionId } } });
        if (!b)
            return 'UNKNOWN_BOOKING';
        const prev = b.telehealth ?? null;
        const src = d.telehealth && typeof d.telehealth === 'object' ? { ...d, ...d.telehealth } : d;
        let next = null;
        if (kind === 'SCHEDULED' || kind === 'WINDOW' || kind === 'LINK') {
            const pb = (0, telehealth_1.parseTelehealth)(src, prev);
            if (!pb)
                return 'IGNORED';
            if (prev && prev.state !== 'SCHEDULED' && prev.state !== 'IN_PERSON' && kind !== 'SCHEDULED')
                return 'IGNORED';
            const moved = kind === 'WINDOW' && d.startsAt && new Date(d.startsAt).getTime() !== b.startsAt.getTime() ? (prev?.movedFrom ?? b.startsAt.toISOString()) : prev?.movedFrom ?? null;
            next = { ...pb, state: kind === 'SCHEDULED' && (!prev || prev.state === 'IN_PERSON') ? 'SCHEDULED' : prev?.state ?? 'SCHEDULED', movedFrom: moved };
            if (kind === 'LINK')
                next.joinUrl = (0, telehealth_1.safeJoinUrl)(src.joinUrl ?? src.patientJoinUrl) ?? prev?.joinUrl ?? null;
        }
        else {
            if (!prev)
                return 'IGNORED';
            const from = prev.state;
            const ok = { SCHEDULED: ['LIVE', 'ENDED', 'MISSED', 'CANCELLED', 'IN_PERSON'], LIVE: ['ENDED', 'CANCELLED', 'IN_PERSON'], ENDED: [], MISSED: ['IN_PERSON'], CANCELLED: [], IN_PERSON: [] };
            if (!ok[from].includes(kind)) {
                await this.ev(b.id, 'TELEHEALTH', { type: ev.type, ignored: true, from });
                return 'IGNORED';
            }
            next = { ...prev, state: kind, joinUrl: kind === 'LIVE' ? prev.joinUrl : null };
        }
        await this.prisma.bookingIntent.update({ where: { id: b.id }, data: { telehealth: next, version: { increment: 1 } } });
        await this.ev(b.id, 'TELEHEALTH', { type: ev.type, state: next.state, sessionId: next.sessionId });
        return 'APPLIED';
    }
    async applyHomeEvent(b, type, meta) {
        if (b.serviceLocation !== 'HOME') {
            await this.ev(b.id, 'WEBHOOK', { type, ignored: true, reason: 'NOT_A_HOME_BOOKING' });
            return 'IGNORED';
        }
        const state = (0, booking_state_1.nextHomeState)(b.homeState, b.status, type);
        if (!state) {
            await this.ev(b.id, 'WEBHOOK', { type, ignored: true, reason: 'STALE_OR_TERMINAL' });
            return 'IGNORED';
        }
        if (state === 'ABORTED_UNSAFE') {
            await this.applyStatus(b, 'CANCELLED', type, meta);
            return 'APPLIED';
        }
        const p = await this.provider(b);
        if (state === 'EN_ROUTE' && !(await this.flags.isEnabled('kiorex.visit_tracking', { market: p?.market ?? 'EG' }))) {
            await this.ev(b.id, 'HOME', { state, suppressed: 'kiorex.visit_tracking OFF' });
            return 'IGNORED';
        }
        let upd;
        if (state === 'ASSIGNED') {
            const a = meta.assignee ?? {};
            const assignee = { displayName: a.displayName ?? null, photoUrl: a.photoUrl ?? null, badge: a.badge ?? null, profession: a.profession ?? null, clinicianId: a.clinicianId ?? null };
            upd = await this.prisma.bookingIntent.update({ where: { id: b.id }, data: { assignee: assignee, homeState: 'ASSIGNED', version: { increment: 1 } } });
        }
        else {
            upd = await this.prisma.bookingIntent.update({ where: { id: b.id }, data: { homeState: 'EN_ROUTE', enRouteAt: meta.enRouteAt ? new Date(meta.enRouteAt) : new Date(), etaMinutes: typeof meta.etaMinutes === 'number' ? Math.max(0, Math.round(meta.etaMinutes)) : null, version: { increment: 1 } } });
        }
        await this.ev(b.id, 'HOME', { state });
        const kind = state === 'ASSIGNED' ? 'HOME_VISIT_ASSIGNED' : 'HOME_VISIT_EN_ROUTE';
        try {
            await this.engagement.notify(b.sub, { kind, bookingId: b.id, params: { ...this.doctorParams(p, upd), assignee: upd.assignee?.displayName ?? '', minutes: upd.etaMinutes ?? '' }, dedupeKey: `${kind.toLowerCase()}:${b.id}` });
        }
        catch (e) {
            this.log.warn(`home notification ${kind} for ${b.id} failed: ${e.message}`);
        }
        await this.emitHome(upd, state);
        return 'APPLIED';
    }
    async applyStatus(b, to, via, meta) {
        let cur = await this.prisma.bookingIntent.findUniqueOrThrow({ where: { id: b.id } });
        if (cur.status === to)
            return;
        const eventType = via === 'RECONCILE' ? { CONFIRMED: 'APPOINTMENT_CONFIRMED', CANCELLED: 'CANCELLED_BY_CLINIC', CHECKED_IN: 'CHECKED_IN', COMPLETED: 'COMPLETED', NO_SHOW: 'NO_SHOW', EXPIRED: 'MARKETPLACE_BOOKING_CONFIRM_TIMEOUT' }[to] ?? via : via;
        if (via === 'RECONCILE') {
            const n = (0, booking_state_1.nextStatus)(cur.status, eventType);
            if (!n)
                return;
            to = n;
        }
        const patch = {};
        if (to === 'CANCELLED') {
            patch.cancelledBy = meta.cancelledBy ?? (eventType === 'CANCELLED_BY_PATIENT' ? 'PATIENT' : 'CLINIC');
            patch.cancellationReason = meta.cancellationReason ?? null;
            patch.depositRefundable = typeof meta.depositRefundable === 'boolean' ? meta.depositRefundable : null;
        }
        if (eventType === 'HOME_VISIT_ABORTED_UNSAFE') {
            Object.assign(patch, { cancelledBy: 'SAFETY', cancellationReason: 'UNSAFE_ABORT', depositRefundable: null, homeState: 'ABORTED_UNSAFE', abortedAt: meta.abortedAt ? new Date(meta.abortedAt) : new Date() });
        }
        const moved = await this.move(cur, to, patch, { via: eventType, ...(typeof meta.isNewPatientAtBooking === 'boolean' ? { newPatient: meta.isNewPatientAtBooking } : {}) });
        if (!moved)
            return;
        await this.sideEffects(moved, eventType, meta);
    }
    async sideEffects(b, type, meta) {
        const p = await this.provider(b);
        const params = this.doctorParams(p, b);
        const notify = (kind, key, extra = {}) => this.engagement.notify(b.sub, { kind, bookingId: b.id, params: { ...params, ...extra }, dedupeKey: `${key}:${b.id}` });
        try {
            switch (type) {
                case 'PENDING':
                    await notify('BOOKING_PENDING_CLINIC', 'pending');
                    break;
                case 'APPOINTMENT_CONFIRMED':
                    await notify('BOOKING_CONFIRMED', 'confirmed');
                    await this.engagement.scheduleBookingReminders({ id: b.id, sub: b.sub, startsAt: b.startsAt }, params);
                    break;
                case 'RESCHEDULED':
                    await this.engagement.cancelBookingMessages(b.id);
                    await this.engagement.notify(b.sub, { kind: 'BOOKING_CHANGED', bookingId: b.id, params, dedupeKey: `changed:${b.id}:${b.startsAt.getTime()}` });
                    await this.engagement.scheduleBookingReminders({ id: b.id, sub: b.sub, startsAt: b.startsAt }, params);
                    break;
                case 'CANCELLED_BY_CLINIC':
                case 'CANCELLED_BY_PATIENT': {
                    await this.engagement.cancelBookingMessages(b.id);
                    await this.settleDepositOnCancel(b, type, meta);
                    if (type === 'CANCELLED_BY_CLINIC') {
                        const alts = (await this.alternatives(b)).map((s) => s.startsAt).join(', ');
                        await notify('BOOKING_CANCELLED_BY_CLINIC', 'cancelled', { alternatives: alts });
                    }
                    else
                        await notify('BOOKING_CANCELLED', 'cancelled');
                    break;
                }
                case 'MARKETPLACE_BOOKING_CONFIRM_TIMEOUT':
                    await this.engagement.cancelBookingMessages(b.id);
                    await this.settleDepositOnCancel(b, 'CANCELLED_BY_CLINIC', {});
                    await notify('BOOKING_EXPIRED', 'expired');
                    break;
                case 'CHECKED_IN':
                    await this.catalog.track('visit_checked_in', this.analyticsDims(b));
                    if (b.serviceLocation === 'HOME') {
                        const upd = await this.prisma.bookingIntent.update({ where: { id: b.id }, data: { homeState: 'ARRIVED', arrivedAt: new Date() } });
                        await this.ev(b.id, 'HOME', { state: 'ARRIVED' });
                        await this.emitHome(upd, 'ARRIVED');
                    }
                    break;
                case 'COMPLETED': {
                    await this.catalog.track('visit_attended', this.analyticsDims(b));
                    if (b.depositStatus === 'PAID') {
                        await this.pay.releaseForBooking(b.id, 'COMPLETED');
                        await this.prisma.bookingIntent.update({ where: { id: b.id }, data: { depositStatus: 'RELEASED' } });
                    }
                    const skipInvite = !!b.carePlanId && (await this.prisma.bookingIntent.count({ where: { carePlanId: b.carePlanId, status: 'COMPLETED' } })) > 1;
                    if (!skipInvite)
                        await this.engagement.scheduleReviewInvite({ id: b.id, sub: b.sub }, params);
                    if (b.serviceLocation === 'HOME')
                        await this.emitHome(b, 'FINISHED');
                    break;
                }
                case 'HOME_VISIT_ABORTED_UNSAFE':
                    await this.engagement.cancelBookingMessages(b.id);
                    await this.holdDepositForReview(b);
                    await this.catalog.track('aborted_unsafe', this.analyticsDims(b));
                    await notify('HOME_VISIT_ABORTED', 'aborted-unsafe');
                    await this.emitHome(b, 'ABORTED_UNSAFE');
                    break;
                case 'NO_SHOW':
                    await this.catalog.track('no_show', this.analyticsDims(b));
                    await this.patients.incrementNoShow(b.sub);
                    if (b.depositStatus === 'PAID') {
                        await this.pay.releaseForBooking(b.id, 'FORFEITED');
                        await this.prisma.bookingIntent.update({ where: { id: b.id }, data: { depositStatus: 'FORFEITED' } });
                    }
                    break;
            }
        }
        catch (e) {
            this.log.error(`side effect ${type} for ${b.id} failed: ${e.message}`);
            await this.ev(b.id, 'WEBHOOK', { sideEffectError: e.message, type });
        }
    }
    analyticsDims(b) { return { providerId: b.providerId, careType: b.careType, serviceLocation: b.serviceLocation, district: b.visitDistrict }; }
    async holdDepositForReview(b) {
        if (b.depositStatus === 'NONE')
            return;
        const p = await this.pay.holdForReview(b.id, 'UNSAFE_ABORT');
        await this.prisma.bookingIntent.update({ where: { id: b.id }, data: { depositStatus: p?.reviewState === 'HELD_FOR_REVIEW' ? 'HOLD_FOR_REVIEW' : 'NONE' } });
        await this.ev(b.id, 'PAYMENT', { holdForReview: !!p });
    }
    async onReviewResolved(p) {
        if (!p.bookingId)
            return;
        const b = await this.prisma.bookingIntent.findUnique({ where: { id: p.bookingId } });
        if (!b)
            return;
        await this.prisma.bookingIntent.update({ where: { id: b.id }, data: { depositStatus: p.outcome === 'REFUNDED' ? 'REFUNDED' : 'RELEASED' } });
        await this.ev(b.id, 'PAYMENT', { reviewResolved: p.outcome });
        if (p.outcome === 'REFUNDED')
            await this.engagement.notify(b.sub, { kind: 'DEPOSIT_REFUNDED', bookingId: b.id, dedupeKey: `deposit-refunded-review:${b.id}` }).catch(() => undefined);
    }
    async settleDepositOnCancel(b, type, meta) {
        if (b.depositStatus === 'NONE')
            return;
        let refundable = type === 'CANCELLED_BY_CLINIC' ? true : meta.depositRefundable;
        if (refundable === undefined || refundable === null) {
            try {
                refundable = (await this.kiorly.getBooking(b.id, b.clinicId)).data?.depositRefundable;
            }
            catch { }
        }
        if (refundable === true) {
            const patientChoice = type === 'CANCELLED_BY_PATIENT' && this.rewards ? await this.parkedRefundChoice(b.id) : undefined;
            await this.pay.refundForBooking(b.id, type === 'CANCELLED_BY_CLINIC' ? 'CLINIC_CANCELLED' : 'PATIENT_CANCELLED_REFUNDABLE', type === 'CANCELLED_BY_PATIENT' && this.rewards ? { destination: patientChoice ?? 'ORIGINAL', source: 'PATIENT_CANCEL' } : {});
            await this.prisma.bookingIntent.update({ where: { id: b.id }, data: { depositStatus: b.depositStatus === 'REQUIRED' ? 'NONE' : 'REFUNDED', depositRefundable: true } });
        }
        else if (refundable === false) {
            await this.pay.releaseForBooking(b.id, 'FORFEITED');
            await this.prisma.bookingIntent.update({ where: { id: b.id }, data: { depositStatus: b.depositStatus === 'PAID' ? 'FORFEITED' : b.depositStatus, depositRefundable: false } });
        }
        else {
            await this.prisma.auditLog.create({ data: { actor: 'system', action: 'booking.refund_policy_review', resource: 'BookingIntent', resourceId: b.id, metadata: { note: 'NEEDS_HUMAN: depositRefundable absent; cancellation-policy fallback undefined' } } });
        }
    }
    async parkedRefundChoice(bookingId) {
        const e = await this.prisma.bookingEvent.findFirst({ where: { bookingId, kind: 'REFUND_CHOICE', createdAt: { gte: new Date(Date.now() - 86_400_000) } }, orderBy: { createdAt: 'desc' } });
        return e?.detail?.destination === 'CREDIT' ? 'CREDIT' : undefined;
    }
    async onDepositCaptured(p) {
        if (!p.bookingId)
            return;
        const b = await this.prisma.bookingIntent.findUnique({ where: { id: p.bookingId } });
        if (!b)
            return;
        if (b.depositStatus === 'HOLD_FOR_REVIEW')
            return;
        if (['CANCELLED', 'EXPIRED', 'INTENT'].includes(b.status)) {
            await this.pay.refundForBooking(b.id, 'CAPTURED_FOR_INACTIVE_BOOKING');
            await this.prisma.bookingIntent.update({ where: { id: b.id }, data: { depositStatus: 'REFUNDED' } });
            await this.prisma.auditLog.create({ data: { actor: 'system', action: 'booking.payment_without_booking', resource: 'BookingIntent', resourceId: b.id } });
        }
        else {
            await this.prisma.bookingIntent.update({ where: { id: b.id }, data: { depositStatus: b.depositStatus === 'FORFEITED' ? 'FORFEITED' : 'PAID' } });
            await this.ev(b.id, 'PAYMENT', { captured: true });
        }
    }
    async expireHolds() {
        const rows = await this.prisma.bookingIntent.findMany({ where: { status: 'HELD', callState: 'NONE', holdExpiresAt: { lt: new Date() } }, take: 200 });
        for (const b of rows)
            await this.move(b, 'EXPIRED', { failureCode: 'HOLD_EXPIRED' });
        return rows.length;
    }
    async reconcileNightly(now = new Date()) {
        const cutoff = new Date(now.getTime() - 24 * 3600_000);
        const rows = await this.prisma.bookingIntent.findMany({
            where: { OR: [{ status: { in: ['HELD', 'PENDING_CLINIC', 'CONFIRMED', 'CHECKED_IN'] }, updatedAt: { lt: cutoff } }, { callState: 'UNCERTAIN', updatedAt: { lt: new Date(now.getTime() - 5 * 60_000) } }] },
            take: 500,
        });
        let corrected = 0, missing = 0, errors = 0;
        const disc = [];
        for (const b of rows) {
            try {
                const { data } = await this.kiorly.getBooking(b.id, b.clinicId);
                const target = (0, booking_state_1.fromKiorlyStatus)(data.status);
                if (data.appointmentId && !b.kiorlyAppointmentId)
                    await this.prisma.bookingIntent.update({ where: { id: b.id }, data: { kiorlyAppointmentId: data.appointmentId, kiorlyPatientId: data.patientId ?? undefined, callState: 'NONE' } });
                const tp = this.teleFromBookingData(b, data);
                if (tp.telehealth)
                    await this.prisma.bookingIntent.update({ where: { id: b.id }, data: { telehealth: tp.telehealth } });
                if (target && target !== b.status) {
                    if (b.status === 'HELD')
                        await this.adopt(b.id, data, { evidence: 'PHONE' });
                    else
                        await this.applyStatus(b, target, 'RECONCILE', { cancelledBy: data.cancelledBy, cancellationReason: data.cancellationReason, depositRefundable: data.depositRefundable });
                    corrected++;
                    disc.push({ bookingId: b.id, ours: b.status, kiorly: data.status });
                }
                else
                    await this.prisma.bookingIntent.update({ where: { id: b.id }, data: { updatedAt: new Date() } });
            }
            catch (e) {
                if (e instanceof kiorly_public_1.KiorlyHttpError && e.status === 404) {
                    missing++;
                    if (b.status === 'HELD')
                        await this.move(b, 'EXPIRED', { failureCode: 'NEVER_CREATED', callState: 'NONE' });
                    else
                        disc.push({ bookingId: b.id, ours: b.status, kiorly: 'NOT_FOUND' });
                }
                else
                    errors++;
            }
        }
        const stuck = await this.prisma.bookingIntent.findMany({ where: { status: { in: ['CANCELLED', 'EXPIRED'] }, depositStatus: 'PAID' }, take: 200 });
        for (const b of stuck) {
            await this.pay.refundForBooking(b.id, 'DEAD_BOOKING_DEPOSIT');
            await this.prisma.bookingIntent.update({ where: { id: b.id }, data: { depositStatus: 'REFUNDED' } });
        }
        const run = await this.prisma.reconciliationRun.create({ data: { kind: 'BOOKING_NIGHTLY', status: disc.length || errors ? 'DISCREPANCIES' : 'OK', discrepancies: disc, stats: { checked: rows.length, corrected, missing, errors, refundedDead: stuck.length } } });
        return { checked: rows.length, corrected, missing, errors, runId: run.id };
    }
    async completedForReview(sub, id) {
        const b = await this.owned(sub, id);
        return { id: b.id, status: b.status, providerId: b.providerId, clinicId: b.clinicId, clinicianId: b.clinicianId, kiorlyAppointmentId: b.kiorlyAppointmentId, completedAt: b.terminalAt };
    }
    async byId(id) { return this.prisma.bookingIntent.findUnique({ where: { id } }); }
    async byAppointmentId(appointmentId) { return this.prisma.bookingIntent.findFirst({ where: { kiorlyAppointmentId: appointmentId } }); }
    async ownedBooking(sub, id) { return this.owned(sub, id); }
    async providerOf(b) { return this.provider(b); }
    async createConfirmedVisit(i) {
        const dup = await this.prisma.bookingIntent.findFirst({ where: { kiorlyAppointmentId: i.appointmentId } });
        if (dup)
            return dup;
        const p = await this.prisma.provider.findUniqueOrThrow({ where: { id: i.providerId } });
        const fee = (p.raw?.provider?.fees ?? []).find((x) => x.appointmentTypeId === i.typeId);
        const id = (0, ids_1.newId)('kx_bk');
        const b = await this.prisma.bookingIntent.create({ data: { id, sub: i.sub, providerId: p.id, clinicId: p.clinicId, clinicianId: p.clinicianId, tenantId: p.tenantId, typeId: i.typeId, startsAt: i.startsAt, endsAt: i.endsAt, status: 'CONFIRMED', channel: 'MARKETPLACE', currency: p.currency, feeMinor: this.catalog.feeFor(p, i.typeId), depositStatus: 'NONE', kiorlyAppointmentId: i.appointmentId, serviceLocation: 'HOME', careType: p.careType, visitDistrict: i.district, homeSurchargeMinor: fee?.homeSurcharge ? Math.round(Number(fee.homeSurcharge) * 100) : 0, carePlanId: i.planId } });
        await this.ev(id, 'STATE', { carePlan: i.planId }, 'INTENT', 'CONFIRMED');
        if (i.addressId) {
            const a = await this.addresses.rowFor(i.sub, i.addressId);
            if (a)
                await this.addresses.snapshot(id, i.sub, a);
        }
        await this.engagement.scheduleBookingReminders({ id: b.id, sub: b.sub, startsAt: b.startsAt }, this.doctorParams(p, b)).catch(() => undefined);
        return b;
    }
    async opsUnsafeAborts(limit = 100) {
        const rows = await this.prisma.bookingIntent.findMany({ where: { homeState: 'ABORTED_UNSAFE' }, orderBy: { abortedAt: 'desc' }, take: limit });
        const pays = await this.prisma.paymentIntent.findMany({ where: { bookingId: { in: rows.map((r) => r.id) } } });
        return rows.map((b) => { const pay = pays.find((p) => p.bookingId === b.id); return { bookingId: b.id, providerId: b.providerId, clinicId: b.clinicId, district: b.visitDistrict, abortedAt: b.abortedAt, noShow: false, depositStatus: b.depositStatus, paymentId: pay?.id ?? null, reviewState: pay?.reviewState ?? null, amountMinor: pay ? pay.amountMinor - pay.refundedMinor : 0 }; });
    }
    async opsList(q) {
        return this.prisma.bookingIntent.findMany({ where: { ...(q.status ? { status: q.status } : {}), ...(q.clinicId ? { clinicId: q.clinicId } : {}), ...(q.sub ? { sub: q.sub } : {}) }, orderBy: { createdAt: 'desc' }, take: Math.min(q.take ?? 50, 200), select: { id: true, status: true, clinicId: true, providerId: true, startsAt: true, depositStatus: true, callState: true, failureCode: true, createdAt: true, updatedAt: true } });
    }
    async opsTimeline(id) {
        const b = await this.prisma.bookingIntent.findUnique({ where: { id } });
        if (!b)
            throw (0, errors_1.notFound)('BOOKING_NOT_FOUND', 'Booking not found');
        const [events, payments, messages, webhooks, outbox] = await Promise.all([
            this.prisma.bookingEvent.findMany({ where: { bookingId: id }, orderBy: { createdAt: 'asc' } }),
            this.prisma.paymentIntent.findMany({ where: { bookingId: id }, include: { refunds: true } }),
            this.prisma.message.findMany({ where: { bookingId: id }, orderBy: { createdAt: 'asc' } }),
            b.kiorlyAppointmentId ? this.prisma.webhookReceipt.findMany({ where: { aggregateId: b.kiorlyAppointmentId }, orderBy: { receivedAt: 'asc' } }) : Promise.resolve([]),
            this.prisma.outboxEvent.findMany({ where: { aggregateId: { in: [id, ...(await this.prisma.paymentIntent.findMany({ where: { bookingId: id }, select: { id: true } })).map((p) => p.id)] } }, orderBy: { createdAt: 'asc' } }),
        ]);
        return { booking: { ...b, patientSnapshot: undefined }, events, payments, messages: messages.map((m) => ({ id: m.id, channel: m.channel, status: m.status, templateId: m.templateId, scheduledFor: m.scheduledFor })), webhooks: webhooks.map((w) => ({ eventId: w.eventId, type: w.type, status: w.status, at: w.receivedAt })), outbox: outbox.map((o) => ({ id: o.id, type: o.type, status: o.status, attempts: o.attempts })) };
    }
    async liquidity(days = 30) {
        const since = new Date(Date.now() - days * 86400_000);
        const [listed, live, byStatus, searches, booked, attended, noShow] = await Promise.all([
            this.prisma.provider.count(), this.prisma.provider.count({ where: { status: 'LIVE' } }),
            this.prisma.bookingIntent.groupBy({ by: ['status'], _count: true, where: { createdAt: { gte: since } } }),
            this.prisma.analyticsEvent.count({ where: { name: 'results_viewed', createdAt: { gte: since } } }),
            this.prisma.analyticsEvent.count({ where: { name: 'booking_confirmed', createdAt: { gte: since } } }),
            this.prisma.analyticsEvent.count({ where: { name: 'visit_attended', createdAt: { gte: since } } }),
            this.prisma.analyticsEvent.count({ where: { name: 'no_show', createdAt: { gte: since } } }),
        ]);
        const ev = await this.prisma.analyticsEvent.groupBy({ by: ['name', 'careType', 'serviceLocation'], _count: true, where: { createdAt: { gte: since }, name: { in: ['results_viewed', 'booking_confirmed', 'visit_attended', 'no_show', 'aborted_unsafe', 'home_visit_safety_alert'] } } });
        const byCareType = ev.map((e) => ({ name: e.name, careType: e.careType, serviceLocation: e.serviceLocation, count: e._count }));
        const homeEnabledByDistrict = await this.catalog.homeDistricts();
        const alerts = await this.prisma.safetyAlert.groupBy({ by: ['kind'], _count: true, where: { raisedAt: { gte: since } } });
        const safetyAlerts = { total: alerts.reduce((s, a) => s + a._count, 0), byKind: Object.fromEntries(alerts.map((a) => [a.kind, a._count])), unsafeAborts: await this.prisma.bookingIntent.count({ where: { homeState: 'ABORTED_UNSAFE', abortedAt: { gte: since } } }) };
        return { byCareType, homeEnabledByDistrict, safetyAlerts, windowDays: days, listedDoctors: listed, liveDoctors: live, bookingsByStatus: byStatus.map((s) => ({ status: s.status, count: s._count })), searchToBook: searches ? booked / searches : null, searches, confirmedBookings: booked, attended, noShow, noShowRate: attended + noShow ? noShow / (attended + noShow) : null, slotsPerDay: 'TODO: needs Kiorly slot count API (not in marketplace contract)' };
    }
};
exports.BookingService = BookingService;
exports.BookingService = BookingService = __decorate([
    (0, common_1.Injectable)(),
    __param(10, (0, common_1.Inject)(growth_ports_public_1.BOOKING_GROWTH)),
    __param(11, (0, common_1.Optional)()),
    __param(11, (0, common_1.Inject)(growth_ports_public_1.REWARDS_PORT)),
    __param(12, (0, common_1.Optional)()),
    __param(12, (0, common_1.Inject)(growth_ports_public_1.SPONSORED_DISCOUNT_PORT)),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, kiorly_public_1.KiorlyClient, catalog_public_1.CatalogService, control_plane_public_1.FlagsService,
        patient_public_1.PatientService, pay_public_1.PayService, engagement_public_1.EngagementService, outbox_public_1.OutboxService, market_public_1.MarketService,
        address_public_1.AddressService, Object, Object, Object])
], BookingService);
//# sourceMappingURL=booking.service.js.map