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
exports.LifecycleStateService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const lifecycle_stage_1 = require("./lifecycle.stage");
const BOOKED_STATUSES = ['CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW', 'PENDING_CLINIC'];
const DAY = 86_400_000;
let LifecycleStateService = class LifecycleStateService {
    prisma;
    log = new common_1.Logger('lifecycle-state');
    constructor(prisma) {
        this.prisma = prisma;
    }
    async factsFor(sub, now, t = lifecycle_stage_1.DEFAULT_STAGE_THRESHOLDS) {
        const profile = await this.prisma.patientProfile.findUnique({ where: { sub }, select: { createdAt: true, market: true, preferredLocale: true, deletedAt: true } });
        if (!profile || profile.deletedAt)
            return null;
        const intents = await this.prisma.bookingIntent.findMany({ where: { sub }, select: { status: true, createdAt: true, startsAt: true, kiorlyAppointmentId: true }, orderBy: { createdAt: 'desc' }, take: 500 });
        const windowStart = now.getTime() - t.retainedWindowDays * DAY;
        const attended = intents.filter((i) => i.status === 'COMPLETED');
        const booked = intents.filter((i) => BOOKED_STATUSES.includes(i.status) || (i.status === 'CANCELLED' && i.kiorlyAppointmentId !== null));
        const dependants = await this.prisma.dependant.count({ where: { guardianSub: sub } });
        const device = await this.prisma.deviceToken.findFirst({ where: { sub, revokedAt: null }, orderBy: { lastSeenAt: 'desc' }, select: { platform: true } });
        return {
            registeredAt: profile.createdAt,
            lastBookingAt: intents.length ? intents[0].createdAt : null,
            lastAttendedAt: attended.length ? attended.reduce((a, b) => (a.startsAt > b.startsAt ? a : b)).startsAt : null,
            intentCount: intents.length, bookedCount: booked.length,
            attendedInWindow: attended.filter((i) => i.startsAt.getTime() >= windowStart).length, attendedTotal: attended.length,
            hasUpcoming: intents.some((i) => ['CONFIRMED', 'PENDING_CLINIC'].includes(i.status) && i.startsAt.getTime() > now.getTime()),
            market: profile.market, platform: (device?.platform ?? '').toLowerCase(), language: profile.preferredLocale === 'en' ? 'en' : 'ar', hasDependants: dependants > 0,
        };
    }
    async refresh(sub, now = new Date(), t = lifecycle_stage_1.DEFAULT_STAGE_THRESHOLDS) {
        const f = await this.factsFor(sub, now, t);
        if (!f) {
            await this.prisma.patientLifecycle.deleteMany({ where: { sub } });
            return null;
        }
        const stage = (0, lifecycle_stage_1.deriveStage)(f, now, t);
        const prev = await this.prisma.patientLifecycle.findUnique({ where: { sub_market: { sub, market: f.market } } });
        const data = { stage, registeredAt: f.registeredAt, lastBookingAt: f.lastBookingAt, lastAttendedAt: f.lastAttendedAt, bookingsCount: f.bookedCount, platform: f.platform, language: f.language, hasDependants: f.hasDependants };
        const changed = !prev || prev.stage !== stage;
        await this.prisma.patientLifecycle.upsert({
            where: { sub_market: { sub, market: f.market } },
            create: { sub, market: f.market, ...data, stageAt: now },
            update: { ...data, ...(changed ? { stageAt: now } : {}) },
        });
        return { stage, changed, from: prev?.stage ?? null };
    }
    async reconcileBatch(afterSub, size = 200, now = new Date()) {
        const rows = await this.prisma.patientProfile.findMany({ where: { deletedAt: null, ...(afterSub ? { sub: { gt: afterSub } } : {}) }, orderBy: { sub: 'asc' }, take: size, select: { sub: true } });
        let changed = 0;
        for (const r of rows) {
            const x = await this.refresh(r.sub, now).catch((e) => { this.log.warn(`refresh failed: ${e.message}`); return null; });
            if (x?.changed)
                changed++;
        }
        return { processed: rows.length, changed, next: rows.length === size ? rows[rows.length - 1].sub : null };
    }
    async funnel(market, k = 10) {
        const groups = await this.prisma.patientLifecycle.groupBy({ by: ['stage'], where: { market }, _count: { _all: true } });
        const m = new Map(groups.map((g) => [g.stage, g._count._all]));
        return ['REGISTERED', 'ACTIVATED', 'BOOKED', 'ATTENDED', 'RETAINED', 'DORMANT', 'CHURNED'].map((stage) => { const c = m.get(stage) ?? 0; return { stage, count: c >= k ? c : null }; });
    }
};
exports.LifecycleStateService = LifecycleStateService;
exports.LifecycleStateService = LifecycleStateService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], LifecycleStateService);
//# sourceMappingURL=lifecycle-state.service.js.map