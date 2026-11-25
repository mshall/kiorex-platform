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
exports.TrustService = void 0;
exports.moderate = moderate;
const config_1 = require("../common/config");
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const errors_1 = require("../common/errors");
const booking_public_1 = require("../booking/booking-public");
const catalog_public_1 = require("../catalog/catalog-public");
const control_plane_public_1 = require("../control-plane/control-plane-public");
const engagement_public_1 = require("../engagement/engagement-public");
const kiorly_public_1 = require("../kiorly/kiorly-public");
const outbox_public_1 = require("../outbox/outbox-public");
const patient_public_1 = require("../patient/patient-public");
const prisma_service_1 = require("../prisma/prisma.service");
const safety_public_1 = require("../safety/safety-public");
const EDIT_WINDOW_MS = 7 * 24 * 3600_000;
const COMPLAINT_SLA_HOURS = 48;
function moderate(text) {
    if (!text)
        return { hidden: false, flags: [] };
    const flags = [...(0, safety_public_1.detectPhi)(text).map((k) => `PHI:${k}`)];
    if ((0, safety_public_1.detectAbuse)(text))
        flags.push('ABUSE');
    return { hidden: flags.length > 0, flags };
}
let TrustService = class TrustService {
    prisma;
    booking;
    catalog;
    flags;
    engagement;
    kiorly;
    outbox;
    patients;
    constructor(prisma, booking, catalog, flags, engagement, kiorly, outbox, patients) {
        this.prisma = prisma;
        this.booking = booking;
        this.catalog = catalog;
        this.flags = flags;
        this.engagement = engagement;
        this.kiorly = kiorly;
        this.outbox = outbox;
        this.patients = patients;
    }
    onModuleInit() {
        this.outbox.register('kiorly.reviews_sync', (e) => this.syncProvider(e.payload.providerId));
        this.patients.registerExport('reviews', async (sub) => this.prisma.review.findMany({ where: { sub }, select: { id: true, rating: true, text: true, status: true, createdAt: true } }));
        this.patients.registerAnonymizer('reviews', async (sub) => {
            await this.prisma.review.updateMany({ where: { sub }, data: { sub: `deleted:${(0, node_crypto_1.createHash)('sha256').update(sub).digest('hex').slice(0, 10)}`, text: null } });
        });
    }
    async submit(sub, bookingId, i) {
        await this.flags.assertEnabled('kiorex.reviews', { market: 'EG' });
        if (!Number.isInteger(i.rating) || i.rating < 1 || i.rating > 5)
            throw (0, errors_1.badRequest)('INVALID_RATING', 'rating must be 1..5');
        const b = await this.booking.completedForReview(sub, bookingId);
        if (b.status !== 'COMPLETED' || !b.kiorlyAppointmentId)
            throw (0, errors_1.forbidden)('NOT_A_COMPLETED_VISIT', 'Only completed Kiorex visits can be reviewed');
        if (await this.prisma.review.findUnique({ where: { bookingId } }))
            throw (0, errors_1.conflict)('REVIEW_EXISTS', 'One review per completed appointment');
        const m = moderate(i.text);
        const r = await this.prisma.review.create({ data: { bookingId, sub, providerId: b.providerId, clinicId: b.clinicId, clinicianId: b.clinicianId, kiorlyAppointmentId: b.kiorlyAppointmentId, rating: i.rating, text: i.text, status: m.hidden ? 'HIDDEN' : 'VISIBLE', moderationFlags: m.flags, editableUntil: new Date(Date.now() + EDIT_WINDOW_MS) } });
        if (m.hidden)
            await this.prisma.moderationCase.create({ data: { reviewId: r.id, reason: m.flags.join(',') } });
        await this.catalog.track('review_submitted', { providerId: b.providerId });
        await this.afterChange(r);
        return this.present(r);
    }
    async edit(sub, id, i) {
        const r = await this.prisma.review.findUnique({ where: { id } });
        if (!r || r.sub !== sub)
            throw (0, errors_1.notFound)('REVIEW_NOT_FOUND', 'Review not found');
        if (r.editableUntil < new Date())
            throw (0, errors_1.forbidden)('REVIEW_EDIT_WINDOW_CLOSED', 'Reviews are editable for 7 days');
        if (i.rating !== undefined && (!Number.isInteger(i.rating) || i.rating < 1 || i.rating > 5))
            throw (0, errors_1.badRequest)('INVALID_RATING', 'rating must be 1..5');
        const text = i.text ?? r.text ?? undefined;
        const m = moderate(text);
        const upd = await this.prisma.review.update({ where: { id }, data: { rating: i.rating ?? r.rating, text, status: m.hidden || r.status === 'HIDDEN' ? 'HIDDEN' : 'VISIBLE', moderationFlags: m.flags, syncStatus: 'PENDING' } });
        if (upd.status === 'HIDDEN' && !(await this.openCase(id)))
            await this.prisma.moderationCase.create({ data: { reviewId: id, reason: m.flags.join(',') || 'EDITED_AFTER_MODERATION' } });
        await this.afterChange(upd);
        return this.present(upd);
    }
    openCase(reviewId) { return this.prisma.moderationCase.findFirst({ where: { reviewId, status: 'OPEN' } }); }
    async afterChange(r) {
        await this.recompute(r.providerId);
        await this.outbox.enqueue(this.prisma, { type: 'kiorly.reviews_sync', target: 'KIORLY', aggregateType: 'Provider', aggregateId: r.providerId, payload: { providerId: r.providerId } });
    }
    async recompute(providerId) {
        const a = await this.prisma.review.aggregate({ where: { providerId, status: 'VISIBLE' }, _avg: { rating: true }, _count: true });
        await this.catalog.updateRating(providerId, Math.round((a._avg.rating ?? 0) * 100) / 100, a._count);
    }
    async syncProvider(providerId) {
        const rows = await this.prisma.review.findMany({ where: { providerId }, orderBy: { createdAt: 'desc' }, take: 50 });
        if (!rows.length)
            return;
        const vis = rows.filter((r) => r.status === 'VISIBLE');
        const a = await this.prisma.review.aggregate({ where: { providerId, status: 'VISIBLE' }, _avg: { rating: true }, _count: true });
        const { data } = await this.kiorly.syncReviews({
            clinicId: rows[0].clinicId, clinicianId: rows[0].clinicianId, averageRating: Math.round((a._avg.rating ?? 0) * 100) / 100, reviewCount: a._count,
            reviews: rows.map((r) => ({ reviewId: r.id, appointmentId: r.kiorlyAppointmentId, rating: r.rating, comment: r.status === 'VISIBLE' ? (r.text ?? undefined) : undefined, createdAt: r.createdAt.toISOString(), moderationStatus: r.status })),
        });
        const rejected = new Set((data?.rejected ?? []).map((x) => x.reviewId));
        await this.prisma.review.updateMany({ where: { id: { in: rows.filter((r) => rejected.has(r.id)).map((r) => r.id) } }, data: { syncStatus: 'REJECTED' } });
        await this.prisma.review.updateMany({ where: { id: { in: rows.filter((r) => !rejected.has(r.id)).map((r) => r.id) } }, data: { syncStatus: 'SYNCED' } });
        void vis;
    }
    present(r) {
        return { id: r.id, bookingId: r.bookingId, rating: r.rating, text: r.text, status: r.status, clinicReply: r.clinicReply, editableUntil: r.editableUntil, createdAt: r.createdAt };
    }
    async mine(sub) { return (await this.prisma.review.findMany({ where: { sub }, orderBy: { createdAt: 'desc' } })).map((r) => this.present(r)); }
    async forProvider(providerId) {
        const rows = await this.prisma.review.findMany({ where: { providerId, status: 'VISIBLE' }, orderBy: { createdAt: 'desc' }, take: 20 });
        const p = await this.prisma.provider.findUnique({ where: { id: providerId }, select: { ratingAvg: true, ratingCount: true } });
        return { average: p?.ratingAvg ?? 0, count: p?.ratingCount ?? 0, reviews: rows.map((r) => ({ id: r.id, rating: r.rating, text: r.text, clinicReply: r.clinicReply, createdAt: r.createdAt })) };
    }
    async onInvitationEligible(data) {
        const b = data.externalReference ? await this.booking.byId(data.externalReference) : null;
        if (!b)
            return 'UNKNOWN_BOOKING';
        await this.engagement.scheduleReviewInvite({ id: b.id, sub: b.sub }, { doctor: '', time: b.startsAt.toISOString() }, data.occurredAt ? new Date(data.occurredAt) : new Date());
        return 'APPLIED';
    }
    async onReply(data) {
        const reply = data.reply ?? data.replyText ?? data.text;
        const r = await this.prisma.review.findFirst({ where: { OR: [{ id: data.reviewId ?? '-' }, { kiorlyAppointmentId: data.appointmentId ?? data.aggregateId ?? '-' }] } });
        if (!r)
            return 'IGNORED';
        await this.prisma.review.update({ where: { id: r.id }, data: { clinicReply: String(reply ?? '') } });
        return 'APPLIED';
    }
    queue(status = 'OPEN') {
        return this.prisma.moderationCase.findMany({ where: { status }, orderBy: { createdAt: 'asc' }, take: 200 }).then(async (cases) => {
            const reviews = await this.prisma.review.findMany({ where: { id: { in: cases.map((c) => c.reviewId) } } });
            return cases.map((c) => ({ ...c, review: reviews.find((r) => r.id === c.reviewId) ? { ...this.present(reviews.find((r) => r.id === c.reviewId)), providerId: reviews.find((r) => r.id === c.reviewId).providerId } : null }));
        });
    }
    async resolve(actor, caseId, resolution) {
        const c = await this.prisma.moderationCase.findUnique({ where: { id: caseId } });
        if (!c || c.status !== 'OPEN')
            throw (0, errors_1.notFound)('CASE_NOT_FOUND', 'No open case');
        await this.prisma.moderationCase.update({ where: { id: caseId }, data: { status: 'RESOLVED', resolution, resolvedBy: actor, resolvedAt: new Date() } });
        const r = await this.prisma.review.update({ where: { id: c.reviewId }, data: { status: resolution === 'RESTORED' ? 'VISIBLE' : 'HIDDEN', syncStatus: 'PENDING' } });
        await this.afterChange(r);
        return { ok: true, status: r.status };
    }
    async complain(sub, i) {
        const hb = i.bookingId ? await this.booking.byId(i.bookingId) : null;
        const home = !!hb && hb.sub === sub && hb.serviceLocation === 'HOME';
        const sla = home ? (0, config_1.cfg)().homeComplaintSlaMinutes * 60_000 : COMPLAINT_SLA_HOURS * 3600_000;
        return this.prisma.complaint.create({ data: { sub, bookingId: i.bookingId, category: i.category, body: i.body, slaDueAt: new Date(Date.now() + sla), homeVisit: home } });
    }
    complaints(status = 'OPEN') { return this.prisma.complaint.findMany({ where: { status }, orderBy: { slaDueAt: 'asc' }, take: 200 }).then((rows) => rows.map((c) => ({ ...c, slaBreached: c.slaDueAt < new Date(), minutesToSla: Math.round((c.slaDueAt.getTime() - Date.now()) / 60_000) }))); }
    async resolveComplaint(id) { await this.prisma.complaint.update({ where: { id }, data: { status: 'RESOLVED', resolvedAt: new Date() } }); return { ok: true }; }
};
exports.TrustService = TrustService;
exports.TrustService = TrustService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, booking_public_1.BookingService, catalog_public_1.CatalogService, control_plane_public_1.FlagsService,
        engagement_public_1.EngagementService, kiorly_public_1.KiorlyClient, outbox_public_1.OutboxService, patient_public_1.PatientService])
], TrustService);
//# sourceMappingURL=trust.service.js.map