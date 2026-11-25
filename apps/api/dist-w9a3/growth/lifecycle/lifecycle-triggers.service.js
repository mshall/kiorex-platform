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
exports.LifecycleTriggersService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const journey_runner_service_1 = require("./journey-runner.service");
const lifecycle_state_service_1 = require("./lifecycle-state.service");
const H = 3_600_000;
let LifecycleTriggersService = class LifecycleTriggersService {
    prisma;
    runner;
    state;
    log = new common_1.Logger('lifecycle-triggers');
    constructor(prisma, runner, state) {
        this.prisma = prisma;
        this.runner = runner;
        this.state = state;
    }
    async scan(now = new Date()) {
        const n = { registered: 0, holdExpired: 0, depositPending: 0, completed: 0, firstAttended: 0, dormant: 0, enrolled: 0 };
        const enrol = async (r) => { const x = await r; if (x.enrolled)
            n.enrolled++; return x; };
        for (const p of await this.prisma.patientProfile.findMany({ where: { deletedAt: null, createdAt: { gte: new Date(now.getTime() - 48 * H) } }, select: { sub: true, createdAt: true }, take: 500 })) {
            await this.state.refresh(p.sub, now);
            n.registered++;
            await enrol(this.runner.enrol({ sub: p.sub, journeyKey: 'welcome', anchorAt: p.createdAt, params: {}, now }));
        }
        for (const b of await this.prisma.bookingIntent.findMany({ where: { status: 'EXPIRED', updatedAt: { gte: new Date(now.getTime() - 6 * H) } }, select: { id: true, sub: true, holdExpiresAt: true, updatedAt: true }, take: 500 })) {
            n.holdExpired++;
            await enrol(this.runner.enrol({ sub: b.sub, journeyKey: 'booking-recovery', anchorId: b.id, anchorAt: b.holdExpiresAt ?? b.updatedAt, now }));
        }
        for (const b of await this.prisma.bookingIntent.findMany({ where: { status: { in: ['HELD', 'PENDING_CLINIC', 'INTENT'] }, depositStatus: 'REQUIRED', startsAt: { gt: new Date(now.getTime() + 2 * H), lt: new Date(now.getTime() + 48 * H) } }, select: { id: true, sub: true, startsAt: true }, take: 500 })) {
            n.depositPending++;
            await enrol(this.runner.enrol({ sub: b.sub, journeyKey: 'reminders', anchorId: b.id, anchorAt: new Date(b.startsAt.getTime() - 24 * H), params: { time: b.startsAt.toISOString() }, now }));
        }
        const done = await this.prisma.bookingIntent.findMany({ where: { status: 'COMPLETED', updatedAt: { gte: new Date(now.getTime() - 72 * H) } }, select: { id: true, sub: true, updatedAt: true }, take: 500 });
        for (const b of done) {
            n.completed++;
            await this.state.refresh(b.sub, now);
            await enrol(this.runner.enrol({ sub: b.sub, journeyKey: 'post-visit', anchorId: b.id, anchorAt: b.updatedAt, now }));
            const total = await this.prisma.bookingIntent.count({ where: { sub: b.sub, status: 'COMPLETED' } });
            if (total === 1) {
                n.firstAttended++;
                await enrol(this.runner.enrol({ sub: b.sub, journeyKey: 'referral-invite', anchorAt: b.updatedAt, now }));
                await enrol(this.runner.enrol({ sub: b.sub, journeyKey: 'family-onboarding', anchorAt: b.updatedAt, now }));
            }
        }
        for (const l of await this.prisma.patientLifecycle.findMany({ where: { stage: 'DORMANT', stageAt: { gte: new Date(now.getTime() - 24 * H) } }, select: { sub: true, stageAt: true }, take: 500 })) {
            n.dormant++;
            await enrol(this.runner.enrol({ sub: l.sub, journeyKey: 'reengagement', anchorId: `d${Math.floor(l.stageAt.getTime() / 86_400_000)}`, anchorAt: l.stageAt, now }));
        }
        return n;
    }
};
exports.LifecycleTriggersService = LifecycleTriggersService;
exports.LifecycleTriggersService = LifecycleTriggersService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, journey_runner_service_1.JourneyRunnerService, lifecycle_state_service_1.LifecycleStateService])
], LifecycleTriggersService);
//# sourceMappingURL=lifecycle-triggers.service.js.map