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
exports.TelemedicineService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("../common/config");
const errors_1 = require("../common/errors");
const ids_1 = require("../common/ids");
const booking_public_1 = require("../booking/booking-public");
const catalog_public_1 = require("../catalog/catalog-public");
const engagement_public_1 = require("../engagement/engagement-public");
const prisma_service_1 = require("../prisma/prisma.service");
const video_1 = require("./video");
const OPEN_BEFORE_MS = 15 * 60_000;
const CLOSE_AFTER_MS = 2 * 3600_000;
const TOKEN_TTL_S = 3600;
let TelemedicineService = class TelemedicineService {
    prisma;
    video;
    booking;
    catalog;
    engagement;
    constructor(prisma, video, booking, catalog, engagement) {
        this.prisma = prisma;
        this.video = video;
        this.booking = booking;
        this.catalog = catalog;
        this.engagement = engagement;
    }
    isVideoCapable(p) {
        const prov = p.raw?.provider ?? {};
        const declared = [prov.telemedicine, prov.videoConsultation, ...(prov.fees ?? []).map((f) => (f.modality === 'VIDEO' || f.isVideo === true ? true : f.isVideo === false ? false : undefined))].filter((x) => x !== undefined);
        if (declared.length)
            return declared.some(Boolean);
        return (0, config_1.cfg)().videoMode === 'mock';
    }
    assertKiorexOwned() { if (this.video.mode === 'clinic-p2p')
        throw (0, errors_1.conflict)('CLINIC_OWNS_CALL', 'This video visit is hosted by the clinic: open the join link on your booking'); }
    visits(sub) { return this.booking.telehealthVisits(sub); }
    async match(q) {
        const res = await this.catalog.search({ specialty: q.specialty, q: q.q, sort: 'earliest', pageSize: 30 });
        if (res.emergency)
            return { items: [], emergency: res.emergency };
        const out = [];
        for (const i of res.items ?? []) {
            const row = await this.prisma.provider.findUnique({ where: { id: i.id } });
            if (row && this.isVideoCapable(row))
                out.push({ id: i.id, nameEn: i.nameEn, nameAr: i.nameAr, specialty: i.specialty, defaultTypeId: i.defaultTypeId, nextSlots: i.nextSlots });
        }
        return { items: out };
    }
    present(s) {
        return { id: s.id, bookingId: s.bookingId, providerId: s.providerId, status: s.status, scheduledStartsAt: s.scheduledStartsAt.toISOString(), startedAt: s.startedAt?.toISOString() ?? null, endedAt: s.endedAt?.toISOString() ?? null, durationSec: s.durationSec, consultFeeMinor: s.consultFeeMinor, joinOpensAt: new Date(s.scheduledStartsAt.getTime() - OPEN_BEFORE_MS).toISOString() };
    }
    async owned(sub, id) {
        const s = await this.prisma.teleSession.findUnique({ where: { id } });
        if (!s || s.sub !== sub)
            throw (0, errors_1.notFound)('SESSION_NOT_FOUND', 'Session not found');
        return s;
    }
    async create(sub, bookingId) {
        this.assertKiorexOwned();
        const b = await this.booking.get(sub, bookingId);
        const existing = await this.prisma.teleSession.findUnique({ where: { bookingId } });
        if (existing)
            return this.present(existing);
        if (!['CONFIRMED', 'CHECKED_IN'].includes(b.status))
            throw (0, errors_1.conflict)('BOOKING_NOT_CONFIRMED', `Booking is ${b.status}`);
        const p = await this.prisma.provider.findUnique({ where: { id: b.providerId } });
        if (!p || !this.isVideoCapable(p))
            throw (0, errors_1.conflict)('NOT_VIDEO_CAPABLE', 'This doctor does not offer video visits');
        const id = (0, ids_1.newId)('kx_ts');
        let room;
        try {
            room = await this.video.createRoom(id);
        }
        catch {
            throw (0, errors_1.unavailable)('VIDEO_PROVIDER_UNAVAILABLE', 'Video service unavailable', { retryable: true });
        }
        const s = await this.prisma.teleSession.create({ data: { id, sub, bookingId, providerId: b.providerId, clinicId: b.clinicId, videoProvider: this.video.name, roomName: room.roomName, scheduledStartsAt: new Date(b.startsAt), consultFeeMinor: (0, config_1.cfg)().teleConsultFeeMinor } });
        return this.present(s);
    }
    async list(sub) { return (await this.prisma.teleSession.findMany({ where: { sub }, orderBy: { scheduledStartsAt: 'desc' }, take: 50 })).map((s) => this.present(s)); }
    async get(sub, id) { return this.present(await this.owned(sub, id)); }
    async assertJoinable(s, sub) {
        if (['ENDED', 'CANCELLED'].includes(s.status))
            throw (0, errors_1.conflict)('SESSION_CLOSED', `Session is ${s.status}`);
        const now = Date.now();
        if (now < s.scheduledStartsAt.getTime() - OPEN_BEFORE_MS)
            throw (0, errors_1.conflict)('TOO_EARLY', 'The video room opens 15 minutes before the visit', { opensAt: new Date(s.scheduledStartsAt.getTime() - OPEN_BEFORE_MS).toISOString() });
        if (now > s.scheduledStartsAt.getTime() + CLOSE_AFTER_MS)
            throw (0, errors_1.conflict)('SESSION_EXPIRED', 'This visit window has passed');
        if (sub) {
            const b = await this.booking.get(sub, s.bookingId);
            if (!['CONFIRMED', 'CHECKED_IN'].includes(b.status)) {
                await this.prisma.teleSession.update({ where: { id: s.id }, data: { status: 'CANCELLED' } });
                throw (0, errors_1.conflict)('BOOKING_NOT_CONFIRMED', `Booking is ${b.status}`);
            }
        }
    }
    async mark(s, who) {
        const data = who === 'patient' ? { patientJoinedAt: s.patientJoinedAt ?? new Date() } : { clinicianJoinedAt: s.clinicianJoinedAt ?? new Date() };
        const both = (who === 'patient' ? true : !!s.patientJoinedAt) && (who === 'clinician' ? true : !!s.clinicianJoinedAt);
        data.status = both ? 'IN_PROGRESS' : 'WAITING';
        if (both && !s.startedAt)
            data.startedAt = new Date();
        return this.prisma.teleSession.update({ where: { id: s.id }, data });
    }
    async patientJoin(sub, id) {
        this.assertKiorexOwned();
        const s = await this.owned(sub, id);
        await this.assertJoinable(s, sub);
        const token = await this.video.issueToken({ roomName: s.roomName, identity: `patient:${sub}`, role: 'patient', ttlSeconds: TOKEN_TTL_S });
        return { session: this.present(await this.mark(s, 'patient')), video: token };
    }
    async clinicianJoin(bookingId) {
        this.assertKiorexOwned();
        const s = await this.prisma.teleSession.findUnique({ where: { bookingId } });
        if (!s)
            throw (0, errors_1.notFound)('SESSION_NOT_FOUND', 'No video session for this booking');
        await this.assertJoinable(s);
        const token = await this.video.issueToken({ roomName: s.roomName, identity: `clinician:${s.providerId}`, role: 'clinician', ttlSeconds: TOKEN_TTL_S });
        const updated = await this.mark(s, 'clinician');
        const p = await this.prisma.provider.findUnique({ where: { id: s.providerId } });
        await this.engagement.notify(s.sub, { kind: 'TELE_SESSION_READY', bookingId: s.bookingId, params: { doctor: p?.nameAr ?? p?.nameEn ?? '' }, dedupeKey: `TELE_SESSION_READY:${s.id}` });
        return { session: this.present(updated), video: token };
    }
    async end(s) {
        if (s.status === 'ENDED')
            return this.present(s);
        if (s.status === 'CANCELLED')
            throw (0, errors_1.conflict)('SESSION_CLOSED', 'Session is CANCELLED');
        const endedAt = new Date();
        const durationSec = s.startedAt ? Math.max(0, Math.round((endedAt.getTime() - s.startedAt.getTime()) / 1000)) : 0;
        return this.present(await this.prisma.teleSession.update({ where: { id: s.id }, data: { status: 'ENDED', endedAt, durationSec } }));
    }
    async patientEnd(sub, id) { this.assertKiorexOwned(); return this.end(await this.owned(sub, id)); }
    async clinicianEnd(bookingId) {
        this.assertKiorexOwned();
        const s = await this.prisma.teleSession.findUnique({ where: { bookingId } });
        if (!s)
            throw (0, errors_1.notFound)('SESSION_NOT_FOUND', 'No video session for this booking');
        return this.end(s);
    }
};
exports.TelemedicineService = TelemedicineService;
exports.TelemedicineService = TelemedicineService = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, common_1.Inject)(video_1.VIDEO)),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, Object, booking_public_1.BookingService, catalog_public_1.CatalogService, engagement_public_1.EngagementService])
], TelemedicineService);
//# sourceMappingURL=telemedicine.service.js.map