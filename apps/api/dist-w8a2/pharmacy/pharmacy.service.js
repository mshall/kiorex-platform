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
exports.PharmacyService = void 0;
const common_1 = require("@nestjs/common");
const growth_ports_public_1 = require("../growth/growth-ports-public");
const client_1 = require("../prisma/generated/client");
const node_crypto_1 = require("node:crypto");
const config_1 = require("../common/config");
const errors_1 = require("../common/errors");
const ids_1 = require("../common/ids");
const partner_http_1 = require("../common/partner-http");
const partners_public_1 = require("../partners/partners-public");
const policy_public_1 = require("../policy/policy-public");
const engagement_public_1 = require("../engagement/engagement-public");
const patient_public_1 = require("../patient/patient-public");
const pay_public_1 = require("../pay/pay-public");
const prisma_service_1 = require("../prisma/prisma.service");
const records_public_1 = require("../records/records-public");
const pharmacy_client_1 = require("./pharmacy.client");
const FLAG = 'pharmacy.kiorex_orders';
const FINAL = new Set(['DISPENSED', 'PARTIALLY_FULFILLED', 'PARTIAL_REVIEW', 'REJECTED', 'CANCELLED']);
const IN_FLIGHT = ['PAID', 'SUBMITTED', 'READY', 'OUT_FOR_DELIVERY'];
let PharmacyService = class PharmacyService {
    prisma;
    client;
    pay;
    records;
    patients;
    engagement;
    policy;
    routing;
    registry;
    growth;
    constructor(prisma, client, pay, records, patients, engagement, policy, routing, registry, growth) {
        this.prisma = prisma;
        this.client = client;
        this.pay = pay;
        this.records = records;
        this.patients = patients;
        this.engagement = engagement;
        this.policy = policy;
        this.routing = routing;
        this.registry = registry;
        this.growth = growth;
    }
    onModuleInit() {
        this.pay.onOrderCaptured('PHARMACY', (p) => this.onPaid(p.orderRef));
        this.patients.registerExport('pharmacyOrders', async (sub) => (await this.prisma.pharmacyOrder.findMany({ where: { sub } })).map((o) => ({ id: o.id, status: o.status, items: o.items, totalMinor: o.totalMinor, createdAt: o.createdAt })));
        this.patients.registerAnonymizer('pharmacyOrders', async (sub) => {
            await this.prisma.pharmacyCart.deleteMany({ where: { sub } });
            await this.prisma.pharmacyOrder.updateMany({ where: { sub }, data: { deliveryAddress: client_1.Prisma.DbNull, sub: `deleted:${(0, node_crypto_1.createHash)('sha256').update(sub).digest('hex').slice(0, 10)}` } });
        });
    }
    async partner(fn) {
        try {
            return (await fn()).data;
        }
        catch (e) {
            if (e instanceof partner_http_1.PartnerTransientError)
                throw (0, errors_1.unavailable)('PHARMACY_SYSTEM_BUSY', 'Pharmacy system busy, try again shortly', { retryable: true });
            if (e instanceof partner_http_1.PartnerHttpError && e.status === 403 && e.code === 'FEATURE_DISABLED')
                throw (0, errors_1.forbidden)('FEATURE_DISABLED', 'This capability is temporarily unavailable at the partner', { key: e.body?.key, scope: e.body?.scope, partner: 'Pharmacy'.toLowerCase() });
            if (e instanceof partner_http_1.PartnerHttpError)
                throw (0, errors_1.unprocessable)(e.code ?? 'PHARMACY_REJECTED', 'Pharmacy rejected the request');
            throw e;
        }
    }
    lister = async (registrationId) => (await this.client.pharmacies(registrationId)).data.items.map((p) => p.id);
    async fan(regs, fn) {
        const settled = await Promise.allSettled(regs.map(async (r) => ({ id: r?.id ?? null, items: (await fn(r?.id ?? null)).data.items })));
        const ok = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
        if (!ok.length && settled.length)
            await this.partner(() => Promise.reject(settled.find((s) => s.status === 'rejected').reason));
        return ok.flatMap((g) => g.items.map((i) => ({ ...i, partnerId: g.id })));
    }
    async liveRegs() {
        const live = await this.routing.live('PHARMACY', FLAG);
        return live.length || (await this.routing.hasAny('PHARMACY')) ? live : [null];
    }
    async pharmacies(partnerId) {
        const regs = partnerId ? [await this.routing.byPartnerId('PHARMACY', FLAG, partnerId)] : await this.liveRegs();
        const items = await this.fan(regs, (id) => this.client.pharmacies(id));
        return items.map((p) => ({ id: p.id, name: p.name, partnerId: p.partnerId, pickup: p.pickup, deliveryEnabled: p.delivery.enabled, deliveryFeeMinor: p.delivery.feeMinor, prepMinutes: p.prepMinutes }));
    }
    async search(q) {
        const regs = q.partnerId ? [await this.routing.byPartnerId('PHARMACY', FLAG, q.partnerId)]
            : q.pharmacyId ? [await this.routing.resolve('PHARMACY', FLAG, q.pharmacyId, undefined, this.lister)] : await this.liveRegs();
        const items = await this.fan(regs, (id) => this.client.catalogue({ q: q.q, pharmacyId: q.pharmacyId }, id));
        return { items: items.filter((i) => !i.controlled).map(({ controlled: _c, ...i }) => i) };
    }
    lines(quote) { return quote.items.map((i) => ({ sku: i.sku, name: i.name, ...(i.nameAr && { nameAr: i.nameAr }), ...(i.strength && { strength: i.strength }), ...(i.form && { form: i.form }), ...(i.formAr && { formAr: i.formAr }), qty: i.qty, unitPriceMinor: i.unitPriceMinor, rxRequired: i.rxRequired, available: i.available })); }
    assertNoControlled(quote) {
        if (quote.items.some((i) => i.controlled))
            throw (0, errors_1.unprocessable)('CONTROLLED_NOT_ORDERABLE', 'Controlled medicines cannot be ordered online');
    }
    totals(items, method, deliveryFee) {
        const subtotal = items.reduce((s, i) => s + i.qty * i.unitPriceMinor, 0);
        const fee = method === 'DELIVERY' ? deliveryFee : 0;
        return { subtotalMinor: subtotal, deliveryFeeMinor: fee, totalMinor: subtotal + fee };
    }
    async presentCart(sub) {
        const c = await this.prisma.pharmacyCart.findUnique({ where: { sub } });
        const items = (c?.items ?? []);
        const fee = c?.deliveryMethod === 'DELIVERY' ? (c.deliveryAddress?._feeMinor ?? (0, config_1.cfg)().deliveryFeeMinor) : 0;
        return { pharmacyId: c?.pharmacyId ?? null, partnerId: c?.registrationId ?? null, items, deliveryMethod: c?.deliveryMethod ?? null, prescriptionRecordId: c?.prescriptionRecordId ?? null, ...this.totals(items, c?.deliveryMethod ?? null, fee), currency: 'EGP', rxRequired: items.some((i) => i.rxRequired) };
    }
    getCart(sub) { return this.presentCart(sub); }
    async putCart(sub, i) {
        if (!i.items?.length)
            throw (0, errors_1.badRequest)('CART_EMPTY', 'items must not be empty');
        if (i.items.length > 30 || i.items.some((x) => !Number.isInteger(x.qty) || x.qty < 1 || x.qty > 20))
            throw (0, errors_1.badRequest)('INVALID_ITEMS', 'max 30 lines, quantity 1-20');
        if (i.prescriptionRecordId)
            await this.records.prescriptionForOrder(sub, i.prescriptionRecordId);
        const reg = await this.routing.resolve('PHARMACY', FLAG, i.pharmacyId, i.partnerId, this.lister);
        const registrationId = reg?.id ?? null;
        const quote = await this.partner(() => this.client.quote({ pharmacyId: i.pharmacyId, items: i.items }, registrationId));
        this.assertNoControlled(quote);
        const existing = await this.prisma.pharmacyCart.findUnique({ where: { sub } });
        const data = { pharmacyId: i.pharmacyId, registrationId, items: this.lines(quote), prescriptionRecordId: i.prescriptionRecordId ?? null };
        await this.prisma.pharmacyCart.upsert({ where: { sub }, create: { sub, ...data }, update: { ...data, ...(existing?.pharmacyId !== i.pharmacyId || existing?.registrationId !== registrationId ? { deliveryMethod: null, deliveryAddress: client_1.Prisma.DbNull } : {}) } });
        return this.presentCart(sub);
    }
    async setDelivery(sub, d) {
        const cart = await this.prisma.pharmacyCart.findUnique({ where: { sub } });
        if (!cart?.pharmacyId)
            throw (0, errors_1.badRequest)('CART_EMPTY', 'Add items first');
        let feeMinor = 0;
        if (d.method === 'DELIVERY') {
            if (!d.address?.line1?.trim())
                throw (0, errors_1.badRequest)('ADDRESS_REQUIRED', 'Delivery needs an address');
            const ph = (await this.partner(() => this.client.pharmacies(cart.registrationId))).items.find((p) => p.id === cart.pharmacyId);
            if (!ph?.delivery.enabled)
                throw (0, errors_1.unprocessable)('DELIVERY_NOT_AVAILABLE', 'This pharmacy does not deliver');
            feeMinor = ph.delivery.feeMinor ?? (0, config_1.cfg)().deliveryFeeMinor;
        }
        else {
            const ph = (await this.partner(() => this.client.pharmacies(cart.registrationId))).items.find((p) => p.id === cart.pharmacyId);
            if (ph && !ph.pickup)
                throw (0, errors_1.unprocessable)('PICKUP_NOT_AVAILABLE', 'This pharmacy does not offer pickup');
        }
        await this.prisma.pharmacyCart.update({ where: { sub }, data: { deliveryMethod: d.method, deliveryAddress: d.method === 'DELIVERY' ? { ...d.address, _feeMinor: feeMinor } : client_1.Prisma.DbNull } });
        return this.presentCart(sub);
    }
    async clearCart(sub) { await this.prisma.pharmacyCart.deleteMany({ where: { sub } }); return { ok: true }; }
    async createOrder(sub, o) {
        const cart = await this.prisma.pharmacyCart.findUnique({ where: { sub } });
        const items = (cart?.items ?? []);
        if (!cart?.pharmacyId || !items.length)
            throw (0, errors_1.badRequest)('CART_EMPTY', 'Your cart is empty');
        if (!cart.deliveryMethod)
            throw (0, errors_1.badRequest)('DELIVERY_REQUIRED', 'Choose pickup or delivery');
        await this.routing.assertOrgAllows(cart.registrationId, FLAG);
        const quote = await this.partner(() => this.client.quote({ pharmacyId: cart.pharmacyId, items: items.map((i) => ({ sku: i.sku, qty: i.qty })), delivery: { method: cart.deliveryMethod } }, cart.registrationId));
        this.assertNoControlled(quote);
        const lines = this.lines(quote);
        const missing = lines.filter((l) => !l.available).map((l) => l.sku);
        if (missing.length)
            throw (0, errors_1.conflict)('ITEM_UNAVAILABLE', 'Some items are no longer available', { skus: missing });
        const rxNeeded = lines.some((l) => l.rxRequired);
        const rxId = o.prescriptionRecordId ?? cart.prescriptionRecordId ?? undefined;
        if (rxNeeded && !rxId)
            throw (0, errors_1.unprocessable)('RX_REQUIRED', 'A prescription from your vault is required for prescription-only items', { skus: lines.filter((l) => l.rxRequired).map((l) => l.sku) });
        if (rxId)
            await this.records.prescriptionForOrder(sub, rxId);
        const feeMinor = cart.deliveryMethod === 'DELIVERY' ? (quote.delivery?.feeMinor ?? cart.deliveryAddress?._feeMinor ?? (0, config_1.cfg)().deliveryFeeMinor) : 0;
        const t = this.totals(lines, cart.deliveryMethod, feeMinor);
        const id = (0, ids_1.newId)('kx_ph');
        const { _feeMinor, ...address } = (cart.deliveryAddress ?? {});
        void _feeMinor;
        const order = await this.prisma.pharmacyOrder.create({
            data: { id, sub, pharmacyId: cart.pharmacyId, registrationId: cart.registrationId, status: 'PENDING_PAYMENT', items: lines, ...t, deliveryMethod: cart.deliveryMethod, deliveryAddress: cart.deliveryMethod === 'DELIVERY' ? address : undefined, prescriptionRecordId: rxId, rxStatus: rxNeeded ? 'PENDING' : 'NOT_REQUIRED', takeRateBps: (0, config_1.cfg)().pharmacyTakeRateBps },
        });
        const p = await this.pay.createOrderIntent({ orderRef: id, purpose: 'PHARMACY', sub, partnerId: `ph:${cart.pharmacyId}`, amountMinor: t.totalMinor, currency: order.currency });
        await this.prisma.pharmacyOrder.update({ where: { id }, data: { paymentId: p.id } });
        await this.prisma.pharmacyCart.delete({ where: { sub } });
        await this.growth?.decide({ product: 'PHARMACY', factKind: 'ORDER', factId: id, sub, orgRef: await this.policyOrgOrNull(order.registrationId), createdAt: order.createdAt });
        return this.present(await this.prisma.pharmacyOrder.findUniqueOrThrow({ where: { id } }));
    }
    async policyOrgOrNull(registrationId) { return this.registry.orgRefOf(registrationId); }
    async policyOrg(o) { return (await this.registry.orgRefOf(o.registrationId)) ?? o.pharmacyId; }
    publicAddress(a) {
        const { line1, area, governorate, notes, phone } = (a ?? {});
        return line1 ? { line1, ...(area && { area }), ...(governorate && { governorate }), ...(notes && { notes }), ...(phone && { phone }) } : null;
    }
    async present(o) {
        const p = o.paymentId ? await this.pay.getIntent(o.paymentId) : null;
        return {
            id: o.id, status: o.status, pharmacyId: o.pharmacyId, partnerId: o.registrationId, items: o.items, subtotalMinor: o.subtotalMinor, deliveryFeeMinor: o.deliveryFeeMinor, totalMinor: o.totalMinor, currency: o.currency, deliveryMethod: o.deliveryMethod,
            rxStatus: o.rxStatus, deliveryAddress: o.deliveryMethod === 'DELIVERY' ? this.publicAddress(o.deliveryAddress) : null, rejectionReason: o.rejectionReason, readyAt: o.readyAt?.toISOString() ?? null, outForDeliveryAt: o.outForDeliveryAt?.toISOString() ?? null, dispensedAt: o.dispensedAt?.toISOString() ?? null,
            refund: await this.presentRefund(o),
            payment: p ? { paymentId: p.id, status: p.status, checkoutUrl: p.status === 'CREATED' ? p.checkoutUrl : null } : null, createdAt: o.createdAt.toISOString(),
        };
    }
    async presentRefund(o) {
        const st = o.settlement;
        if (!st?.refund || !o.paymentId)
            return null;
        const r = await this.prisma.refund.findUnique({ where: { idempotencyKey: `refund-partial:${o.paymentId}` } });
        return { status: r?.status === 'SETTLED' ? 'SETTLED' : 'REQUESTED', ...st.refund, currency: o.currency, policyNote: policy_public_1.PROPOSED_DEFAULT_NOTE };
    }
    async owned(sub, id) {
        const o = await this.prisma.pharmacyOrder.findUnique({ where: { id } });
        if (!o || o.sub !== sub)
            throw (0, errors_1.notFound)('ORDER_NOT_FOUND', 'Order not found');
        return o;
    }
    async list(sub) { return Promise.all((await this.prisma.pharmacyOrder.findMany({ where: { sub }, orderBy: { createdAt: 'desc' }, take: 100 })).map((o) => this.present(o))); }
    async get(sub, id) { return this.present(await this.owned(sub, id)); }
    async opsList(status, partnerId) { const names = new Map((await this.prisma.partnerRegistration.findMany({ where: { kind: 'PHARMACY' }, select: { id: true, name: true } })).map((r) => [r.id, r.name])); return Promise.all((await this.prisma.pharmacyOrder.findMany({ where: { ...(status ? { status } : {}), ...(partnerId ? { registrationId: partnerId } : {}) }, orderBy: { createdAt: 'desc' }, take: 200 })).map(async (o) => ({ ...(await this.present(o)), partnerName: (o.registrationId && names.get(o.registrationId)) || null, sub: o.sub, platformFeeMinor: o.platformFeeMinor, takeRateBps: o.takeRateBps }))); }
    async move(o, from, to, patch = {}, db = this.prisma) {
        const r = await db.pharmacyOrder.updateMany({ where: { id: o.id, status: { in: from } }, data: { status: to, ...patch } });
        return r.count > 0;
    }
    async onPaid(orderId) {
        const o = await this.prisma.pharmacyOrder.findUnique({ where: { id: orderId } });
        if (!o)
            return;
        if (o.status === 'PENDING_PAYMENT')
            await this.move(o, ['PENDING_PAYMENT'], 'PAID');
        await this.submit(orderId);
    }
    async submit(orderId) {
        const o = await this.prisma.pharmacyOrder.findUniqueOrThrow({ where: { id: orderId } });
        if (o.status !== 'PAID')
            return o.status;
        let rx;
        if (o.prescriptionRecordId) {
            const r = await this.records.prescriptionForOrder(o.sub, o.prescriptionRecordId).catch(() => null);
            if (!r)
                return this.reject(o, 'RX_NO_LONGER_SHARED');
            rx = { recordRef: r.id, verificationToken: r.verificationToken };
        }
        const prof = await this.patients.profileBySub(o.sub);
        const addr = (o.deliveryAddress ?? {});
        const intent = {
            orderId: o.id, branchId: o.pharmacyId, patientRef: o.sub, prepaid: true,
            customer: { name: prof?.nameEn ?? prof?.nameAr ?? undefined, phone: addr.phone ?? prof?.phone ?? undefined, address: o.deliveryMethod === 'DELIVERY' ? [addr.line1, addr.area, addr.governorate, addr.notes].filter(Boolean).join(', ') : undefined },
            lines: o.items.map((i) => ({ sku: i.sku, quantity: i.qty, unitPrice: (i.unitPriceMinor / 100).toFixed(2) })),
            delivery: { method: o.deliveryMethod, address: o.deliveryAddress ?? undefined },
            payment: { reference: o.paymentId, totalMinor: o.totalMinor, currency: o.currency },
            prescription: rx,
        };
        const acquisition = await this.growth?.acquisitionBlock({ product: 'PHARMACY', factKind: 'ORDER', factId: o.id, sub: o.sub, orgRef: await this.policyOrgOrNull(o.registrationId), createdAt: o.createdAt });
        if (acquisition)
            intent.acquisition = acquisition;
        try {
            const { data } = await this.client.createOrder(o.id, intent, o.registrationId);
            if (data.status === 'REJECTED' || data.status === 'CANCELLED' || data.status === 'EXPIRED')
                return this.reject(o, `PHARMACY_${data.status}`);
            await this.move(o, ['PAID'], 'SUBMITTED', { partnerOrderId: data.orderId });
            if (rx) {
                const v = await this.client.validatePrescription({ orderId: data.orderId, prescriptionRef: rx.recordRef, verificationToken: rx.verificationToken, patientRef: o.sub }, o.registrationId);
                await this.prisma.pharmacyOrder.update({ where: { id: o.id }, data: { rxStatus: v.data.status === 'INVALID' ? 'INVALID' : v.data.status } });
                if (v.data.status === 'INVALID') {
                    await this.client.cancelOrder(data.orderId, 'RX_INVALID', o.registrationId).catch(() => undefined);
                    return this.reject(await this.prisma.pharmacyOrder.findUniqueOrThrow({ where: { id: o.id } }), v.data.reason ?? 'RX_INVALID', ['SUBMITTED']);
                }
            }
            return 'SUBMITTED';
        }
        catch (e) {
            if (e instanceof partner_http_1.PartnerHttpError && e.status !== 401)
                return this.reject(o, e.code ?? `PHARMACY_${e.status}`);
            throw e;
        }
    }
    async moveAndRefund(o, from, to, patch = {}) {
        return this.prisma.$transaction(async (tx) => {
            const moved = await this.move(o, from, to, patch, tx);
            if (moved && o.paymentId)
                await this.pay.refundOrder(o.paymentId, to, tx);
            return moved;
        });
    }
    async reject(o, reason, from = IN_FLIGHT) {
        if (await this.moveAndRefund(o, from, 'REJECTED', { rejectionReason: reason.slice(0, 120) })) {
            await this.engagement.notify(o.sub, { kind: 'PHARMACY_ORDER_REJECTED', dedupeKey: `PHARMACY_ORDER_REJECTED:${o.id}` });
        }
        return 'REJECTED';
    }
    async onPartnerEvent(type, data, ctx = {}) {
        const o = await this.prisma.pharmacyOrder.findFirst({ where: { OR: [{ partnerOrderId: String(data.orderId) }, { id: String(data.orderId) }] } });
        if (!o)
            return 'UNKNOWN_ORDER';
        if (ctx.registrationId && o.registrationId && ctx.registrationId !== o.registrationId) {
            await this.prisma.auditLog.create({ data: { actor: 'pharmacy', action: 'pharmacy.event_from_other_registration', resource: 'PharmacyOrder', resourceId: o.id, metadata: { type, from: ctx.registrationId, owner: o.registrationId } } });
            return 'IGNORED';
        }
        if (FINAL.has(o.status))
            return 'IGNORED';
        if ((type === 'OrderReady' || type === 'DispenseCompleted') && !data.pharmacistSignoff?.userId) {
            await this.prisma.auditLog.create({ data: { actor: 'pharmacy', action: 'pharmacy.event_without_signoff', resource: 'PharmacyOrder', resourceId: o.id, metadata: { type } } });
            return 'IGNORED';
        }
        if (type === 'OrderRejected') {
            await this.reject(o, String(data.reasonCode ?? data.reason ?? 'PHARMACY_REJECTED'));
            return 'APPLIED';
        }
        if (type === 'OrderReady') {
            if (await this.move(o, ['PAID', 'SUBMITTED'], 'READY', { readyAt: new Date(data.readyAt ?? Date.now()), ...(o.rxStatus === 'PENDING' ? { rxStatus: 'VALID' } : {}) }))
                await this.engagement.notify(o.sub, { kind: 'PHARMACY_ORDER_READY', dedupeKey: `PHARMACY_ORDER_READY:${o.id}` });
            return 'APPLIED';
        }
        if (type === 'OrderOutForDelivery') {
            if (o.deliveryMethod !== 'DELIVERY') {
                await this.prisma.auditLog.create({ data: { actor: 'pharmacy', action: 'pharmacy.out_for_delivery_on_pickup_order', resource: 'PharmacyOrder', resourceId: o.id, metadata: { type } } });
                return 'IGNORED';
            }
            if (await this.move(o, ['PAID', 'SUBMITTED', 'READY'], 'OUT_FOR_DELIVERY', { outForDeliveryAt: new Date(data.outForDeliveryAt ?? Date.now()), ...(o.rxStatus === 'PENDING' ? { rxStatus: 'VALID' } : {}) })) {
                await this.engagement.notify(o.sub, { kind: 'PHARMACY_ORDER_OUT_FOR_DELIVERY', dedupeKey: `PHARMACY_ORDER_OUT_FOR_DELIVERY:${o.id}` });
            }
            return 'APPLIED';
        }
        if (type === 'DispenseCompleted') {
            if (data.partial) {
                const pol = this.policy.get('pharmacy.partial_fulfilment', { market: (0, config_1.cfg)().defaultMarket, orgId: await this.policyOrg(o) }).value;
                const lines = Array.isArray(data.lines) ? data.lines : null;
                if (pol.mode === 'PRO_RATA_REFUND' && lines) {
                    await this.settlePartial(o, { dispensed: lines, deliveryMade: data.deliveryMade, dispensedAt: new Date(data.dispensedAt ?? Date.now()) }, IN_FLIGHT, 'pharmacy');
                    return 'APPLIED';
                }
                await this.move(o, IN_FLIGHT, 'PARTIAL_REVIEW', { dispensedAt: new Date(data.dispensedAt ?? Date.now()), settlement: { pending: true, reportedLines: lines, deliveryMade: data.deliveryMade ?? null } });
                await this.prisma.auditLog.create({ data: { actor: 'pharmacy', action: 'pharmacy.partial_dispense_review', resource: 'PharmacyOrder', resourceId: o.id, metadata: { reason: lines ? 'POLICY_MANUAL_REVIEW' : 'NO_LINES_IN_EVENT' } } });
                return 'APPLIED';
            }
            const fee = Math.round((o.subtotalMinor * o.takeRateBps) / 10000);
            if (await this.move(o, IN_FLIGHT, 'DISPENSED', { dispensedAt: new Date(data.dispensedAt ?? Date.now()), platformFeeMinor: fee })) {
                if (o.paymentId)
                    await this.pay.releaseOrder(o.paymentId, { feeMinor: fee });
                await this.engagement.notify(o.sub, { kind: 'PHARMACY_ORDER_DISPENSED', dedupeKey: `PHARMACY_ORDER_DISPENSED:${o.id}` });
            }
            return 'APPLIED';
        }
        return 'IGNORED';
    }
    async settlePartial(o, i, from, actor) {
        const pol = this.policy.get('pharmacy.partial_fulfilment', { market: (0, config_1.cfg)().defaultMarket, orgId: await this.policyOrg(o) });
        const calc = (0, policy_public_1.computePartialSettlement)({ items: o.items, deliveryMethod: o.deliveryMethod, deliveryFeeMinor: o.deliveryFeeMinor, dispensed: i.dispensed, deliveryMade: i.deliveryMade }, pol.value);
        if (calc.nothingFulfilled) {
            await this.reject(o, 'NOTHING_DISPENSED', from);
            return calc;
        }
        const fee = Math.round((calc.fulfilledGoodsMinor * o.takeRateBps) / 10000);
        const refunded = await this.prisma.$transaction(async (tx) => {
            const refundedAt = new Date().toISOString();
            const settlement = { refund: { lines: calc.lines, goodsMinor: calc.goodsRefundMinor, deliveryFeeMinor: calc.deliveryFeeRefundMinor, totalMinor: calc.refundTotalMinor, fulfilledMinor: calc.fulfilledGoodsMinor, refundedAt }, policy: { key: pol.key, source: pol.source, value: pol.value, note: pol.note ?? policy_public_1.PROPOSED_DEFAULT_NOTE }, resolvedBy: actor };
            const moved = await this.move(o, from, calc.refundTotalMinor > 0 ? 'PARTIALLY_FULFILLED' : 'DISPENSED', { dispensedAt: i.dispensedAt, platformFeeMinor: fee, settlement: calc.refundTotalMinor > 0 ? settlement : client_1.Prisma.DbNull }, tx);
            if (!moved)
                return false;
            if (o.paymentId) {
                if (calc.refundTotalMinor > 0)
                    await this.pay.refund(o.paymentId, { reason: 'PARTIAL_FULFILMENT', amountMinor: calc.refundTotalMinor, idempotencyKey: `refund-partial:${o.paymentId}` }, tx);
                if (pol.value.releaseFulfilledToPharmacy)
                    await this.pay.releaseOrder(o.paymentId, { feeMinor: fee }, tx);
            }
            await tx.auditLog.create({ data: { actor, action: 'pharmacy.partial_settled', resource: 'PharmacyOrder', resourceId: o.id, metadata: { refundTotalMinor: calc.refundTotalMinor, goodsRefundMinor: calc.goodsRefundMinor, deliveryFeeRefundMinor: calc.deliveryFeeRefundMinor, fulfilledMinor: calc.fulfilledGoodsMinor, policySource: pol.source } } });
            return true;
        });
        if (refunded) {
            if (calc.refundTotalMinor > 0)
                await this.engagement.notify(o.sub, { kind: 'PHARMACY_ORDER_PARTIAL_REFUND', params: { amount: `${(calc.refundTotalMinor / 100).toFixed(2)} ${o.currency}` }, dedupeKey: `PHARMACY_ORDER_PARTIAL_REFUND:${o.id}` });
            else
                await this.engagement.notify(o.sub, { kind: 'PHARMACY_ORDER_DISPENSED', dedupeKey: `PHARMACY_ORDER_DISPENSED:${o.id}` });
        }
        return calc;
    }
    async resolvePartial(id, actor, body) {
        const o = await this.prisma.pharmacyOrder.findUnique({ where: { id } });
        if (!o)
            throw (0, errors_1.notFound)('ORDER_NOT_FOUND', 'Order not found');
        if (o.status !== 'PARTIAL_REVIEW')
            throw (0, errors_1.conflict)('NOT_IN_PARTIAL_REVIEW', `Order is ${o.status}`);
        const pending = (o.settlement ?? {});
        const dispensed = body.lines ?? pending.reportedLines;
        if (!dispensed?.length)
            throw (0, errors_1.badRequest)('LINES_REQUIRED', 'Provide the dispensed quantity per sku (the pharmacy did not report lines)');
        const calc = await this.settlePartial(o, { dispensed, deliveryMade: body.deliveryMade ?? pending.deliveryMade ?? undefined, dispensedAt: o.dispensedAt ?? new Date() }, ['PARTIAL_REVIEW'], actor);
        return { order: await this.get(o.sub, o.id), refundTotalMinor: calc.refundTotalMinor };
    }
    async cancel(sub, id) {
        const o = await this.owned(sub, id);
        if (o.status === 'PENDING_PAYMENT') {
            await this.moveAndRefund(o, ['PENDING_PAYMENT'], 'CANCELLED');
            return this.get(sub, id);
        }
        if (!['PAID', 'SUBMITTED'].includes(o.status))
            throw (0, errors_1.conflict)('ORDER_NOT_CANCELLABLE', `Order is ${o.status}`);
        if (o.partnerOrderId) {
            try {
                await this.client.cancelOrder(o.partnerOrderId, 'PATIENT_CANCELLED', o.registrationId);
            }
            catch (e) {
                if (e instanceof partner_http_1.PartnerHttpError)
                    throw (0, errors_1.conflict)('ORDER_NOT_CANCELLABLE', 'The pharmacy already started preparing this order');
                throw (0, errors_1.unavailable)('PHARMACY_SYSTEM_BUSY', 'Pharmacy system busy, try again shortly', { retryable: true });
            }
        }
        await this.moveAndRefund(o, ['PAID', 'SUBMITTED'], 'CANCELLED');
        return this.get(sub, id);
    }
    async resubmit(id) { return { status: await this.submit(id) }; }
};
exports.PharmacyService = PharmacyService;
exports.PharmacyService = PharmacyService = __decorate([
    (0, common_1.Injectable)(),
    __param(9, (0, common_1.Optional)()),
    __param(9, (0, common_1.Inject)(growth_ports_public_1.PRODUCT_GROWTH)),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, pharmacy_client_1.PharmacyClient, pay_public_1.PayService, records_public_1.RecordsService,
        patient_public_1.PatientService, engagement_public_1.EngagementService, policy_public_1.PolicyService,
        partners_public_1.PartnerRouting, partners_public_1.PartnerRegistry, Object])
], PharmacyService);
//# sourceMappingURL=pharmacy.service.js.map