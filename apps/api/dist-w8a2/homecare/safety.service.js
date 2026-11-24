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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SafetyService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("../common/config");
const district_1 = require("../common/district");
const errors_1 = require("../common/errors");
const ids_1 = require("../common/ids");
const booking_public_1 = require("../booking/booking-public");
const catalog_public_1 = require("../catalog/catalog-public");
const pay_public_1 = require("../pay/pay-public");
const prisma_service_1 = require("../prisma/prisma.service");
const safety_delivery_adapter_1 = require("./safety-delivery.adapter");
let SafetyService = class SafetyService {
    prisma;
    booking;
    catalog;
    pay;
    log = new common_1.Logger('safety');
    timer;
    constructor(prisma, booking, catalog, pay) {
        this.prisma = prisma;
        this.booking = booking;
        this.catalog = catalog;
        this.pay = pay;
    }
    onModuleInit() {
        if (!(0, config_1.cfg)().jobsEnabled)
            return;
        this.timer = setInterval(() => void this.sweep().catch((e) => this.log.warn(`safety sweep failed: ${e.message}`)), 30_000);
        this.timer.unref();
    }
    onModuleDestroy() { if (this.timer)
        clearInterval(this.timer); }
    async act(alertId, action, actor, note) {
        await this.prisma.safetyAlertAction.create({ data: { alertId, action, actor, note } });
    }
    async onAlertRaised(data, eventId) {
        const alertId = String(data.alertId ?? '');
        if (!alertId)
            return 'IGNORED';
        const deliverTo = Array.isArray(data.deliverTo) ? data.deliverTo : [];
        if (!deliverTo.includes('KIOREX_OPS'))
            return 'IGNORED';
        if (await this.prisma.safetyAlert.findUnique({ where: { alertId } }))
            return 'IGNORED';
        const b = (data.externalReference ? await this.booking.byId(data.externalReference) : null) ?? (data.appointmentId ? await this.booking.byAppointmentId(data.appointmentId) : null);
        const raisedAt = data.raisedAt ? new Date(data.raisedAt) : new Date();
        const row = await this.prisma.safetyAlert.create({
            data: { id: (0, ids_1.newId)('kx_sa'), alertId, eventId, bookingId: b?.id, clinicId: String(data.clinicId ?? b?.clinicId ?? ''), appointmentId: data.appointmentId ?? null, kind: String(data.kind ?? 'SOS'), district: (0, district_1.normalizeDistrict)(data.district) ?? b?.visitDistrict ?? null, deliverTo, raisedAt, deliverWithinSeconds: Number(data.deliverWithinSeconds) || (0, config_1.cfg)().safetySloSeconds },
        });
        await this.act(row.id, 'RECEIVED', 'kiorly');
        await this.deliver(row, 0);
        await this.catalog.track('home_visit_safety_alert', { code: row.kind, district: row.district, careType: b?.careType, serviceLocation: 'HOME', providerId: b?.providerId });
        return 'APPLIED';
    }
    async deliver(a, level) {
        const r = await (0, safety_delivery_adapter_1.safetyDelivery)().deliver({ alertId: a.alertId, kind: a.kind, district: a.district, bookingId: a.bookingId, level });
        if (r.ok) {
            if (!a.deliveredAt)
                await this.prisma.safetyAlert.update({ where: { id: a.id }, data: { deliveredAt: new Date(), deliveryMode: (0, safety_delivery_adapter_1.safetyDelivery)().mode, deliveryRef: r.ref, deliveryError: null } });
            await this.act(a.id, 'DELIVERED', 'system', r.ref);
        }
        else {
            await this.prisma.safetyAlert.update({ where: { id: a.id }, data: { deliveryError: (r.error ?? 'DELIVERY_FAILED').slice(0, 200), deliveryMode: (0, safety_delivery_adapter_1.safetyDelivery)().mode } });
            await this.act(a.id, 'DELIVERY_FAILED', 'system', r.error);
        }
    }
    present(a, ctx) {
        const now = Date.now();
        const deadline = new Date(a.raisedAt.getTime() + a.deliverWithinSeconds * 1000);
        const lag = a.deliveredAt ? Math.round((a.deliveredAt.getTime() - a.raisedAt.getTime()) / 100) / 10 : null;
        const open = a.status === 'RAISED' || a.status === 'ESCALATED' || a.status === 'ACKNOWLEDGED';
        return {
            id: a.id, alertId: a.alertId, kind: a.kind, status: a.status, bookingId: a.bookingId, clinicId: a.clinicId, district: a.district, raisedAt: a.raisedAt, receivedAt: a.receivedAt,
            slo: { seconds: a.deliverWithinSeconds, deadlineAt: deadline, deliveredAt: a.deliveredAt, deliveryLagSeconds: lag, met: lag !== null ? lag <= a.deliverWithinSeconds : null, breached: a.deliveredAt ? lag > a.deliverWithinSeconds : now > deadline.getTime(), receiveLagSeconds: Math.round((a.receivedAt.getTime() - a.raisedAt.getTime()) / 100) / 10 },
            delivery: { mode: a.deliveryMode, ref: a.deliveryRef, error: a.deliveryError },
            acknowledgedAt: a.acknowledgedAt, acknowledgedBy: a.acknowledgedBy, ackLagSeconds: a.acknowledgedAt ? Math.round((a.acknowledgedAt.getTime() - a.raisedAt.getTime()) / 1000) : null,
            escalatedAt: a.escalatedAt, escalationLevel: a.escalationLevel, resolvedAt: a.resolvedAt,
            needsEscalation: open && !a.acknowledgedAt && now - a.raisedAt.getTime() > (0, config_1.cfg)().safetyAckEscalateMinutes * 60_000,
            ageSeconds: Math.round((now - a.raisedAt.getTime()) / 1000),
            providerName: ctx?.providerName ?? null, clinicPhone: ctx?.clinicPhone ?? null,
            actions: a.actions?.map((x) => ({ action: x.action, actor: x.actor, note: x.note, at: x.createdAt })) ?? [],
        };
    }
    async withCtx(rows, withActions = false) {
        const out = [];
        for (const a of rows) {
            const b = a.bookingId ? await this.booking.byId(a.bookingId) : null;
            const p = b ? await this.booking.providerOf(b) : null;
            const actions = withActions ? await this.prisma.safetyAlertAction.findMany({ where: { alertId: a.id }, orderBy: { createdAt: 'asc' } }) : undefined;
            out.push(this.present({ ...a, actions }, { providerName: p?.nameEn ?? p?.clinicNameEn ?? null, clinicPhone: p?.raw?.clinic?.phone ?? null }));
        }
        return out;
    }
    async list(q) {
        const rows = await this.prisma.safetyAlert.findMany({ where: { ...(q.status ? { status: q.status } : {}), ...(q.kind ? { kind: q.kind } : {}) }, orderBy: { raisedAt: 'desc' }, take: Math.min(q.limit ?? 100, 300) });
        return { items: await this.withCtx(rows) };
    }
    async get(id) {
        const a = await this.prisma.safetyAlert.findUnique({ where: { id } });
        if (!a)
            throw (0, errors_1.notFound)('ALERT_NOT_FOUND', 'Safety alert not found');
        return (await this.withCtx([a], true))[0];
    }
    async acknowledge(actor, id, note) {
        const a = await this.prisma.safetyAlert.findUnique({ where: { id } });
        if (!a)
            throw (0, errors_1.notFound)('ALERT_NOT_FOUND', 'Safety alert not found');
        if (a.status === 'RESOLVED')
            throw (0, errors_1.conflict)('ALERT_RESOLVED', 'Alert is already resolved');
        if (a.acknowledgedAt)
            return this.get(id);
        await this.prisma.safetyAlert.update({ where: { id }, data: { acknowledgedAt: new Date(), acknowledgedBy: actor, status: a.status === 'ESCALATED' ? 'ESCALATED' : 'ACKNOWLEDGED' } });
        await this.act(id, 'ACKNOWLEDGE', actor, note);
        return this.get(id);
    }
    async escalate(actor, id, note, auto = false) {
        const a = await this.prisma.safetyAlert.findUnique({ where: { id } });
        if (!a)
            throw (0, errors_1.notFound)('ALERT_NOT_FOUND', 'Safety alert not found');
        if (a.status === 'RESOLVED')
            throw (0, errors_1.conflict)('ALERT_RESOLVED', 'Alert is already resolved');
        const level = a.escalationLevel + 1;
        const upd = await this.prisma.safetyAlert.update({ where: { id }, data: { status: 'ESCALATED', escalatedAt: new Date(), escalatedBy: actor, escalationLevel: level } });
        await this.act(id, auto ? 'AUTO_ESCALATE' : 'ESCALATE', actor, note);
        await this.deliver(upd, level);
        return this.get(id);
    }
    async resolve(actor, id, note) {
        const a = await this.prisma.safetyAlert.findUnique({ where: { id } });
        if (!a)
            throw (0, errors_1.notFound)('ALERT_NOT_FOUND', 'Safety alert not found');
        if (a.status === 'RESOLVED')
            return this.get(id);
        await this.prisma.safetyAlert.update({ where: { id }, data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedBy: actor, acknowledgedAt: a.acknowledgedAt ?? new Date(), acknowledgedBy: a.acknowledgedBy ?? actor } });
        await this.act(id, 'RESOLVE', actor, note);
        return this.get(id);
    }
    async sweep() {
        const open = await this.prisma.safetyAlert.findMany({ where: { status: { in: ['RAISED', 'ESCALATED'] }, acknowledgedAt: null } });
        let retried = 0, escalated = 0;
        for (const a of open) {
            if (!a.deliveredAt) {
                await this.deliver(a, a.escalationLevel);
                retried++;
            }
            if (a.escalationLevel === 0 && Date.now() - a.raisedAt.getTime() > (0, config_1.cfg)().safetyAckEscalateMinutes * 60_000) {
                await this.escalate('system', a.id, 'no acknowledgement in time', true);
                escalated++;
            }
        }
        return { retried, escalated };
    }
    async summary() {
        const since = new Date(Date.now() - 30 * 86400_000);
        const rows = await this.prisma.safetyAlert.findMany({ where: { raisedAt: { gte: since } } });
        const lags = rows.filter((r) => r.deliveredAt).map((r) => (r.deliveredAt.getTime() - r.raisedAt.getTime()) / 1000).sort((x, y) => x - y);
        const aborts = await this.booking.opsUnsafeAborts(500);
        const held = await this.pay.heldForReview();
        return {
            windowDays: 30, total: rows.length,
            open: rows.filter((r) => r.status !== 'RESOLVED').length, unacknowledged: rows.filter((r) => !r.acknowledgedAt && r.status !== 'RESOLVED').length,
            sloBreaches: rows.filter((r) => (r.deliveredAt ? (r.deliveredAt.getTime() - r.raisedAt.getTime()) / 1000 > r.deliverWithinSeconds : Date.now() - r.raisedAt.getTime() > r.deliverWithinSeconds * 1000)).length,
            medianDeliverySeconds: lags.length ? lags[Math.floor(lags.length / 2)] : null, p95DeliverySeconds: lags.length ? lags[Math.min(lags.length - 1, Math.floor(lags.length * 0.95))] : null,
            byKind: ['TIMER_EXPIRED', 'SOS', 'UNSAFE_ABORT'].map((kind) => ({ kind, count: rows.filter((r) => r.kind === kind).length })),
            unsafeAborts: aborts.length, depositsHeldForReview: held.length, deliveryMode: (0, safety_delivery_adapter_1.safetyDelivery)().mode, sloSeconds: (0, config_1.cfg)().safetySloSeconds, ackEscalateMinutes: (0, config_1.cfg)().safetyAckEscalateMinutes,
        };
    }
    async escalationLog(limit = 100) {
        const rows = await this.prisma.safetyAlertAction.findMany({ where: { action: { in: ['ESCALATE', 'AUTO_ESCALATE'] } }, orderBy: { createdAt: 'desc' }, take: limit, include: { alert: true } });
        return rows.map((r) => ({ alertId: r.alert.alertId, id: r.alert.id, kind: r.alert.kind, district: r.alert.district, action: r.action, actor: r.actor, note: r.note, at: r.createdAt, level: r.alert.escalationLevel }));
    }
    unsafeAborts() { return this.booking.opsUnsafeAborts(); }
};
exports.SafetyService = SafetyService;
exports.SafetyService = SafetyService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, booking_public_1.BookingService, catalog_public_1.CatalogService, pay_public_1.PayService])
], SafetyService);
//# sourceMappingURL=safety.service.js.map