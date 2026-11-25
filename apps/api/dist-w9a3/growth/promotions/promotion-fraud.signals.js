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
exports.PromotionFraudSignals = exports.collusionLoop = exports.farm = exports.LOOP_CLINICS = exports.FARM_THRESHOLD = void 0;
const common_1 = require("@nestjs/common");
const privacy_hash_1 = require("../../common/privacy-hash");
const prisma_service_1 = require("../../prisma/prisma.service");
exports.FARM_THRESHOLD = 3;
exports.LOOP_CLINICS = 3;
const farm = (reservationsIn24h) => reservationsIn24h >= exports.FARM_THRESHOLD;
exports.farm = farm;
const collusionLoop = (distinctOrgs30d) => distinctOrgs30d >= exports.LOOP_CLINICS;
exports.collusionLoop = collusionLoop;
let PromotionFraudSignals = class PromotionFraudSignals {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async afterReserve(sub, orgRef, promotionId, now = new Date()) {
        const since24 = new Date(now.getTime() - 24 * 3_600_000), since30 = new Date(now.getTime() - 30 * 86_400_000);
        const mine = await this.prisma.bookingIntent.findMany({ where: { sub }, select: { id: true }, take: 500 });
        const ids = mine.map((m) => m.id);
        if (!ids.length)
            return;
        const lines = await this.prisma.bookingSponsoredDiscount.findMany({ where: { bookingIntentId: { in: ids }, createdAt: { gte: since30 } }, select: { promotionId: true, createdAt: true } });
        const subjectHash = (0, privacy_hash_1.subRefOf)(sub);
        if ((0, exports.farm)(lines.filter((l) => l.createdAt >= since24).length))
            await this.prisma.growthFraudSignal.create({ data: { ruleId: 'PF_FARM', subjectHash, score: 60, evidenceRef: promotionId.slice(0, 64) } });
        const orgs = await this.prisma.sponsoredPromotionProjection.findMany({ where: { promotionId: { in: [...new Set(lines.map((l) => l.promotionId))] } }, select: { orgRef: true }, distinct: ['orgRef'] });
        if ((0, exports.collusionLoop)(new Set([...orgs.map((o) => o.orgRef), orgRef]).size))
            await this.prisma.growthFraudSignal.create({ data: { ruleId: 'PF_COLLUSION_LOOP', subjectHash, score: 60, evidenceRef: promotionId.slice(0, 64) } });
    }
};
exports.PromotionFraudSignals = PromotionFraudSignals;
exports.PromotionFraudSignals = PromotionFraudSignals = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], PromotionFraudSignals);
//# sourceMappingURL=promotion-fraud.signals.js.map