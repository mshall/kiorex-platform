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
exports.PayService = exports.PAYABLE_CURRENCIES = exports.MAX_AMOUNT_MINOR = void 0;
exports.assertPayableAmount = assertPayableAmount;
exports.assertPayableCurrency = assertPayableCurrency;
const common_1 = require("@nestjs/common");
const client_1 = require("../prisma/generated/client");
const config_1 = require("../common/config");
const errors_1 = require("../common/errors");
const ids_1 = require("../common/ids");
const control_plane_public_1 = require("../control-plane/control-plane-public");
const kiorly_public_1 = require("../kiorly/kiorly-public");
const growth_ports_public_1 = require("../growth/growth-ports-public");
const outbox_public_1 = require("../outbox/outbox-public");
const market_public_1 = require("../market/market-public");
const prisma_service_1 = require("../prisma/prisma.service");
const ledger_1 = require("./ledger");
const refund_allocation_1 = require("./refund-allocation");
const psp_1 = require("./psp");
const isoWeek = (d) => {
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return `${t.getUTCFullYear()}-W${String(Math.ceil(((t.getTime() - y0.getTime()) / 86400000 + 1) / 7)).padStart(2, '0')}`;
};
exports.MAX_AMOUNT_MINOR = 2_147_483_647;
exports.PAYABLE_CURRENCIES = [...new Set(Object.values(market_public_1.MARKET_FACTS).map((m) => m.currency))];
function assertPayableAmount(amountMinor) {
    if (typeof amountMinor !== 'number' || !Number.isSafeInteger(amountMinor) || amountMinor <= 0 || amountMinor > exports.MAX_AMOUNT_MINOR)
        throw (0, errors_1.badRequest)('INVALID_AMOUNT', `amount must be a whole number of minor units between 1 and ${exports.MAX_AMOUNT_MINOR}`);
}
function assertPayableCurrency(currency) {
    if (typeof currency !== 'string' || !exports.PAYABLE_CURRENCIES.includes(currency))
        throw (0, errors_1.badRequest)('UNSUPPORTED_CURRENCY', `currency must be one of ${exports.PAYABLE_CURRENCIES.join(', ')} (uppercase ISO 4217)`);
}
let PayService = class PayService {
    prisma;
    outbox;
    kiorly;
    flags;
    rewards;
    sponsored;
    timer;
    orderHandlers = new Map();
    constructor(prisma, outbox, kiorly, flags, rewards, sponsored) {
        this.prisma = prisma;
        this.outbox = outbox;
        this.kiorly = kiorly;
        this.flags = flags;
        this.rewards = rewards;
        this.sponsored = sponsored;
    }
    heldMinor(p) { return p.amountMinor - p.refundedMinor + (p.rewardPostedMinor ?? 0) + (p.sponsoredPostedMinor ?? 0); }
    onModuleInit() {
        this.outbox.register('kiorly.deposit_paid', (e) => this.notifyKiorlyDeposit(e.payload));
        this.outbox.register('kiorly.payout_recorded', (e) => this.notifyKiorlyPayout(e.payload));
        this.outbox.register('pay.refund_requested', (e) => this.settleRefund(e.payload.refundId));
        this.outbox.register('pay.refund_settled', async () => undefined);
        this.outbox.register('pay.refund_credit_expired', async (e) => { await this.refundCreditExpired(e.payload); });
        this.outbox.register('pay.order_captured', async (e) => {
            const fn = this.orderHandlers.get(e.payload.purpose);
            if (!fn)
                throw new Error(`no order handler for purpose ${e.payload.purpose}`);
            await fn(e.payload);
        });
        if ((0, config_1.cfg)().jobsEnabled) {
            this.timer = setInterval(() => {
                const n = new Date();
                if (n.getUTCDay() === 0 && n.getUTCHours() === 6)
                    void this.runPayouts().catch(() => undefined);
                if (n.getUTCHours() === 1)
                    void this.reconcileDaily().catch(() => undefined);
            }, 3600_000);
            this.timer.unref();
        }
    }
    onModuleDestroy() { if (this.timer)
        clearInterval(this.timer); }
    async postLedger(tx, t) {
        (0, ledger_1.assertValid)(t.postings);
        const exists = await tx.ledgerTx.findUnique({ where: { idempotencyKey: t.key } });
        if (exists)
            return false;
        await tx.ledgerTx.create({
            data: { idempotencyKey: t.key, kind: t.kind, bookingId: t.bookingId ?? undefined, paymentId: t.paymentId, clinicId: t.clinicId, entries: { create: t.postings.map((p) => ({ account: p.account, debitMinor: p.debit, creditMinor: p.credit })) } },
        });
        return true;
    }
    async createDepositIntent(i) {
        assertPayableAmount(i.amountMinor);
        assertPayableCurrency(i.currency);
        return this.prisma.$transaction(async (tx) => {
            await tx.$executeRaw `SELECT pg_advisory_xact_lock(hashtext(${`deposit-intent:${i.bookingId}`}))`;
            const existing = await tx.paymentIntent.findFirst({ where: { bookingId: i.bookingId, status: { in: ['CREATED', 'CAPTURED'] } } });
            if (existing)
                return existing;
            const id = (0, ids_1.newId)('pay');
            const adapter = (0, psp_1.pspAdapter)(i.psp ?? 'paymob');
            const co = await adapter.createCheckout({ paymentId: id, amountMinor: i.amountMinor, currency: i.currency });
            return tx.paymentIntent.create({ data: { id, bookingId: i.bookingId, sub: i.sub, clinicId: i.clinicId, amountMinor: i.amountMinor, currency: i.currency, psp: adapter.name, pspRef: co.pspRef, checkoutUrl: co.checkoutUrl, rewardMinor: i.rewardMinor ?? 0, sponsoredMinor: i.sponsoredMinor ?? 0 } });
        }, { timeout: 20_000 });
    }
    async createDepositIntentWithRewards(i) {
        const open = await this.prisma.paymentIntent.findFirst({ where: { bookingId: i.bookingId, status: { in: ['CREATED', 'CAPTURED'] } } });
        if (open)
            return { intent: open, rewardMinor: open.rewardMinor, sponsoredMinor: open.sponsoredMinor, lines: this.depositLines(open) };
        const line = i.amountMinor > 1 ? await this.sponsored?.lineForDeposit(i.bookingId).catch(() => null) : null;
        const sponsoredMinor = line && line.currency === i.currency ? Math.min(line.amountMinor, i.amountMinor - 1) : 0;
        const payable = i.amountMinor - sponsoredMinor;
        if (!this.rewards) {
            const intent = await this.createDepositIntent({ ...i, amountMinor: payable, sponsoredMinor });
            return { intent, rewardMinor: 0, sponsoredMinor: intent.sponsoredMinor, lines: this.depositLines(intent) };
        }
        const r = await this.rewards.reserveForDeposit({ sub: i.sub, bookingId: i.bookingId, amountMinor: payable, sponsoredMinor, currency: i.currency, serviceKind: i.serviceKind, specialty: i.specialty, dependantId: i.dependantId, couponCode: i.couponCode, lotId: i.lotId });
        try {
            const intent = await this.createDepositIntent({ ...i, amountMinor: payable - r.appliedMinor, rewardMinor: r.appliedMinor, sponsoredMinor });
            const same = intent.rewardMinor === r.appliedMinor && intent.sponsoredMinor === sponsoredMinor;
            return { intent, rewardMinor: intent.rewardMinor, sponsoredMinor: intent.sponsoredMinor, lines: same ? r.lines : this.depositLines(intent), ...(r.couponProblem ? { couponProblem: r.couponProblem } : {}) };
        }
        catch (e) {
            await this.rewards.releaseForBooking(i.bookingId, 'INTENT_NOT_CREATED').catch(() => undefined);
            throw e;
        }
    }
    depositLines(p) {
        return [{ code: 'PRICE', amountMinor: p.amountMinor + p.rewardMinor + p.sponsoredMinor, labelKey: 'checkout.price' },
            ...(p.sponsoredMinor > 0 ? [{ code: 'SPONSORED_DISCOUNT', amountMinor: -p.sponsoredMinor, labelKey: 'checkout.sponsored' }] : []),
            ...(p.rewardMinor > 0 ? [{ code: 'PATIENT_CREDIT', amountMinor: -p.rewardMinor, labelKey: 'checkout.credit' }] : []),
            { code: 'CARD', amountMinor: p.amountMinor, labelKey: 'checkout.card' }];
    }
    onOrderCaptured(purpose, fn) { this.orderHandlers.set(purpose, fn); }
    async createOrderIntent(i) {
        assertPayableAmount(i.amountMinor);
        assertPayableCurrency(i.currency);
        return this.prisma.$transaction(async (tx) => {
            await tx.$executeRaw `SELECT pg_advisory_xact_lock(hashtext(${`order-intent:${i.purpose}:${i.orderRef}`}))`;
            const existing = await tx.paymentIntent.findFirst({ where: { orderRef: i.orderRef, purpose: i.purpose, status: { in: ['CREATED', 'CAPTURED'] } } });
            if (existing)
                return existing;
            const id = (0, ids_1.newId)('pay');
            const adapter = (0, psp_1.pspAdapter)(i.psp ?? 'paymob');
            const co = await adapter.createCheckout({ paymentId: id, amountMinor: i.amountMinor, currency: i.currency });
            return tx.paymentIntent.create({ data: { id, orderRef: i.orderRef, purpose: i.purpose, sub: i.sub, clinicId: i.partnerId, amountMinor: i.amountMinor, currency: i.currency, psp: adapter.name, pspRef: co.pspRef, checkoutUrl: co.checkoutUrl } });
        }, { timeout: 20_000 });
    }
    async releaseOrder(paymentId, o, outer) {
        const run = (fn) => (outer ? fn(outer) : this.prisma.$transaction(fn));
        const p = await (outer ?? this.prisma).paymentIntent.findUnique({ where: { id: paymentId } });
        if (!p)
            throw (0, errors_1.notFound)('PAYMENT_NOT_FOUND', 'Payment not found');
        if (!['CAPTURED', 'PARTIALLY_REFUNDED'].includes(p.status) || p.releasedAt)
            return null;
        const net = p.amountMinor - p.refundedMinor;
        if (net <= 0)
            return null;
        await run(async (tx) => {
            const c = await tx.paymentIntent.updateMany({ where: { id: p.id, releasedAt: null }, data: { releasedAt: new Date(), releaseKind: 'COMPLETED' } });
            if (c.count)
                await this.postLedger(tx, { key: `release-order:${p.id}`, kind: `RELEASE_ORDER_${p.purpose}`, postings: (0, ledger_1.releaseOrder)(p.clinicId, net, Math.min(Math.max(o.feeMinor, 0), net)), paymentId: p.id, clinicId: p.clinicId });
        });
        return 'RELEASED';
    }
    async refundOrder(paymentId, reason, tx) {
        const db = tx ?? this.prisma;
        const p = await db.paymentIntent.findUnique({ where: { id: paymentId } });
        if (!p)
            throw (0, errors_1.notFound)('PAYMENT_NOT_FOUND', 'Payment not found');
        if (p.status === 'CREATED') {
            await db.paymentIntent.update({ where: { id: p.id }, data: { status: 'FAILED' } });
            return null;
        }
        if (!['CAPTURED', 'PARTIALLY_REFUNDED'].includes(p.status) || p.releasedAt)
            return null;
        return this.refund(p.id, { reason, idempotencyKey: `refund-order:${p.id}:${reason}` }, tx);
    }
    async getIntent(id) {
        const p = await this.prisma.paymentIntent.findUnique({ where: { id } });
        if (!p)
            throw (0, errors_1.notFound)('PAYMENT_NOT_FOUND', 'Payment not found');
        return p;
    }
    async intentForBooking(bookingId) {
        return this.prisma.paymentIntent.findFirst({ where: { bookingId }, orderBy: { createdAt: 'desc' } });
    }
    async handlePspWebhook(psp, rawBody, headers, query = {}) {
        let ev;
        try {
            ev = (0, psp_1.pspAdapter)(psp).verifyWebhook(rawBody, headers, query);
        }
        catch {
            throw (0, errors_1.badRequest)('INVALID_PSP_PAYLOAD', 'PSP payload could not be parsed');
        }
        if (!ev)
            throw (0, errors_1.badRequest)('INVALID_PSP_SIGNATURE', 'PSP signature rejected');
        if (!ev || typeof ev !== 'object' || typeof ev.eventId !== 'string' || !ev.eventId || !['payment.captured', 'payment.failed', 'refund.settled'].includes(ev.type) || !Number.isSafeInteger(ev.amountMinor) || ev.amountMinor < 0)
            throw (0, errors_1.badRequest)('INVALID_PSP_PAYLOAD', 'PSP event is missing eventId, type or a whole-number amountMinor');
        const eventId = `psp:${ev.eventId}`;
        try {
            await this.prisma.webhookReceipt.create({ data: { eventId, source: `psp:${psp}`, type: ev.type, aggregateId: ev.paymentId ?? ev.pspRef, payload: JSON.parse(rawBody), status: 'PROCESSED', processedAt: new Date() } });
        }
        catch (e) {
            if (e.code === 'P2002')
                return { status: 'DUPLICATE' };
            throw e;
        }
        try {
            if (ev.type === 'payment.captured')
                return { status: await this.capturePayment(ev) };
            if (ev.type === 'payment.failed') {
                const failed = await this.prisma.paymentIntent.findMany({ where: { OR: [{ id: ev.paymentId ?? '-' }, { pspRef: ev.pspRef }], status: 'CREATED' }, select: { bookingId: true } });
                await this.prisma.paymentIntent.updateMany({ where: { OR: [{ id: ev.paymentId ?? '-' }, { pspRef: ev.pspRef }], status: 'CREATED' }, data: { status: 'FAILED' } });
                for (const f of failed)
                    if (f.bookingId && this.rewards)
                        await this.rewards.releaseForBooking(f.bookingId, 'PAYMENT_FAILED');
                return { status: 'FAILED_RECORDED' };
            }
            return { status: await this.settleRefundFromWebhook(ev) };
        }
        catch (e) {
            await this.prisma.webhookReceipt.delete({ where: { eventId } }).catch(() => undefined);
            throw e;
        }
    }
    async capturePayment(ev) {
        const p = await this.prisma.paymentIntent.findFirst({ where: { OR: [{ id: ev.paymentId ?? '-' }, { pspRef: ev.pspRef }] } });
        if (!p)
            throw (0, errors_1.notFound)('PAYMENT_NOT_FOUND', 'Unknown payment');
        if (p.status === 'CAPTURED' || p.status === 'REFUNDED' || p.status === 'PARTIALLY_REFUNDED')
            return 'ALREADY_CAPTURED';
        if (ev.amountMinor !== p.amountMinor) {
            await this.prisma.auditLog.create({ data: { actor: 'psp', action: 'pay.amount_mismatch', resource: 'PaymentIntent', resourceId: p.id, metadata: { expected: p.amountMinor, got: ev.amountMinor } } });
            throw (0, errors_1.conflict)('AMOUNT_MISMATCH', 'Captured amount does not match intent');
        }
        if (ev.currency && ev.currency !== p.currency) {
            await this.prisma.auditLog.create({ data: { actor: 'psp', action: 'pay.currency_mismatch', resource: 'PaymentIntent', resourceId: p.id, metadata: { expected: p.currency, got: ev.currency } } });
            throw (0, errors_1.conflict)('CURRENCY_MISMATCH', 'Captured currency does not match intent');
        }
        const fee = ev.feeMinor ?? Math.round((p.amountMinor * (0, config_1.cfg)().pspFeeBps) / 10000);
        const postSponsored = p.sponsoredMinor > 0 && !!this.rewards && (await this.rewards.postToPayLedger().catch(() => false));
        await this.prisma.$transaction(async (tx) => {
            const claimed = await tx.paymentIntent.updateMany({ where: { id: p.id, status: { in: ['CREATED', 'FAILED'] } }, data: { status: 'CAPTURED', capturedAt: new Date(ev.occurredAt), feeMinor: fee } });
            if (!claimed.count)
                return;
            if (p.payLinkToken)
                await tx.payLink.updateMany({ where: { token: p.payLinkToken }, data: { status: 'PAID' } });
            await this.postLedger(tx, { key: `capture:${p.id}`, kind: 'CAPTURE', postings: (0, ledger_1.capture)(p.clinicId, p.amountMinor), bookingId: p.bookingId, paymentId: p.id, clinicId: p.clinicId });
            if (p.rewardMinor > 0 && p.bookingId && this.rewards) {
                const red = await this.rewards.redeemOnCapture(tx, { bookingId: p.bookingId, paymentId: p.id });
                if (red.totalMinor !== p.rewardMinor)
                    await tx.auditLog.create({ data: { actor: 'system', action: 'pay.reward_mismatch', resource: 'PaymentIntent', resourceId: p.id, metadata: { expected: p.rewardMinor, redeemed: red.totalMinor } } });
                const posted = red.postedMinor;
                if (posted > 0)
                    await this.postLedger(tx, { key: `reward-tender:${p.id}`, kind: 'REWARD_TENDER', postings: (0, ledger_1.rewardTender)(p.clinicId, red.patientRefundMinor, posted - red.patientRefundMinor), bookingId: p.bookingId, paymentId: p.id, clinicId: p.clinicId });
                await tx.paymentIntent.update({ where: { id: p.id }, data: { rewardMinor: red.totalMinor, rewardPostedMinor: posted } });
            }
            if (postSponsored && p.bookingId) {
                await this.postLedger(tx, { key: `sponsor-tender:${p.id}`, kind: 'SPONSOR_FUNDED', postings: (0, ledger_1.sponsorTender)(p.clinicId, p.sponsoredMinor), bookingId: p.bookingId, paymentId: p.id, clinicId: p.clinicId });
                await tx.paymentIntent.update({ where: { id: p.id }, data: { sponsoredPostedMinor: p.sponsoredMinor } });
            }
            if (fee > 0)
                await this.postLedger(tx, { key: `fee:${p.id}`, kind: 'PSP_FEE', postings: (0, ledger_1.pspFee)(fee), paymentId: p.id, clinicId: p.clinicId });
            if (p.purpose !== 'DEPOSIT') {
                await this.outbox.enqueue(tx, { type: 'pay.order_captured', aggregateType: 'PaymentIntent', aggregateId: p.id, payload: { paymentId: p.id, purpose: p.purpose, orderRef: p.orderRef, amountMinor: p.amountMinor }, dedupeKey: `pay.order_captured:${p.id}` });
                return;
            }
            await this.outbox.enqueue(tx, { type: 'kiorly.deposit_paid', target: 'KIORLY', aggregateType: 'PaymentIntent', aggregateId: p.id, payload: { paymentId: p.id }, dedupeKey: `kiorly.deposit_paid:${p.id}` });
            await this.outbox.enqueue(tx, { type: 'pay.deposit_captured', aggregateType: 'PaymentIntent', aggregateId: p.id, payload: { paymentId: p.id, bookingId: p.bookingId, amountMinor: p.amountMinor }, dedupeKey: `pay.deposit_captured:${p.id}` });
        });
        return 'CAPTURED';
    }
    async notifyKiorlyDeposit(payload) {
        const p = await this.getIntent(payload.paymentId);
        const body = { amount: (0, ids_1.toMajor)(p.amountMinor + p.rewardMinor + p.sponsoredMinor), currency: p.currency, paymentRef: p.id, paidAt: (p.capturedAt ?? new Date()).toISOString(), ...(p.rewardMinor > 0 || p.sponsoredMinor > 0 ? { tender: { cardMinor: p.amountMinor, patientCreditMinor: p.rewardMinor, ...(p.sponsoredMinor > 0 ? { sponsoredDiscountMinor: p.sponsoredMinor } : {}) } } : {}) };
        try {
            if (p.bookingId)
                await this.kiorly.depositPaid(p.bookingId, body);
            else if (p.payLinkToken)
                await this.kiorly.depositLinkPaid(p.payLinkToken, body);
        }
        catch (e) {
            if (!(e instanceof kiorly_public_1.KiorlyHttpError && e.status === 409))
                throw e;
        }
        await this.prisma.paymentIntent.update({ where: { id: p.id }, data: { kiorlyNotified: true } });
    }
    async refund(paymentId, o, outer) {
        const existing = await (outer ?? this.prisma).refund.findUnique({ where: { idempotencyKey: o.idempotencyKey } });
        if (existing)
            return existing;
        const run = (fn) => (outer ? fn(outer) : this.prisma.$transaction(fn));
        return run(async (tx) => {
            const rows = await tx.$queryRaw(client_1.Prisma.sql `SELECT * FROM "PaymentIntent" WHERE id = ${paymentId} FOR UPDATE`);
            const p = rows[0];
            if (!p)
                throw (0, errors_1.notFound)('PAYMENT_NOT_FOUND', 'Payment not found');
            if (!['CAPTURED', 'PARTIALLY_REFUNDED'].includes(p.status))
                throw (0, errors_1.conflict)('NOT_REFUNDABLE', `Payment is ${p.status}`);
            if (p.releasedAt)
                throw (0, errors_1.conflict)('ALREADY_RELEASED', 'Payment was already released to the provider; a refund needs a payout reversal, not a refund request');
            const remaining = p.amountMinor - p.refundedMinor;
            const amount = o.amountMinor ?? remaining;
            if (amount <= 0 || amount > remaining)
                throw (0, errors_1.badRequest)('REFUND_EXCEEDS_CAPTURE', 'Refund exceeds remaining captured amount', { remaining });
            const refund = await tx.refund.create({ data: { id: (0, ids_1.newId)('rf'), paymentId, amountMinor: amount, reason: o.reason, idempotencyKey: o.idempotencyKey } });
            await tx.paymentIntent.update({ where: { id: paymentId }, data: { refundedMinor: p.refundedMinor + amount, status: p.refundedMinor + amount === p.amountMinor ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } });
            const heldForReview = p.reviewState === 'HELD_FOR_REVIEW';
            await this.postLedger(tx, { key: `refund-req:${refund.id}`, kind: heldForReview ? 'REVIEW_REFUND_REQUEST' : 'REFUND_REQUEST', postings: heldForReview ? (0, ledger_1.refundFromReview)(p.clinicId, amount) : (0, ledger_1.refundRequest)(p.clinicId, amount), bookingId: p.bookingId, paymentId, clinicId: p.clinicId });
            if (heldForReview && p.refundedMinor + amount === p.amountMinor) {
                await tx.paymentIntent.update({ where: { id: paymentId }, data: { reviewState: 'REFUNDED_TO_PATIENT', reviewedAt: new Date(), reviewedBy: o.reviewedBy ?? 'system' } });
                await this.outbox.enqueue(tx, { type: 'pay.review_resolved', aggregateType: 'PaymentIntent', aggregateId: paymentId, payload: { paymentId, bookingId: p.bookingId, outcome: 'REFUNDED' }, dedupeKey: `pay.review_resolved:${paymentId}` });
            }
            if (this.rewards && p.bookingId && p.sub && (p.rewardMinor > 0 || o.source)) {
                const destination = o.destination === 'CREDIT' && o.source && (await this.rewards.refundCreditAvailable()) ? 'CREDIT' : 'ORIGINAL';
                const res = await this.rewards.onRefundCreated(tx, { bookingId: p.bookingId, sub: p.sub, paymentId, refundId: refund.id, cardRefundMinor: amount, paymentCardMinor: p.amountMinor, paymentRewardMinor: p.rewardMinor, paymentRewardPostedMinor: p.rewardPostedMinor, alreadyRefundedMinor: p.refundedMinor, destination, source: o.source ?? null, currency: p.currency });
                if (res.postedRestoredMinor > 0) {
                    const patientPart = Math.min(res.patientRefundRestoredMinor, res.postedRestoredMinor);
                    await this.postLedger(tx, { key: `reward-restore:${refund.id}`, kind: 'REWARD_RESTORE', postings: (0, ledger_1.rewardRestore)(heldForReview ? ledger_1.A.reviewHold(p.clinicId) : ledger_1.A.held(p.clinicId), patientPart, res.postedRestoredMinor - patientPart), bookingId: p.bookingId, paymentId, clinicId: p.clinicId });
                    await tx.paymentIntent.update({ where: { id: paymentId }, data: { rewardPostedMinor: p.rewardPostedMinor - res.postedRestoredMinor } });
                }
            }
            if (p.sponsoredMinor > 0) {
                const voided = (0, refund_allocation_1.sponsoredVoidedByRefund)({ sponsoredMinor: p.sponsoredMinor, cardMinor: p.amountMinor, cardRefundedAfterMinor: p.refundedMinor + amount, alreadyVoidedMinor: p.sponsoredVoidedMinor });
                const postedVoid = Math.min(voided, p.sponsoredPostedMinor);
                if (postedVoid > 0)
                    await this.postLedger(tx, { key: `sponsor-void:${refund.id}`, kind: 'SPONSOR_VOID', postings: (0, ledger_1.sponsorVoid)(heldForReview ? ledger_1.A.reviewHold(p.clinicId) : ledger_1.A.held(p.clinicId), postedVoid), bookingId: p.bookingId, paymentId, clinicId: p.clinicId });
                if (voided > 0)
                    await tx.paymentIntent.update({ where: { id: paymentId }, data: { sponsoredVoidedMinor: p.sponsoredVoidedMinor + voided, sponsoredPostedMinor: p.sponsoredPostedMinor - postedVoid } });
            }
            await this.outbox.enqueue(tx, { type: 'pay.refund_requested', aggregateType: 'Refund', aggregateId: refund.id, payload: { refundId: refund.id }, dedupeKey: `pay.refund_requested:${refund.id}` });
            return refund;
        });
    }
    async settleRefund(refundId) {
        const r = await this.prisma.refund.findUnique({ where: { id: refundId }, include: { payment: true } });
        if (!r || r.status === 'SETTLED' || r.status === 'CREDITED')
            return;
        const choice = this.rewards ? await this.prisma.refundDestinationChoice.findUnique({ where: { refundId } }) : null;
        if (choice?.choice === 'CREDIT' && this.rewards) {
            const lot = await this.rewards.issueRefundCredit({ sub: choice.sub, bookingId: r.payment.bookingId, refundId, amountMinor: r.amountMinor, currency: r.payment.currency });
            if (lot) {
                await this.finalizeRefundAsCredit(r, lot.lotId);
                return;
            }
            await this.prisma.auditLog.create({ data: { actor: 'system', action: 'pay.refund_credit_unavailable', resource: 'Refund', resourceId: refundId, metadata: { fallback: 'ORIGINAL' } } });
        }
        const out = await (0, psp_1.pspAdapter)(r.payment.psp).refund({ pspRef: r.payment.pspRef ?? '', refundId: r.id, amountMinor: r.amountMinor });
        await this.finalizeRefund(r, out.pspRefundRef);
    }
    async finalizeRefundAsCredit(r, lotId) {
        await this.prisma.$transaction(async (tx) => {
            await this.postLedger(tx, { key: `refund-credit:${r.id}`, kind: 'REFUND_TO_CREDIT', postings: (0, ledger_1.refundToCredit)(r.amountMinor), bookingId: r.payment.bookingId, paymentId: r.paymentId, clinicId: r.payment.clinicId });
            await tx.refund.update({ where: { id: r.id }, data: { status: 'CREDITED', settledAt: new Date() } });
            await this.outbox.enqueue(tx, { type: 'pay.refund_settled', aggregateType: 'Refund', aggregateId: r.id, payload: { refundId: r.id, bookingId: r.payment.bookingId, amountMinor: r.amountMinor, destination: 'CREDIT', lotId }, dedupeKey: `pay.refund_settled:${r.id}` });
        });
    }
    async refundCreditExpired(payload) {
        const issue = await this.prisma.rewardLedgerEntry.findFirst({ where: { lotId: payload.lotId, type: 'ISSUE', refundId: { not: null } } });
        const source = issue?.refundId ? await this.prisma.refund.findUnique({ where: { id: issue.refundId }, include: { payment: true } }) : null;
        if (!source) {
            await this.prisma.auditLog.create({ data: { actor: 'system', action: 'pay.refund_credit_expiry_no_source', resource: 'RewardLot', resourceId: payload.lotId, metadata: { amountMinor: payload.amountMinor } } });
            return;
        }
        const key = `refund-credit-expiry:${payload.lotId}:${payload.amountMinor}`;
        const existing = await this.prisma.refund.findUnique({ where: { idempotencyKey: key } });
        if (existing) {
            await this.settleRefund(existing.id);
            return;
        }
        const rf = await this.prisma.$transaction(async (tx) => {
            const created = await tx.refund.create({ data: { id: (0, ids_1.newId)('rf'), paymentId: source.paymentId, amountMinor: payload.amountMinor, reason: 'REFUND_CREDIT_EXPIRED', idempotencyKey: key } });
            await this.postLedger(tx, { key: `refund-credit-expiry:${created.id}`, kind: 'REFUND_CREDIT_EXPIRED', postings: (0, ledger_1.refundCreditExpired)(payload.amountMinor), bookingId: source.payment.bookingId, paymentId: source.paymentId, clinicId: source.payment.clinicId });
            await this.outbox.enqueue(tx, { type: 'pay.refund_requested', aggregateType: 'Refund', aggregateId: created.id, payload: { refundId: created.id }, dedupeKey: `pay.refund_requested:${created.id}` });
            return created;
        });
        return rf;
    }
    async finalizeRefund(r, pspRefundRef) {
        await this.prisma.$transaction(async (tx) => {
            await this.postLedger(tx, { key: `refund-settle:${r.id}`, kind: 'REFUND_SETTLED', postings: (0, ledger_1.refundSettle)(r.amountMinor), bookingId: r.payment.bookingId, paymentId: r.paymentId, clinicId: r.payment.clinicId });
            await tx.refund.update({ where: { id: r.id }, data: { status: 'SETTLED', pspRefundRef, settledAt: new Date() } });
            await this.outbox.enqueue(tx, { type: 'pay.refund_settled', aggregateType: 'Refund', aggregateId: r.id, payload: { refundId: r.id, bookingId: r.payment.bookingId, amountMinor: r.amountMinor }, dedupeKey: `pay.refund_settled:${r.id}` });
        });
    }
    async settleRefundFromWebhook(ev) {
        const r = await this.prisma.refund.findFirst({
            where: { OR: [{ pspRefundRef: ev.pspRef }, ...(ev.paymentId ? [{ paymentId: ev.paymentId, status: 'REQUESTED' }] : [])] },
            include: { payment: true }, orderBy: { createdAt: 'desc' },
        });
        if (!r)
            return 'REFUND_NOT_FOUND';
        if (r.status === 'SETTLED')
            return 'ALREADY_SETTLED';
        await this.finalizeRefund(r, ev.pspRef || r.pspRefundRef || `webhook_${r.id}`);
        return 'REFUND_SETTLED';
    }
    async refundForBooking(bookingId, reason, opts = {}) {
        const p = await this.intentForBooking(bookingId);
        if (!p)
            return null;
        if (p.status === 'CREATED') {
            await this.prisma.paymentIntent.update({ where: { id: p.id }, data: { status: 'FAILED' } });
            await this.rewards?.releaseForBooking(bookingId, 'BOOKING_ENDED');
            return null;
        }
        if (p.status !== 'CAPTURED' && p.status !== 'PARTIALLY_REFUNDED')
            return null;
        if (p.releasedAt)
            return null;
        if (p.reviewState === 'HELD_FOR_REVIEW')
            return null;
        return this.refund(p.id, { reason, idempotencyKey: `refund:${bookingId}:${reason}`, ...(opts.source ? { destination: opts.destination ?? 'ORIGINAL', source: opts.source } : {}) });
    }
    async releaseForBooking(bookingId, kind) {
        const p = await this.intentForBooking(bookingId);
        if (!p || p.status !== 'CAPTURED' || p.releasedAt)
            return null;
        if (p.reviewState === 'HELD_FOR_REVIEW')
            return null;
        const unwind = kind === 'FORFEITED' ? p.sponsoredPostedMinor : 0;
        const n = this.heldMinor(p) - unwind;
        await this.prisma.$transaction(async (tx) => {
            const c = await tx.paymentIntent.updateMany({ where: { id: p.id, releasedAt: null }, data: { releasedAt: new Date(), releaseKind: kind } });
            if (!c.count)
                return;
            if (unwind > 0) {
                await this.postLedger(tx, { key: `sponsor-void-forfeit:${p.id}`, kind: 'SPONSOR_VOID', postings: (0, ledger_1.sponsorVoid)(ledger_1.A.held(p.clinicId), unwind), bookingId, paymentId: p.id, clinicId: p.clinicId });
                await tx.paymentIntent.update({ where: { id: p.id }, data: { sponsoredPostedMinor: 0, sponsoredVoidedMinor: p.sponsoredVoidedMinor + unwind } });
            }
            if (n > 0)
                await this.postLedger(tx, { key: `release:${p.id}`, kind: `RELEASE_${kind}`, postings: (0, ledger_1.release)(p.clinicId, n), bookingId, paymentId: p.id, clinicId: p.clinicId });
        });
        return kind;
    }
    async holdForReview(bookingId, reason) {
        const p = await this.intentForBooking(bookingId);
        if (!p)
            return null;
        if (p.status === 'CREATED') {
            await this.prisma.paymentIntent.update({ where: { id: p.id }, data: { status: 'FAILED' } });
            await this.rewards?.releaseForBooking(bookingId, 'BOOKING_ENDED');
            return null;
        }
        if (!['CAPTURED', 'PARTIALLY_REFUNDED'].includes(p.status) || p.releasedAt)
            return null;
        const n = this.heldMinor(p);
        if (n <= 0)
            return null;
        return this.prisma.$transaction(async (tx) => {
            const claimed = await tx.paymentIntent.updateMany({ where: { id: p.id, reviewState: null, releasedAt: null }, data: { reviewState: 'HELD_FOR_REVIEW', heldForReviewAt: new Date(), reviewReason: reason } });
            if (!claimed.count)
                return p;
            await this.postLedger(tx, { key: `hold-review:${p.id}`, kind: 'HOLD_FOR_REVIEW', postings: (0, ledger_1.holdForReview)(p.clinicId, n), bookingId, paymentId: p.id, clinicId: p.clinicId });
            await tx.auditLog.create({ data: { actor: 'system', action: 'pay.hold_for_review', resource: 'PaymentIntent', resourceId: p.id, metadata: { bookingId, reason, amountMinor: n } } });
            return tx.paymentIntent.findUniqueOrThrow({ where: { id: p.id } });
        });
    }
    async reviewRelease(paymentId, actor, reason) {
        if (!reason?.trim())
            throw (0, errors_1.badRequest)('REASON_REQUIRED', 'A review decision needs a reason');
        return this.prisma.$transaction(async (tx) => {
            const rows = await tx.$queryRaw(client_1.Prisma.sql `SELECT * FROM "PaymentIntent" WHERE id = ${paymentId} FOR UPDATE`);
            const p = rows[0];
            if (!p)
                throw (0, errors_1.notFound)('PAYMENT_NOT_FOUND', 'Payment not found');
            if (p.reviewState !== 'HELD_FOR_REVIEW')
                throw (0, errors_1.conflict)('NOT_HELD_FOR_REVIEW', `Payment review state is ${p.reviewState ?? 'none'}`);
            const n = this.heldMinor(p);
            await this.postLedger(tx, { key: `review-release:${p.id}`, kind: 'REVIEW_RELEASE', postings: (0, ledger_1.releaseFromReview)(p.clinicId, n), bookingId: p.bookingId, paymentId: p.id, clinicId: p.clinicId });
            await tx.paymentIntent.update({ where: { id: p.id }, data: { reviewState: 'RELEASED_TO_PROVIDER', reviewedBy: actor, reviewedAt: new Date(), reviewReason: `${p.reviewReason ?? ''} | ${reason}`.slice(0, 500), releasedAt: new Date(), releaseKind: 'REVIEW_RELEASED' } });
            await tx.auditLog.create({ data: { actor, action: 'pay.review_release', resource: 'PaymentIntent', resourceId: p.id, metadata: { reason, amountMinor: n } } });
            await this.outbox.enqueue(tx, { type: 'pay.review_resolved', aggregateType: 'PaymentIntent', aggregateId: p.id, payload: { paymentId: p.id, bookingId: p.bookingId, outcome: 'RELEASED' }, dedupeKey: `pay.review_resolved:${p.id}` });
            return { paymentId: p.id, outcome: 'RELEASED_TO_PROVIDER', amountMinor: n };
        });
    }
    async reviewRefund(paymentId, actor, reason) {
        if (!reason?.trim())
            throw (0, errors_1.badRequest)('REASON_REQUIRED', 'A review decision needs a reason');
        const p = await this.getIntent(paymentId);
        if (p.reviewState !== 'HELD_FOR_REVIEW')
            throw (0, errors_1.conflict)('NOT_HELD_FOR_REVIEW', `Payment review state is ${p.reviewState ?? 'none'}`);
        await this.prisma.auditLog.create({ data: { actor, action: 'pay.review_refund', resource: 'PaymentIntent', resourceId: p.id, metadata: { reason } } });
        await this.prisma.paymentIntent.update({ where: { id: p.id }, data: { reviewReason: `${p.reviewReason ?? ''} | ${reason}`.slice(0, 500) } });
        const refund = await this.refund(p.id, { reason: `REVIEW:${reason}`, idempotencyKey: `review-refund:${p.id}`, reviewedBy: actor });
        return { paymentId: p.id, outcome: 'REFUNDED_TO_PATIENT', refundId: refund.id, amountMinor: refund.amountMinor };
    }
    async heldForReview() {
        const rows = await this.prisma.paymentIntent.findMany({ where: { reviewState: 'HELD_FOR_REVIEW' }, orderBy: { heldForReviewAt: 'asc' }, take: 200 });
        const books = await this.prisma.bookingIntent.findMany({ where: { id: { in: rows.map((r) => r.bookingId ?? '-') } }, select: { id: true, providerId: true, visitDistrict: true, abortedAt: true, status: true, homeState: true } });
        return rows.map((p) => {
            const b = books.find((x) => x.id === p.bookingId);
            return { paymentId: p.id, bookingId: p.bookingId, clinicId: p.clinicId, amountMinor: this.heldMinor(p), currency: p.currency, reason: p.reviewReason, heldForReviewAt: p.heldForReviewAt, ageHours: p.heldForReviewAt ? Math.round(((Date.now() - p.heldForReviewAt.getTime()) / 3600_000) * 10) / 10 : null, providerId: b?.providerId ?? null, district: b?.visitDistrict ?? null, abortedAt: b?.abortedAt ?? null };
        });
    }
    async runPayouts(now = new Date()) {
        const period = isoWeek(now);
        const released = await this.prisma.paymentIntent.findMany({ where: { purpose: 'DEPOSIT', status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED'] }, releasedAt: { not: null }, payoutId: null } });
        const due = [];
        const heldBack = [];
        for (const p of released) {
            const hold = p.sponsoredPostedMinor > 0 ? (this.sponsored && p.bookingId ? await this.sponsored.payoutHoldMinor(p.bookingId, p.sponsoredPostedMinor) : p.sponsoredPostedMinor) : 0;
            if (hold > 0)
                heldBack.push({ paymentId: p.id, holdMinor: hold });
            else
                due.push(p);
        }
        const byClinic = new Map();
        for (const p of due)
            byClinic.set(p.clinicId, [...(byClinic.get(p.clinicId) ?? []), p]);
        const out = [];
        for (const [clinicId, items] of byClinic) {
            const amount = items.reduce((s, p) => s + this.heldMinor(p), 0);
            if (amount <= 0)
                continue;
            const seq = await this.prisma.payout.count({ where: { clinicId, periodKey: { startsWith: period } } });
            const periodKey = seq === 0 ? period : `${period}#${seq + 1}`;
            const payoutRef = `po_${clinicId}_${periodKey}`;
            await this.prisma.$transaction(async (tx) => {
                const id = (0, ids_1.newId)('po');
                const claimed = await tx.paymentIntent.updateMany({ where: { id: { in: items.map((i) => i.id) }, payoutId: null }, data: { payoutId: id } });
                if (claimed.count !== items.length)
                    throw (0, errors_1.conflict)('PAYOUT_RACE', 'Deposits already claimed by another payout run');
                const refs = items.map((i) => i.id);
                await tx.payout.create({ data: { id, payoutRef, clinicId, amountMinor: amount, currency: items[0].currency, periodKey, paymentRefs: refs } });
                await this.postLedger(tx, { key: `payout:${id}`, kind: 'PAYOUT', postings: (0, ledger_1.payout)(clinicId, amount), clinicId });
                await this.outbox.enqueue(tx, { type: 'kiorly.payout_recorded', target: 'KIORLY', aggregateType: 'Payout', aggregateId: id, payload: { payoutId: id }, dedupeKey: `kiorly.payout_recorded:${id}` });
            }).catch((e) => { if (e?.code === 'P2002')
                return; throw e; });
            out.push({ payoutRef, clinicId, amountMinor: amount });
        }
        return { period, payouts: out, ...(heldBack.length ? { heldBack } : {}) };
    }
    async notifyKiorlyPayout(payload) {
        const po = await this.prisma.payout.findUnique({ where: { id: payload.payoutId } });
        if (!po)
            return;
        try {
            await this.kiorly.recordPayout({ payoutRef: po.payoutRef, clinicId: po.clinicId, amount: (0, ids_1.toMajor)(po.amountMinor), currency: po.currency, paidAt: po.paidAt.toISOString(), depositPaymentRefs: po.paymentRefs });
        }
        catch (e) {
            if (!(e instanceof kiorly_public_1.KiorlyHttpError && e.status === 409))
                throw e;
        }
        await this.prisma.payout.update({ where: { id: po.id }, data: { status: 'KIORLY_RECORDED' } });
    }
    async createPayLink(i) {
        if (!i.token)
            throw (0, errors_1.badRequest)('INVALID_LINK', 'token required');
        assertPayableAmount(i.amountMinor);
        assertPayableCurrency(i.currency ?? 'EGP');
        const currency = i.currency ?? 'EGP';
        const existing = await this.prisma.payLink.findUnique({ where: { token: i.token } });
        if (existing) {
            if (existing.clinicId !== i.clinicId || existing.amountMinor !== i.amountMinor || existing.currency !== currency)
                throw (0, errors_1.conflict)('PAY_LINK_CONFLICT', 'A pay link with this token already exists with different values');
            return existing;
        }
        try {
            return await this.prisma.payLink.create({ data: { token: i.token, clinicId: i.clinicId, amountMinor: i.amountMinor, currency, externalRef: i.externalRef, expiresAt: i.expiresAt ?? new Date(Date.now() + 7 * 86400_000) } });
        }
        catch (e) {
            if (e.code === 'P2002')
                return this.createPayLink(i);
            throw e;
        }
    }
    async payLink(token) {
        const l = await this.prisma.payLink.findUnique({ where: { token } });
        if (!l)
            throw (0, errors_1.notFound)('LINK_NOT_FOUND', 'Pay link not found');
        return { token: l.token, clinicId: l.clinicId, amountMinor: l.amountMinor, currency: l.currency, status: l.expiresAt < new Date() && l.status === 'OPEN' ? 'EXPIRED' : l.status, expiresAt: l.expiresAt };
    }
    async payLinkCheckout(token) {
        await this.flags.assertEnabled('kiorex.pay_deposits', { market: 'EG' });
        return this.prisma.$transaction(async (tx) => {
            await tx.$executeRaw `SELECT pg_advisory_xact_lock(hashtext(${`pay-link:${token}`}))`;
            const l = await tx.payLink.findUnique({ where: { token } });
            if (!l || l.status !== 'OPEN' || l.expiresAt < new Date())
                throw (0, errors_1.conflict)('LINK_NOT_PAYABLE', 'Pay link is not payable');
            if (l.paymentIntentId) {
                const cur = await tx.paymentIntent.findUnique({ where: { id: l.paymentIntentId } });
                if (cur && cur.status !== 'FAILED')
                    return cur;
            }
            const id = (0, ids_1.newId)('pay');
            const a = (0, psp_1.pspAdapter)('paymob');
            const co = await a.createCheckout({ paymentId: id, amountMinor: l.amountMinor, currency: l.currency });
            const intent = await tx.paymentIntent.create({ data: { id, payLinkToken: token, clinicId: l.clinicId, amountMinor: l.amountMinor, currency: l.currency, psp: a.name, pspRef: co.pspRef, checkoutUrl: co.checkoutUrl } });
            await tx.payLink.update({ where: { token }, data: { paymentIntentId: id } });
            return intent;
        }, { timeout: 20_000 });
    }
    async fakeComplete(paymentId, outcome) {
        if ((0, config_1.cfg)().pspMode !== 'sandbox-fake' || !(0, config_1.cfg)().sandboxPaymentsAllowed)
            throw (0, errors_1.notFound)('NOT_FOUND', 'Not found');
        const p = await this.getIntent(paymentId);
        const ev = { eventId: (0, ids_1.newId)('pspev'), type: outcome === 'pay' ? 'payment.captured' : 'payment.failed', pspRef: p.pspRef ?? '', paymentId: p.id, amountMinor: p.amountMinor, feeMinor: Math.round((p.amountMinor * (0, config_1.cfg)().pspFeeBps) / 10000), occurredAt: new Date().toISOString() };
        const raw = JSON.stringify(ev);
        const r = await this.handlePspWebhook(p.psp, raw, { 'x-psp-signature': psp_1.FakePspAdapter.sign(raw) });
        return r;
    }
    async balances() {
        const rows = await this.prisma.ledgerEntry.groupBy({ by: ['account'], _sum: { debitMinor: true, creditMinor: true } });
        return rows.map((r) => ({ account: r.account, debitMinor: r._sum.debitMinor ?? 0, creditMinor: r._sum.creditMinor ?? 0 }));
    }
    async importSettlementLines(lines) {
        for (const l of lines)
            await this.prisma.pspSettlementLine.upsert({ where: { psp_pspRef_kind: { psp: l.psp, pspRef: l.pspRef, kind: l.kind } }, create: { ...l, date: new Date(l.date) }, update: { amountMinor: l.amountMinor, feeMinor: l.feeMinor ?? 0 } });
        return { imported: lines.length };
    }
    async reconcileDaily(date = new Date()) {
        const day = new Date(date.toISOString().slice(0, 10));
        const next = new Date(day.getTime() + 86400_000);
        const captured = await this.prisma.paymentIntent.findMany({ where: { capturedAt: { gte: day, lt: next } } });
        let lines = await this.prisma.pspSettlementLine.findMany({ where: { date: day, kind: 'CAPTURE' } });
        if (!lines.length && (0, config_1.cfg)().pspMode === 'sandbox-fake') {
            await this.importSettlementLines(captured.map((p) => ({ psp: p.psp, pspRef: p.pspRef ?? p.id, kind: 'CAPTURE', amountMinor: p.amountMinor, feeMinor: p.feeMinor, date: day.toISOString() })));
            lines = await this.prisma.pspSettlementLine.findMany({ where: { date: day, kind: 'CAPTURE' } });
        }
        const disc = [];
        const byRef = new Map(lines.map((l) => [l.pspRef, l]));
        for (const p of captured) {
            const l = byRef.get(p.pspRef ?? p.id);
            if (!l)
                disc.push({ type: 'MISSING_AT_PSP', ref: p.id });
            else if (l.amountMinor !== p.amountMinor)
                disc.push({ type: 'AMOUNT_MISMATCH', ref: p.id, detail: { ours: p.amountMinor, psp: l.amountMinor } });
            if (l)
                await this.prisma.pspSettlementLine.update({ where: { id: l.id }, data: { matched: true } });
        }
        const ours = new Set(captured.map((p) => p.pspRef ?? p.id));
        for (const l of lines)
            if (!ours.has(l.pspRef))
                disc.push({ type: 'UNKNOWN_AT_PSP', ref: l.pspRef, detail: { amountMinor: l.amountMinor } });
        const unbalanced = await this.prisma.$queryRaw `SELECT "txId" FROM "LedgerEntry" GROUP BY "txId" HAVING SUM("debitMinor") <> SUM("creditMinor")`;
        for (const u of unbalanced)
            disc.push({ type: 'LEDGER_UNBALANCED', ref: u.txId });
        const stale = await this.prisma.refund.findMany({ where: { status: 'REQUESTED', createdAt: { lt: new Date(Date.now() - 24 * 3600_000) } } });
        for (const r of stale)
            disc.push({ type: 'REFUND_NOT_SETTLED', ref: r.id });
        const noLedger = await this.prisma.$queryRaw `SELECT p.id FROM "PaymentIntent" p WHERE p.status IN ('CAPTURED','PARTIALLY_REFUNDED','REFUNDED') AND NOT EXISTS (SELECT 1 FROM "LedgerTx" t WHERE t."idempotencyKey" = 'capture:' || p.id)`;
        for (const n of noLedger)
            disc.push({ type: 'CAPTURE_WITHOUT_LEDGER', ref: n.id });
        const heldNoLedger = await this.prisma.$queryRaw `SELECT p.id FROM "PaymentIntent" p WHERE p."reviewState" = 'HELD_FOR_REVIEW' AND NOT EXISTS (SELECT 1 FROM "LedgerTx" t WHERE t."idempotencyKey" = 'hold-review:' || p.id)`;
        for (const n of heldNoLedger)
            disc.push({ type: 'REVIEW_HOLD_WITHOUT_LEDGER', ref: n.id });
        const sponsorDrift = await this.prisma.$queryRaw `SELECT p.id FROM "PaymentIntent" p WHERE p."sponsoredMinor" > 0 AND (SELECT COALESCE(SUM(e."debitMinor" - e."creditMinor"), 0) FROM "LedgerEntry" e JOIN "LedgerTx" t ON t.id = e."txId" WHERE t."paymentId" = p.id AND e.account = ${ledger_1.A.sponsorFunded}) <> p."sponsoredPostedMinor"`;
        for (const n of sponsorDrift)
            disc.push({ type: 'SPONSORED_LEDGER_MISMATCH', ref: n.id });
        const heldAfterRelease = await this.prisma.$queryRaw `SELECT p.id FROM "PaymentIntent" p WHERE p.purpose <> 'DEPOSIT' AND p."releasedAt" IS NOT NULL AND (SELECT COALESCE(SUM(e."creditMinor" - e."debitMinor"), 0) FROM "LedgerEntry" e JOIN "LedgerTx" t ON t.id = e."txId" WHERE t."paymentId" = p.id AND e.account LIKE 'HELD:%') <> 0`;
        for (const n of heldAfterRelease)
            disc.push({ type: 'ORDER_HELD_AFTER_RELEASE', ref: n.id });
        const run = await this.prisma.reconciliationRun.create({ data: { kind: 'PSP_DAILY', status: disc.length ? 'DISCREPANCIES' : 'OK', discrepancies: disc, stats: { captured: captured.length, lines: lines.length, date: day.toISOString().slice(0, 10) } } });
        return run;
    }
    async feeStatement(q) {
        const rows = await this.prisma.$queryRaw(client_1.Prisma.sql `
      SELECT t."clinicId" AS partner, COALESCE(SUM(e."creditMinor"),0)::bigint AS fee, COUNT(DISTINCT t.id)::bigint AS orders
      FROM "LedgerEntry" e JOIN "LedgerTx" t ON t.id = e."txId"
      WHERE e.account = 'MARKETPLACE_FEES' AND t."createdAt" >= ${q.from} AND t."createdAt" < ${q.to}
      GROUP BY t."clinicId" ORDER BY t."clinicId"`);
        const bps = (0, config_1.cfg)().feeStatementVatBps;
        const lines = rows.map((r) => { const feeMinor = Number(r.fee); const vatMinor = Math.round((feeMinor * bps) / 10000); return { partner: r.partner, orders: Number(r.orders), feeMinor, vatBps: bps, vatMinor, totalMinor: feeMinor + vatMinor }; });
        return { from: q.from.toISOString(), to: q.to.toISOString(), currency: 'EGP', vatBps: bps, vatNote: bps ? 'VAT per FEE_STATEMENT_VAT_BPS config (NEEDS_HUMAN)' : 'VAT rate not configured (NEEDS_HUMAN)', lines, totals: { feeMinor: lines.reduce((s, l) => s + l.feeMinor, 0), vatMinor: lines.reduce((s, l) => s + l.vatMinor, 0), totalMinor: lines.reduce((s, l) => s + l.totalMinor, 0) } };
    }
    async dashboard() {
        const [intents, refunds, payouts, runs, balances] = await Promise.all([
            this.prisma.paymentIntent.groupBy({ by: ['status'], _count: true, _sum: { amountMinor: true } }),
            this.prisma.refund.groupBy({ by: ['status'], _count: true, _sum: { amountMinor: true } }),
            this.prisma.payout.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
            this.prisma.reconciliationRun.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
            this.balances(),
        ]);
        const held = await this.prisma.paymentIntent.aggregate({ where: { reviewState: 'HELD_FOR_REVIEW' }, _count: true, _sum: { amountMinor: true, refundedMinor: true } });
        return { intents, refunds, payouts, reconciliationRuns: runs, balances, heldForReview: { count: held._count, amountMinor: (held._sum.amountMinor ?? 0) - (held._sum.refundedMinor ?? 0) } };
    }
};
exports.PayService = PayService;
exports.PayService = PayService = __decorate([
    (0, common_1.Injectable)(),
    __param(4, (0, common_1.Optional)()),
    __param(4, (0, common_1.Inject)(growth_ports_public_1.REWARDS_PORT)),
    __param(5, (0, common_1.Optional)()),
    __param(5, (0, common_1.Inject)(growth_ports_public_1.SPONSORED_PAY_PORT)),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, outbox_public_1.OutboxService, kiorly_public_1.KiorlyClient, control_plane_public_1.FlagsService, Object, Object])
], PayService);
//# sourceMappingURL=pay.service.js.map