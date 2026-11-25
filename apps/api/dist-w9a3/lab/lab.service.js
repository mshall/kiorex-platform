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
exports.LabService = void 0;
const common_1 = require("@nestjs/common");
const growth_ports_public_1 = require("../growth/growth-ports-public");
const client_1 = require("../prisma/generated/client");
const node_crypto_1 = require("node:crypto");
const config_1 = require("../common/config");
const errors_1 = require("../common/errors");
const ids_1 = require("../common/ids");
const partner_http_1 = require("../common/partner-http");
const partners_public_1 = require("../partners/partners-public");
const engagement_public_1 = require("../engagement/engagement-public");
const patient_public_1 = require("../patient/patient-public");
const pay_public_1 = require("../pay/pay-public");
const prisma_service_1 = require("../prisma/prisma.service");
const records_public_1 = require("../records/records-public");
const lab_client_1 = require("./lab.client");
const FLAG = 'lab.kiorex_bookings';
const FINAL = new Set(['RESULT_RELEASED', 'REJECTED', 'CANCELLED']);
let LabService = class LabService {
    prisma;
    client;
    pay;
    records;
    patients;
    engagement;
    routing;
    registry;
    growth;
    constructor(prisma, client, pay, records, patients, engagement, routing, registry, growth) {
        this.prisma = prisma;
        this.client = client;
        this.pay = pay;
        this.records = records;
        this.patients = patients;
        this.engagement = engagement;
        this.routing = routing;
        this.registry = registry;
        this.growth = growth;
    }
    onModuleInit() {
        this.pay.onOrderCaptured('LAB', (p) => this.onPaid(p.orderRef));
        this.patients.registerExport('labBookings', async (sub) => (await this.prisma.labBooking.findMany({ where: { sub } })).map((b) => ({ id: b.id, status: b.status, tests: b.tests, slotStartsAt: b.slotStartsAt, totalMinor: b.totalMinor })));
        this.patients.registerAnonymizer('labBookings', async (sub) => {
            await this.prisma.labBooking.updateMany({ where: { sub }, data: { address: client_1.Prisma.DbNull, sub: `deleted:${(0, node_crypto_1.createHash)('sha256').update(sub).digest('hex').slice(0, 10)}` } });
        });
    }
    async partner(fn) {
        try {
            return (await fn()).data;
        }
        catch (e) {
            if (e instanceof partner_http_1.PartnerTransientError)
                throw (0, errors_1.unavailable)('LAB_SYSTEM_BUSY', 'Lab system busy, try again shortly', { retryable: true });
            if (e instanceof partner_http_1.PartnerHttpError && e.status === 403 && e.code === 'FEATURE_DISABLED')
                throw (0, errors_1.forbidden)('FEATURE_DISABLED', 'This capability is temporarily unavailable at the partner', { key: e.body?.key, scope: e.body?.scope, partner: 'Lab'.toLowerCase() });
            if (e instanceof partner_http_1.PartnerHttpError)
                throw (0, errors_1.unprocessable)(e.code ?? 'LAB_REJECTED', 'Lab rejected the request');
            throw e;
        }
    }
    lister = async (registrationId) => [...new Set((await this.client.tests({}, registrationId)).data.items.map((t) => t.labId))];
    async searchTests(q) {
        const regs = q.partnerId ? [await this.routing.byPartnerId('LAB', FLAG, q.partnerId)]
            : q.labId ? [await this.routing.resolve('LAB', FLAG, q.labId, undefined, this.lister)]
                : await (async () => { const live = await this.routing.live('LAB', FLAG); return live.length || (await this.routing.hasAny('LAB')) ? live : [null]; })();
        const settled = await Promise.allSettled(regs.map(async (r) => ({ id: r?.id ?? null, items: (await this.client.tests({ q: q.q, labId: q.labId }, r?.id ?? null)).data.items })));
        const ok = settled.flatMap((x) => (x.status === 'fulfilled' ? [x.value] : []));
        if (!ok.length && settled.length)
            await this.partner(() => Promise.reject(settled.find((x) => x.status === 'rejected').reason));
        return { items: ok.flatMap((g) => g.items.map((i) => ({ ...i, partnerId: g.id }))) };
    }
    async slots(labId, collectionType, from, to, tests, partnerId) {
        if (!['HOME', 'WALK_IN'].includes(collectionType))
            throw (0, errors_1.badRequest)('INVALID_COLLECTION_TYPE', 'collectionType must be HOME or WALK_IN');
        const reg = await this.routing.resolve('LAB', FLAG, labId, partnerId, this.lister);
        const d = await this.partner(() => this.client.slots(labId, { collectionType, from: from.toISOString(), to: to.toISOString(), tests }, reg?.id ?? null));
        return { labId, partnerId: reg?.id ?? null, collectionType, slots: d.slots };
    }
    async book(sub, i, via = {}) {
        if (!i.testCodes?.length || new Set(i.testCodes).size !== i.testCodes.length || i.testCodes.length > 20)
            throw (0, errors_1.badRequest)('INVALID_TESTS', '1-20 distinct test codes');
        const start = new Date(i.slot.startsAt);
        if (Number.isNaN(start.getTime()) || start <= new Date())
            throw (0, errors_1.badRequest)('INVALID_SLOT', 'slot must be in the future');
        if (i.collectionType === 'HOME' && !i.address?.line1?.trim())
            throw (0, errors_1.badRequest)('ADDRESS_REQUIRED', 'Home collection needs an address');
        const reg = await this.routing.resolve('LAB', FLAG, i.labId, i.partnerId, this.lister);
        const registrationId = reg?.id ?? null;
        const offered = await this.partner(() => this.client.slots(i.labId, { collectionType: i.collectionType, from: new Date(start.getTime() - 60_000).toISOString(), to: new Date(start.getTime() + 3600_000).toISOString(), tests: i.testCodes.join(',') }, registrationId));
        if (!offered.slots.some((s) => new Date(s.startsAt).getTime() === start.getTime()))
            throw (0, errors_1.conflict)('SLOT_TAKEN', 'That collection slot is no longer available', { alternatives: offered.slots.slice(0, 3) });
        const quote = await this.partner(() => this.client.quote({ labId: i.labId, testCodes: i.testCodes, collectionType: i.collectionType }, registrationId));
        if (quote.tests.length !== i.testCodes.length)
            throw (0, errors_1.unprocessable)('TEST_NOT_AVAILABLE', 'A selected test is not offered by this lab');
        const subtotal = quote.tests.reduce((s, t) => s + t.priceMinor, 0);
        const fee = i.collectionType === 'HOME' ? quote.collectionFeeMinor ?? 0 : 0;
        const id = (0, ids_1.newId)('kx_lb');
        const b = await this.prisma.labBooking.create({
            data: { id, sub, labId: i.labId, registrationId, tests: quote.tests, collectionType: i.collectionType, slotStartsAt: start, slotEndsAt: new Date(i.slot.endsAt), address: i.collectionType === 'HOME' ? i.address : undefined, status: 'PENDING_PAYMENT', subtotalMinor: subtotal, collectionFeeMinor: fee, totalMinor: subtotal + fee, takeRateBps: (0, config_1.cfg)().labTakeRateBps },
        });
        const p = await this.pay.createOrderIntent({ orderRef: id, purpose: 'LAB', sub, partnerId: `lab:${i.labId}`, amountMinor: b.totalMinor, currency: b.currency });
        await this.prisma.labBooking.update({ where: { id }, data: { paymentId: p.id } });
        await this.growth?.decide({ product: 'LAB', factKind: 'LAB_BOOKING', factId: id, sub, orgRef: await this.registry.orgRefOf(registrationId), createdAt: b.createdAt, continuity: { entryId: via.continuityId ?? null } });
        return this.present(await this.prisma.labBooking.findUniqueOrThrow({ where: { id } }));
    }
    async present(b) {
        const p = b.paymentId ? await this.pay.getIntent(b.paymentId) : null;
        return {
            id: b.id, status: b.status, labId: b.labId, partnerId: b.registrationId, tests: b.tests, collectionType: b.collectionType, slotStartsAt: b.slotStartsAt.toISOString(), slotEndsAt: b.slotEndsAt.toISOString(),
            subtotalMinor: b.subtotalMinor, collectionFeeMinor: b.collectionFeeMinor, totalMinor: b.totalMinor, currency: b.currency, resultRecordId: b.resultRecordId, rejectionReason: b.rejectionReason,
            payment: p ? { paymentId: p.id, status: p.status, checkoutUrl: p.status === 'CREATED' ? p.checkoutUrl : null } : null, createdAt: b.createdAt.toISOString(),
        };
    }
    async owned(sub, id) {
        const b = await this.prisma.labBooking.findUnique({ where: { id } });
        if (!b || b.sub !== sub)
            throw (0, errors_1.notFound)('LAB_BOOKING_NOT_FOUND', 'Lab booking not found');
        return b;
    }
    async list(sub) { return Promise.all((await this.prisma.labBooking.findMany({ where: { sub }, orderBy: { createdAt: 'desc' }, take: 100 })).map((b) => this.present(b))); }
    get(sub, id) { return this.owned(sub, id).then((b) => this.present(b)); }
    async opsList(status, partnerId) { const names = new Map((await this.prisma.partnerRegistration.findMany({ where: { kind: 'LAB' }, select: { id: true, name: true } })).map((r) => [r.id, r.name])); return Promise.all((await this.prisma.labBooking.findMany({ where: { ...(status ? { status } : {}), ...(partnerId ? { registrationId: partnerId } : {}) }, orderBy: { createdAt: 'desc' }, take: 200 })).map(async (b) => ({ ...(await this.present(b)), partnerName: (b.registrationId && names.get(b.registrationId)) || null, sub: b.sub, platformFeeMinor: b.platformFeeMinor, takeRateBps: b.takeRateBps }))); }
    async move(b, from, to, patch = {}, db = this.prisma) {
        return (await db.labBooking.updateMany({ where: { id: b.id, status: { in: from } }, data: { status: to, ...patch } })).count > 0;
    }
    async onPaid(bookingId) {
        const b = await this.prisma.labBooking.findUnique({ where: { id: bookingId } });
        if (!b)
            return;
        if (b.status === 'PENDING_PAYMENT')
            await this.move(b, ['PENDING_PAYMENT'], 'PAID');
        await this.submit(bookingId);
    }
    async submit(bookingId) {
        const b = await this.prisma.labBooking.findUniqueOrThrow({ where: { id: bookingId } });
        if (b.status !== 'PAID')
            return b.status;
        const prof = await this.patients.profileBySub(b.sub);
        const addr = (b.address ?? {});
        const home = b.collectionType === 'HOME';
        const gender = /^f/i.test(prof?.gender ?? '') ? 'F' : /^m/i.test(prof?.gender ?? '') ? 'M' : undefined;
        const intent = {
            sourceRef: b.id, labId: b.labId,
            patient: { fullName: prof?.nameEn ?? prof?.nameAr ?? 'Kiorex patient', phone: prof?.phone ?? undefined, externalId: b.sub, dateOfBirth: prof?.dateOfBirth?.toISOString().slice(0, 10), sex: gender, preferredLocale: prof?.preferredLocale === 'en' ? 'en' : 'ar' },
            testCodes: b.tests.map((t) => t.code),
            collection: { type: home ? 'HOME' : 'IN_LAB', address: home ? [addr.line1, addr.area, addr.governorate, addr.notes].filter(Boolean).join(', ') : undefined, windowStart: b.slotStartsAt.toISOString(), windowEnd: b.slotEndsAt.toISOString(), contactPhone: addr.phone ?? prof?.phone ?? undefined },
            consentChannels: ['KIOREX_VAULT'],
        };
        const acquisition = await this.growth?.acquisitionBlock({ product: 'LAB', factKind: 'LAB_BOOKING', factId: b.id, sub: b.sub, orgRef: await this.registry.orgRefOf(b.registrationId), createdAt: b.createdAt });
        if (acquisition)
            intent.acquisition = acquisition;
        try {
            const { data } = await this.client.createOrder(b.id, intent, b.registrationId);
            if (data.status === 'CANCELLED')
                return this.reject(b, 'LAB_CANCELLED');
            await this.move(b, ['PAID'], 'SUBMITTED', { partnerOrderId: data.orderId });
            await this.engagement.notify(b.sub, { kind: 'LAB_BOOKING_CONFIRMED', params: { time: b.slotStartsAt.toISOString() }, dedupeKey: `LAB_BOOKING_CONFIRMED:${b.id}` });
            return 'SUBMITTED';
        }
        catch (e) {
            if (e instanceof partner_http_1.PartnerHttpError && e.status !== 401)
                return this.reject(b, e.code ?? `LAB_${e.status}`);
            throw e;
        }
    }
    async moveAndRefund(b, from, to, patch = {}) {
        return this.prisma.$transaction(async (tx) => {
            const moved = await this.move(b, from, to, patch, tx);
            if (moved && b.paymentId)
                await this.pay.refundOrder(b.paymentId, to, tx);
            return moved;
        });
    }
    async reject(b, reason) {
        await this.moveAndRefund(b, ['PAID', 'SUBMITTED'], 'REJECTED', { rejectionReason: reason.slice(0, 120) });
        return 'REJECTED';
    }
    async cancel(sub, id) {
        const b = await this.owned(sub, id);
        if (b.status === 'PENDING_PAYMENT') {
            await this.moveAndRefund(b, ['PENDING_PAYMENT'], 'CANCELLED');
            return this.get(sub, id);
        }
        if (!['PAID', 'SUBMITTED'].includes(b.status))
            throw (0, errors_1.conflict)('LAB_BOOKING_NOT_CANCELLABLE', `Booking is ${b.status}`);
        if (b.partnerOrderId) {
            try {
                await this.client.cancelOrder(b.id, 'PATIENT_CANCELLED', b.registrationId);
            }
            catch (e) {
                if (e instanceof partner_http_1.PartnerHttpError)
                    throw (0, errors_1.conflict)('LAB_BOOKING_NOT_CANCELLABLE', 'The lab already collected or started processing this order');
                throw (0, errors_1.unavailable)('LAB_SYSTEM_BUSY', 'Lab system busy, try again shortly', { retryable: true });
            }
        }
        await this.moveAndRefund(b, ['PAID', 'SUBMITTED'], 'CANCELLED');
        return this.get(sub, id);
    }
    async resubmit(id) { return { status: await this.submit(id) }; }
    async foreign(b, ctx, type) {
        if (!ctx.registrationId || !b.registrationId || ctx.registrationId === b.registrationId)
            return false;
        await this.prisma.auditLog.create({ data: { actor: 'lab', action: 'lab.event_from_other_registration', resource: 'LabBooking', resourceId: b.id, metadata: { type, from: ctx.registrationId, owner: b.registrationId } } });
        return true;
    }
    async onStatusChanged(d, ctx = {}) {
        const b = await this.prisma.labBooking.findFirst({ where: { OR: [...(d.orderId ? [{ partnerOrderId: d.orderId }] : []), ...(d.sourceRef ? [{ id: d.sourceRef }] : [])] } });
        if (!b)
            return 'UNKNOWN_ORDER';
        if (await this.foreign(b, ctx, 'LabOrderStatusChanged'))
            return 'IGNORED';
        if (FINAL.has(b.status))
            return 'IGNORED';
        if (d.nextStatus === 'COLLECTED')
            return (await this.move(b, ['PAID', 'SUBMITTED'], 'COLLECTED')) ? 'APPLIED' : 'IGNORED';
        if (d.nextStatus === 'CANCELLED') {
            await this.reject(b, 'LAB_CANCELLED');
            return 'APPLIED';
        }
        return 'IGNORED';
    }
    async onResultReleased(d, ctx = {}) {
        const b = await this.prisma.labBooking.findFirst({ where: { OR: [{ partnerOrderId: d.orderId }, { id: d.orderId }] } });
        if (b && (await this.foreign(b, ctx, 'LabResultReleased')))
            return 'IGNORED';
        const outcome = await this.records.storeLabResult({ ...d, patientRef: b?.sub ?? d.patientRef });
        if (!b || FINAL.has(b.status))
            return outcome;
        const rec = outcome === 'APPLIED' ? await this.prisma.sharedRecord.findFirst({ where: { sub: b.sub, kind: 'LAB_RESULT', sourceRef: d.reportId } }) : null;
        if (await this.move(b, ['PAID', 'SUBMITTED', 'COLLECTED'], 'RESULT_RELEASED', { resultRecordId: rec?.id ?? null })) {
            const fee = Math.round((b.subtotalMinor * b.takeRateBps) / 10000);
            await this.prisma.labBooking.update({ where: { id: b.id }, data: { platformFeeMinor: fee } });
            if (b.paymentId)
                await this.pay.releaseOrder(b.paymentId, { feeMinor: fee });
        }
        return outcome === 'UNMAPPED_PATIENT' ? 'APPLIED' : outcome;
    }
};
exports.LabService = LabService;
exports.LabService = LabService = __decorate([
    (0, common_1.Injectable)(),
    __param(8, (0, common_1.Optional)()),
    __param(8, (0, common_1.Inject)(growth_ports_public_1.PRODUCT_GROWTH)),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, lab_client_1.LabClient, pay_public_1.PayService, records_public_1.RecordsService,
        patient_public_1.PatientService, engagement_public_1.EngagementService, partners_public_1.PartnerRouting, partners_public_1.PartnerRegistry, Object])
], LabService);
//# sourceMappingURL=lab.service.js.map