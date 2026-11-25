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
exports.PromotionProjectionService = void 0;
const market_core_public_1 = require("../../market/market-core-public");
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const STATUSES = new Set(['DRAFT', 'SUBMITTED', 'IN_REVIEW', 'APPROVED', 'ACTIVE', 'PAUSED', 'EXHAUSTED', 'EXPIRED', 'REJECTED', 'ARCHIVED']);
const str = (v, max = 300) => (typeof v === 'string' ? v.slice(0, max) : '');
let PromotionProjectionService = class PromotionProjectionService {
    prisma;
    log = new common_1.Logger('promotion-projection');
    constructor(prisma) {
        this.prisma = prisma;
    }
    async applyUpdated(data, market = market_core_public_1.DEFAULT_MARKET) {
        const promotionId = str(data.promotionId, 64), orgRef = str(data.orgRef, 64), status = str(data.status, 20);
        const version = Number(data.version);
        const at = data.at && !Number.isNaN(Date.parse(data.at)) ? new Date(data.at) : new Date();
        if (!promotionId || !orgRef || !Number.isInteger(version) || version < 1 || !STATUSES.has(status))
            return 'IGNORED';
        const d = data.discount ?? {};
        const copy = data.patientCopy ?? {};
        const row = {
            market, orgRef, status, eligibility: (data.eligibility ?? {}), budgetCapMinor: BigInt(Number.isInteger(data.budgetCapMinor) && data.budgetCapMinor > 0 ? data.budgetCapMinor : 0), fundingMode: data.fundingMode === 'WALLET_THEN_INVOICE' ? 'WALLET_THEN_INVOICE' : 'WALLET_ONLY',
            nameAr: str(data.name?.ar, 120), nameEn: str(data.name?.en, 120), scope: (data.scope ?? {}), discount: { kind: d.kind, value: d.value, ...(d.maxPerBookingMinor ? { maxPerBookingMinor: d.maxPerBookingMinor } : {}) },
            patientCopyAr: str(copy.ar), patientCopyEn: str(copy.en), contentHash: str(data.contentHash, 64), startsAt: data.startsAt ? new Date(data.startsAt) : null, endsAt: data.endsAt ? new Date(data.endsAt) : null, lastEventAt: at,
        };
        const cur = await this.prisma.sponsoredPromotionProjection.findUnique({ where: { promotionId_version: { promotionId, version } } });
        if (cur && cur.lastEventAt > at)
            return 'IGNORED';
        await this.prisma.sponsoredPromotionProjection.upsert({ where: { promotionId_version: { promotionId, version } }, create: { promotionId, version, ...row }, update: row });
        if (status === 'ACTIVE' || status === 'IN_REVIEW' || status === 'DRAFT')
            await this.prisma.sponsoredPromotionProjection.updateMany({ where: { promotionId, version: { lt: version }, status: { in: ['ACTIVE', 'PAUSED', 'EXHAUSTED', 'APPROVED'] } }, data: { status: 'ARCHIVED' } });
        return 'APPLIED';
    }
};
exports.PromotionProjectionService = PromotionProjectionService;
exports.PromotionProjectionService = PromotionProjectionService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], PromotionProjectionService);
//# sourceMappingURL=promotion-projection.service.js.map