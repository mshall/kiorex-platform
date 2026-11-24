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
exports.WaitlistService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("../common/config");
const errors_1 = require("../common/errors");
const ids_1 = require("../common/ids");
const booking_public_1 = require("../booking/booking-public");
const catalog_public_1 = require("../catalog/catalog-public");
const control_plane_public_1 = require("../control-plane/control-plane-public");
const engagement_public_1 = require("../engagement/engagement-public");
const market_public_1 = require("../market/market-public");
const patient_public_1 = require("../patient/patient-public");
const prisma_service_1 = require("../prisma/prisma.service");
let WaitlistService = class WaitlistService {
    prisma;
    catalog;
    booking;
    flags;
    engagement;
    markets;
    patients;
    log = new common_1.Logger('waitlist');
    timer;
    constructor(prisma, catalog, booking, flags, engagement, markets, patients) {
        this.prisma = prisma;
        this.catalog = catalog;
        this.booking = booking;
        this.flags = flags;
        this.engagement = engagement;
        this.markets = markets;
        this.patients = patients;
    }
    onModuleInit() {
        if (!(0, config_1.cfg)().jobsEnabled)
            return;
        this.timer = setInterval(() => void this.scan().catch((e) => this.log.warn(e.message)), 60_000);
        this.timer.unref();
    }
    onModuleDestroy() { if (this.timer)
        clearInterval(this.timer); }
    presentOffer(o) {
        return { id: o.id, startsAt: o.startsAt.toISOString(), endsAt: o.endsAt.toISOString(), status: o.status, expiresAt: o.expiresAt.toISOString(), bookingId: o.bookingId };
    }
    presentEntry(e, p) {
        const raw = p?.raw ?? {};
        const doctor = p ? { id: p.id, nameEn: p.nameEn, nameAr: p.nameAr, specialty: p.specialty, photoUrl: raw.provider?.photoUrl ?? raw.provider?.photoRelativePath ?? null } : null;
        return { id: e.id, doctor, clinicNameEn: p?.clinicNameEn ?? null, clinicNameAr: p?.clinicNameAr ?? null, providerId: e.providerId, typeId: e.typeId, preferredFrom: e.preferredFrom?.toISOString() ?? null, preferredTo: e.preferredTo?.toISOString() ?? null, status: e.status, expiresAt: e.expiresAt.toISOString(), offers: e.offers.map((o) => this.presentOffer(o)) };
    }
    async join(sub, i) {
        const p = await this.prisma.provider.findUnique({ where: { id: i.providerId } });
        if (!p)
            throw (0, errors_1.notFound)('PROVIDER_NOT_FOUND', 'Provider not found');
        await this.markets.assertLive(p.market);
        if (p.status !== 'LIVE')
            throw (0, errors_1.conflict)('LISTING_NOT_LIVE', 'Only live listings have a waitlist');
        if (i.dependantId)
            await this.patients.assertGuardian(sub, i.dependantId);
        if (!(await this.patients.profileBySub(sub)))
            throw (0, errors_1.notFound)('PROFILE_NOT_FOUND', 'Complete your profile first');
        const from = i.preferredFrom ? new Date(i.preferredFrom) : null;
        const to = i.preferredTo ? new Date(i.preferredTo) : null;
        if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime())))
            throw (0, errors_1.badRequest)('INVALID_WINDOW', 'invalid preferred window');
        if (from && to && to <= from)
            throw (0, errors_1.badRequest)('INVALID_WINDOW', 'preferredTo must be after preferredFrom');
        if (to && to <= new Date())
            throw (0, errors_1.badRequest)('INVALID_WINDOW', 'preferredTo is in the past');
        const existing = await this.prisma.waitlistEntry.findFirst({ where: { sub, providerId: p.id, typeId: i.typeId, dependantId: i.dependantId ?? null, status: { in: ['WAITING', 'OFFERED'] } }, include: { offers: true } });
        if (existing)
            return this.presentEntry(existing, p);
        const nowDt = new Date();
        const slots = await this.catalog.slots(p, i.typeId, nowDt, new Date(nowDt.getTime() + (0, config_1.cfg)().waitlistHorizonDays * 86400_000), { fresh: true }).catch(() => []);
        const open = slots.filter((s) => new Date(s.startsAt) > nowDt && this.fits({ preferredFrom: from, preferredTo: to }, new Date(s.startsAt)));
        if (open.length)
            throw (0, errors_1.conflict)('SLOTS_AVAILABLE', 'This doctor has open slots: book directly instead of joining the waitlist', { nextSlots: open.slice(0, 3), openSlotCount: open.length });
        const horizon = new Date(Date.now() + (0, config_1.cfg)().waitlistHorizonDays * 86400_000);
        const e = await this.prisma.waitlistEntry.create({
            data: { id: (0, ids_1.newId)('kx_wl'), sub, dependantId: i.dependantId, providerId: p.id, clinicId: p.clinicId, clinicianId: p.clinicianId, tenantId: p.tenantId, typeId: i.typeId, preferredFrom: from, preferredTo: to, expiresAt: to && to < horizon ? to : horizon },
            include: { offers: true },
        });
        await this.catalog.track('waitlist_joined', { providerId: p.id, specialtyCode: p.specialty ?? undefined });
        return this.presentEntry(e, p);
    }
    async list(sub) {
        const rows = await this.prisma.waitlistEntry.findMany({ where: { sub, status: { not: 'CANCELLED' } }, include: { offers: { orderBy: { createdAt: 'desc' } } }, orderBy: { createdAt: 'desc' }, take: 100 });
        const provs = new Map((await this.prisma.provider.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.providerId))] } } })).map((p) => [p.id, p]));
        return rows.map((e) => this.presentEntry(e, provs.get(e.providerId)));
    }
    async cancel(sub, id) {
        const r = await this.prisma.waitlistEntry.updateMany({ where: { id, sub, status: { in: ['WAITING', 'OFFERED'] } }, data: { status: 'CANCELLED' } });
        if (!r.count)
            throw (0, errors_1.notFound)('WAITLIST_ENTRY_NOT_FOUND', 'Waitlist entry not found');
        await this.prisma.waitlistOffer.updateMany({ where: { entryId: id, status: 'OFFERED' }, data: { status: 'DECLINED', respondedAt: new Date() } });
        return { ok: true };
    }
    fits(e, startsAt) {
        const t = startsAt.getTime();
        return (!e.preferredFrom || e.preferredFrom.getTime() <= t) && (!e.preferredTo || e.preferredTo.getTime() >= t);
    }
    async scan(opts = {}) {
        const now = new Date();
        let offersExpired = 0, offersCreated = 0;
        const stale = await this.prisma.waitlistOffer.findMany({ where: { status: 'OFFERED', expiresAt: { lt: now } } });
        for (const o of stale) {
            const c = await this.prisma.waitlistOffer.updateMany({ where: { id: o.id, status: 'OFFERED' }, data: { status: 'EXPIRED', respondedAt: now } });
            if (c.count) {
                offersExpired++;
                await this.prisma.waitlistEntry.updateMany({ where: { id: o.entryId, status: 'OFFERED' }, data: { status: 'WAITING' } });
            }
        }
        await this.prisma.waitlistEntry.updateMany({ where: { status: { in: ['WAITING', 'OFFERED'] }, expiresAt: { lt: now } }, data: { status: 'EXPIRED' } });
        const entries = await this.prisma.waitlistEntry.findMany({ where: { status: 'WAITING', ...(opts.clinicianId ? { clinicianId: opts.clinicianId } : {}) }, orderBy: { createdAt: 'asc' }, take: 500 });
        const byProvider = new Map();
        for (const e of entries)
            byProvider.set(`${e.providerId}|${e.typeId}`, [...(byProvider.get(`${e.providerId}|${e.typeId}`) ?? []), e]);
        for (const [key, list] of byProvider) {
            const provider = await this.prisma.provider.findUnique({ where: { id: key.split('|')[0] } });
            if (!provider || provider.status !== 'LIVE')
                continue;
            if (!(await this.autofillOn(provider)))
                continue;
            let slots;
            try {
                slots = await this.catalog.slots(provider, list[0].typeId, now, new Date(now.getTime() + (0, config_1.cfg)().waitlistHorizonDays * 86400_000));
            }
            catch {
                continue;
            }
            for (const s of slots) {
                const startsAt = new Date(s.startsAt);
                if (startsAt <= now)
                    continue;
                if (await this.prisma.waitlistOffer.findFirst({ where: { providerId: provider.id, startsAt, status: 'OFFERED' } }))
                    continue;
                for (const e of list) {
                    if (e.status !== 'WAITING' || !this.fits(e, startsAt))
                        continue;
                    const created = await this.offer(e, provider, s);
                    if (created) {
                        e.status = 'OFFERED';
                        offersCreated++;
                        break;
                    }
                }
            }
        }
        return { offersCreated, offersExpired };
    }
    async autofillOn(p) {
        return this.flags.isEnabled('clinic.waitlist_autofill', { market: p.market, orgId: p.tenantId ?? undefined });
    }
    async offer(e, p, s) {
        const startsAt = new Date(s.startsAt);
        if (await this.prisma.waitlistOffer.findUnique({ where: { entryId_startsAt: { entryId: e.id, startsAt } } }))
            return null;
        const expiresAt = new Date(Math.min(Date.now() + (0, config_1.cfg)().waitlistOfferMinutes * 60_000, startsAt.getTime()));
        const claimed = await this.prisma.waitlistEntry.updateMany({ where: { id: e.id, status: 'WAITING' }, data: { status: 'OFFERED' } });
        if (!claimed.count)
            return null;
        const o = await this.prisma.waitlistOffer.create({ data: { id: (0, ids_1.newId)('kx_wo'), entryId: e.id, sub: e.sub, providerId: p.id, startsAt, endsAt: new Date(s.endsAt), expiresAt } });
        await this.engagement.notify(e.sub, { kind: 'WAITLIST_OFFER', params: { doctor: p.nameAr ?? p.nameEn ?? '', time: startsAt.toISOString(), until: expiresAt.toISOString() }, dedupeKey: `WAITLIST_OFFER:${o.id}` });
        return o;
    }
    async accept(sub, offerId) {
        const o = await this.prisma.waitlistOffer.findUnique({ where: { id: offerId }, include: { entry: true } });
        if (!o || o.sub !== sub)
            throw (0, errors_1.notFound)('OFFER_NOT_FOUND', 'Offer not found');
        if (o.status !== 'OFFERED')
            throw (0, errors_1.conflict)('OFFER_NOT_OPEN', `Offer is ${o.status}`, { status: o.status });
        if (o.expiresAt < new Date()) {
            await this.scan();
            throw new errors_1.ApiError(410, 'OFFER_EXPIRED', 'This offer expired; the slot was offered onward');
        }
        try {
            const b = await this.booking.createIntent(sub, { providerId: o.providerId, typeId: o.entry.typeId, startsAt: o.startsAt.toISOString(), endsAt: o.endsAt.toISOString(), dependantId: o.entry.dependantId ?? undefined });
            await this.prisma.waitlistOffer.update({ where: { id: o.id }, data: { status: 'ACCEPTED', bookingId: b.id, respondedAt: new Date() } });
            await this.prisma.waitlistEntry.update({ where: { id: o.entryId }, data: { status: 'BOOKED' } });
            return b;
        }
        catch (e) {
            if (e instanceof errors_1.ApiError && e.code === 'SLOT_TAKEN') {
                await this.prisma.waitlistOffer.update({ where: { id: o.id }, data: { status: 'EXPIRED', respondedAt: new Date() } });
                await this.prisma.waitlistEntry.updateMany({ where: { id: o.entryId, status: 'OFFERED' }, data: { status: 'WAITING' } });
            }
            throw e;
        }
    }
    async decline(sub, offerId) {
        const o = await this.prisma.waitlistOffer.findUnique({ where: { id: offerId } });
        if (!o || o.sub !== sub)
            throw (0, errors_1.notFound)('OFFER_NOT_FOUND', 'Offer not found');
        if (o.status !== 'OFFERED')
            throw (0, errors_1.conflict)('OFFER_NOT_OPEN', `Offer is ${o.status}`, { status: o.status });
        await this.prisma.waitlistOffer.update({ where: { id: o.id }, data: { status: 'DECLINED', respondedAt: new Date() } });
        await this.prisma.waitlistEntry.updateMany({ where: { id: o.entryId, status: 'OFFERED' }, data: { status: 'WAITING' } });
        return { ok: true };
    }
    async onSlotsChanged(clinicianId) {
        try {
            return await this.scan({ clinicianId });
        }
        catch (e) {
            this.log.warn(`autofill scan failed: ${e.message}`);
            return { offersCreated: 0, offersExpired: 0 };
        }
    }
};
exports.WaitlistService = WaitlistService;
exports.WaitlistService = WaitlistService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, catalog_public_1.CatalogService, booking_public_1.BookingService, control_plane_public_1.FlagsService,
        engagement_public_1.EngagementService, market_public_1.MarketService, patient_public_1.PatientService])
], WaitlistService);
//# sourceMappingURL=waitlist.service.js.map