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
exports.PromotionReviewService = void 0;
const market_core_public_1 = require("../../market/market-core-public");
const common_1 = require("@nestjs/common");
const errors_1 = require("../../common/errors");
const prisma_service_1 = require("../../prisma/prisma.service");
const growth_access_1 = require("../admin/growth-access");
const growth_config_service_1 = require("../config/growth-config.service");
const promotion_content_guard_1 = require("./promotion-content-guard");
const promotion_math_1 = require("./promotion-math");
const promotion_reservation_client_1 = require("./promotion-reservation.client");
const REVIEW_ROLES = (0, growth_access_1.rolesFor)('reviewPromotions');
const kindsOf = (hv) => (hv ? ['CONTENT', 'SCOPE', 'HIGH_VALUE'] : ['CONTENT', 'SCOPE']);
const requesterOf = (orgRef) => `org:${orgRef}`;
let PromotionReviewService = class PromotionReviewService {
    prisma;
    config;
    clinic;
    constructor(prisma, config, clinic) {
        this.prisma = prisma;
        this.config = config;
        this.clinic = clinic;
    }
    async policy(market = market_core_public_1.DEFAULT_MARKET) { return (await this.config.resolve('SPONSORED_PROMOTION_POLICY', { market })).payload; }
    async openReviews(promotionId, version) {
        const p = await this.prisma.sponsoredPromotionProjection.findUnique({ where: { promotionId_version: { promotionId, version } } });
        if (!p || p.status !== 'IN_REVIEW')
            return 0;
        const pol = await this.policy(p.market);
        const hv = (0, promotion_math_1.highValueReasons)({ budgetCapMinor: Number(p.budgetCapMinor), discount: p.discount }, pol).length > 0;
        const guard = (0, promotion_content_guard_1.guardTexts)({ nameEn: p.nameEn, nameAr: p.nameAr, patientCopyEn: p.patientCopyEn, patientCopyAr: p.patientCopyAr });
        let n = 0;
        for (const kind of kindsOf(hv)) {
            const exists = await this.prisma.sponsoredPromotionReview.findFirst({ where: { promotionId, promotionVersion: version, kind }, select: { id: true } });
            if (!exists) {
                await this.prisma.sponsoredPromotionReview.create({ data: { market: p.market, promotionId, promotionVersion: version, kind, requestedBy: requesterOf(p.orgRef), guardResult: guard } });
                n++;
            }
        }
        return n;
    }
    async queue(o = {}) {
        const rows = await this.prisma.sponsoredPromotionProjection.findMany({ where: o.status === 'ALL' ? {} : { status: o.status ?? 'IN_REVIEW' }, orderBy: [{ lastEventAt: 'desc' }], take: Math.min(o.take ?? 100, 200) });
        const reviews = await this.prisma.sponsoredPromotionReview.findMany({ where: { OR: rows.map((r) => ({ promotionId: r.promotionId, promotionVersion: r.version })) }, orderBy: { createdAt: 'asc' } });
        return rows.map((r) => ({ promotionId: r.promotionId, version: r.version, orgRef: r.orgRef, status: r.status, nameAr: r.nameAr, nameEn: r.nameEn, budgetCapMinor: Number(r.budgetCapMinor), updatedAt: r.lastEventAt, reviews: reviews.filter((x) => x.promotionId === r.promotionId && x.promotionVersion === r.version).map((x) => ({ kind: x.kind, decision: x.decision, decidedBy: x.decidedBy ? 'ops' : null, decidedAt: x.decidedAt })) }));
    }
    async detail(promotionId, version) {
        const p = await this.prisma.sponsoredPromotionProjection.findFirst({ where: { promotionId, ...(version ? { version } : {}) }, orderBy: { version: 'desc' } });
        if (!p)
            throw (0, errors_1.notFound)('PROMOTION_NOT_FOUND', 'Promotion not found');
        const pol = await this.policy(p.market);
        const reviews = await this.prisma.sponsoredPromotionReview.findMany({ where: { promotionId, promotionVersion: p.version }, orderBy: { createdAt: 'asc' } });
        return {
            promotionId, version: p.version, orgRef: p.orgRef, status: p.status, nameAr: p.nameAr, nameEn: p.nameEn, patientCopyAr: p.patientCopyAr, patientCopyEn: p.patientCopyEn, scope: p.scope, discount: p.discount, eligibility: p.eligibility,
            budgetCapMinor: Number(p.budgetCapMinor), fundingMode: p.fundingMode, startsAt: p.startsAt, endsAt: p.endsAt, contentHash: p.contentHash,
            highValue: (0, promotion_math_1.highValueReasons)({ budgetCapMinor: Number(p.budgetCapMinor), discount: p.discount }, pol),
            guard: (0, promotion_content_guard_1.guardTexts)({ nameEn: p.nameEn, nameAr: p.nameAr, patientCopyEn: p.patientCopyEn, patientCopyAr: p.patientCopyAr }),
            reviews: reviews.map((r) => ({ id: r.id, kind: r.kind, decision: r.decision, reason: r.reason, decidedAt: r.decidedAt, mine: false, guardResult: r.guardResult })),
        };
    }
    async decide(a, promotionId, i) {
        if (!a.roles.some((r) => REVIEW_ROLES.includes(r)))
            throw (0, errors_1.forbidden)('REVIEW_ROLE_REQUIRED', 'Only a Super Admin or a growth admin reviews promotions');
        const p = await this.prisma.sponsoredPromotionProjection.findUnique({ where: { promotionId_version: { promotionId, version: i.version } } });
        if (!p)
            throw (0, errors_1.notFound)('PROMOTION_NOT_FOUND', 'Promotion not found');
        if (p.status !== 'IN_REVIEW')
            throw (0, errors_1.conflict)('PROMOTION_NOT_IN_REVIEW', `The promotion is ${p.status}`);
        await this.openReviews(promotionId, i.version);
        const rows = await this.prisma.sponsoredPromotionReview.findMany({ where: { promotionId, promotionVersion: i.version } });
        const row = rows.find((r) => r.kind === i.kind);
        if (!row)
            throw (0, errors_1.notFound)('REVIEW_NOT_OPEN', 'No such review is open for this version');
        if (row.decision) {
            if (row.decision === i.decision && row.decidedBy === a.sub)
                return this.detail(promotionId, i.version);
            throw (0, errors_1.conflict)('REVIEW_ALREADY_DECIDED', 'This review is already decided');
        }
        if (row.requestedBy === a.sub)
            throw (0, errors_1.forbidden)('SELF_APPROVAL', 'The author cannot approve their own promotion');
        if (i.decision === 'APPROVED' && i.kind === 'HIGH_VALUE' && rows.some((r) => r.kind !== 'HIGH_VALUE' && r.decidedBy === a.sub))
            throw (0, errors_1.forbidden)('SECOND_APPROVER_REQUIRED', 'A high-value promotion needs a second approver who is not the first');
        if (i.decision === 'APPROVED' && i.kind !== 'HIGH_VALUE' && rows.some((r) => r.kind === 'HIGH_VALUE' && r.decidedBy === a.sub))
            throw (0, errors_1.forbidden)('SECOND_APPROVER_REQUIRED', 'The second approver cannot also decide the content or scope');
        if (i.decision === 'APPROVED' && i.kind === 'CONTENT') {
            const g = (0, promotion_content_guard_1.guardTexts)({ nameEn: p.nameEn, nameAr: p.nameAr, patientCopyEn: p.patientCopyEn, patientCopyAr: p.patientCopyAr });
            if (!g.ok)
                throw (0, errors_1.unprocessable)('GUARD_BLOCKS_APPROVAL', 'The automated content guard found wording that cannot be approved', { hits: g.hits });
        }
        const note = (i.note ?? '').trim().slice(0, 300);
        if ((i.decision !== 'APPROVED') && !note)
            throw (0, errors_1.unprocessable)('NOTE_REQUIRED', 'A rejection or a request for changes needs a short reason');
        const sent = await this.clinic.reviewDecision({ promotionId, clinicId: await this.clinicOf(p.orgRef), version: i.version, reviewKind: i.kind, decision: i.decision, note: note || undefined, decidedBy: `ops:${a.sub}` });
        if (sent === 'UNAVAILABLE')
            throw (0, errors_1.unprocessable)('CLINIC_UNAVAILABLE', 'The clinic system is busy; the decision was not sent. Try again.');
        if (typeof sent === 'object')
            throw (0, errors_1.conflict)('CLINIC_REFUSED_DECISION', 'The clinic refused the decision', { clinicCode: sent.refused });
        await this.prisma.sponsoredPromotionReview.updateMany({ where: { id: row.id, decision: null }, data: { decision: i.decision, decidedBy: a.sub, reason: note || null, decidedAt: new Date() } });
        const after = await this.prisma.sponsoredPromotionReview.findMany({ where: { promotionId, promotionVersion: i.version } });
        const pol = await this.policy(p.market);
        const required = kindsOf((0, promotion_math_1.highValueReasons)({ budgetCapMinor: Number(p.budgetCapMinor), discount: p.discount }, pol).length > 0);
        await this.prisma.auditLog.create({ data: { actor: a.sub, action: `growth.promotion_review.${i.kind.toLowerCase()}.${i.decision.toLowerCase()}`, resource: 'SponsoredPromotionReview', resourceId: row.id, metadata: { promotionId, version: i.version, outcome: (0, promotion_math_1.reviewOutcome)(required, after) } } });
        return this.detail(promotionId, i.version);
    }
    async clinicOf(orgRef) {
        const prov = await this.prisma.provider.findFirst({ where: { tenantId: orgRef }, select: { clinicId: true } });
        if (!prov)
            throw (0, errors_1.conflict)('NO_CLINIC_FOR_ORG', 'No clinic is known for this organisation');
        return prov.clinicId;
    }
};
exports.PromotionReviewService = PromotionReviewService;
exports.PromotionReviewService = PromotionReviewService = __decorate([
    (0, common_1.Injectable)(),
    __param(2, (0, common_1.Inject)(promotion_reservation_client_1.PROMOTION_RESERVATION_CLIENT)),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, growth_config_service_1.GrowthConfigService, Object])
], PromotionReviewService);
//# sourceMappingURL=promotion-review.service.js.map