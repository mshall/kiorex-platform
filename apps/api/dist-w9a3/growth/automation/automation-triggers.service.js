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
exports.AutomationTriggersService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const journey_runner_service_1 = require("../lifecycle/journey-runner.service");
const H = 3_600_000;
let AutomationTriggersService = class AutomationTriggersService {
    prisma;
    runner;
    constructor(prisma, runner) {
        this.prisma = prisma;
        this.runner = runner;
    }
    async scan(now = new Date()) {
        const out = { journeys: 0, anchors: 0, enrolled: 0 };
        const defs = await this.prisma.lifecycleJourneyDefinition.findMany({ where: { status: 'PUBLISHED', killedAt: null }, select: { market: true, key: true, graph: true } });
        for (const d of defs) {
            const trig = d.graph.nodes.find((n) => n.type === 'TRIGGER')?.event;
            if (!trig)
                continue;
            out.journeys++;
            const jk = `auto.${d.market.toLowerCase()}.${d.key}`;
            for (const a of await this.anchors(trig, d.market, now)) {
                out.anchors++;
                const r = await this.runner.enrol({ sub: a.sub, journeyKey: jk, anchorId: a.id, anchorAt: a.at, now });
                if (r.enrolled)
                    out.enrolled++;
            }
        }
        return out;
    }
    async anchors(event, market, now) {
        const since = (h) => new Date(now.getTime() - h * H);
        switch (event) {
            case 'REGISTERED': return (await this.prisma.patientProfile.findMany({ where: { deletedAt: null, market, createdAt: { gte: since(48) } }, select: { sub: true, createdAt: true }, take: 500 })).map((p) => ({ sub: p.sub, id: 'reg', at: p.createdAt }));
            case 'BOOKING_STARTED': return (await this.prisma.bookingIntent.findMany({ where: { createdAt: { gte: since(6) } }, select: { id: true, sub: true, createdAt: true }, take: 500 })).map((b) => ({ sub: b.sub, id: b.id, at: b.createdAt }));
            case 'BOOKING_EXPIRED': return (await this.prisma.bookingIntent.findMany({ where: { status: 'EXPIRED', updatedAt: { gte: since(6) } }, select: { id: true, sub: true, holdExpiresAt: true, updatedAt: true }, take: 500 })).map((b) => ({ sub: b.sub, id: b.id, at: b.holdExpiresAt ?? b.updatedAt }));
            case 'VISIT_COMPLETED': return (await this.prisma.bookingIntent.findMany({ where: { status: 'COMPLETED', updatedAt: { gte: since(72) } }, select: { id: true, sub: true, updatedAt: true }, take: 500 })).map((b) => ({ sub: b.sub, id: b.id, at: b.updatedAt }));
            case 'REFERRAL_QUALIFIED': return (await this.prisma.referralRelationship.findMany({ where: { market, status: 'QUALIFIED', qualifiedAt: { gte: since(72) } }, select: { id: true, referrerSub: true, qualifiedAt: true }, take: 500 })).map((r) => ({ sub: r.referrerSub, id: r.id, at: r.qualifiedAt }));
            case 'REWARD_EVENT': return (await this.prisma.rewardLot.findMany({ where: { market, createdAt: { gte: since(72) } }, select: { id: true, sub: true, createdAt: true }, take: 500 })).map((r) => ({ sub: r.sub, id: r.id, at: r.createdAt }));
            case 'CONSENT_CHANGED': return (await this.prisma.consentRecord.findMany({ where: { createdAt: { gte: since(6) } }, select: { id: true, sub: true, createdAt: true }, take: 500 })).map((c) => ({ sub: c.sub, id: c.id, at: c.createdAt }));
            case 'STAGE_DORMANT': return (await this.prisma.patientLifecycle.findMany({ where: { market, stage: 'DORMANT', stageAt: { gte: since(24) } }, select: { sub: true, stageAt: true }, take: 500 })).map((l) => ({ sub: l.sub, id: `d${Math.floor(l.stageAt.getTime() / 86_400_000)}`, at: l.stageAt }));
            default: return [];
        }
    }
};
exports.AutomationTriggersService = AutomationTriggersService;
exports.AutomationTriggersService = AutomationTriggersService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, journey_runner_service_1.JourneyRunnerService])
], AutomationTriggersService);
//# sourceMappingURL=automation-triggers.service.js.map