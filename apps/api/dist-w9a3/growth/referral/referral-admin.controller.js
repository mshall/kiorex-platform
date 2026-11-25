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
exports.ReferralAdminController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const auth_1 = require("../../common/auth");
const errors_1 = require("../../common/errors");
const privacy_hash_1 = require("../../common/privacy-hash");
const prisma_service_1 = require("../../prisma/prisma.service");
const growth_access_1 = require("../admin/growth-access");
const kanon_1 = require("../analytics/kanon");
const referral_qualification_service_1 = require("./referral-qualification.service");
const OBJ = { schema: { type: 'object', additionalProperties: true } };
class DecisionBody {
    decision;
    note;
}
__decorate([
    (0, class_validator_1.IsIn)(['QUALIFY_OVERRIDE', 'REJECT', 'RELEASE_HOLD']),
    __metadata("design:type", String)
], DecisionBody.prototype, "decision", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(300),
    __metadata("design:type", String)
], DecisionBody.prototype, "note", void 0);
let ReferralAdminController = class ReferralAdminController {
    prisma;
    qual;
    constructor(prisma, qual) {
        this.prisma = prisma;
        this.qual = qual;
    }
    async overview(take) {
        const by = await this.prisma.referralRelationship.groupBy({ by: ['status'], _count: { _all: true } });
        const c = (s) => by.find((x) => x.status === s)?._count._all ?? 0;
        const total = by.reduce((s, x) => s + x._count._all, 0);
        const held = await this.prisma.referralRelationship.count({ where: { reviewState: 'HOLD', status: { in: ['SIGNED_UP', 'BOOKED'] } } });
        const queue = await this.prisma.referralRelationship.findMany({ where: { reviewState: 'HOLD', status: { in: ['SIGNED_UP', 'BOOKED'] } }, orderBy: { createdAt: 'asc' }, take: Math.min(Number(take) || 50, 200), select: { id: true, status: true, createdAt: true, holdUntil: true } });
        return {
            funnel: { relationships: (0, kanon_1.maskCount)(total), signedUp: (0, kanon_1.maskCount)(c('SIGNED_UP')), booked: (0, kanon_1.maskCount)(c('BOOKED')), qualified: (0, kanon_1.maskCount)(c('QUALIFIED')), rejected: (0, kanon_1.maskCount)(c('REJECTED')), expired: (0, kanon_1.maskCount)(c('EXPIRED')), onHold: (0, kanon_1.maskCount)(held) },
            queue,
            note: 'Counts below 10 are shown as <10. The queue lists relationship ids only.',
        };
    }
    async one(id) {
        const r = await this.prisma.referralRelationship.findUnique({ where: { id }, include: { checks: { orderBy: { at: 'asc' } } } });
        if (!r)
            throw (0, errors_1.notFound)('REFERRAL_NOT_FOUND', 'Relationship not found');
        const signals = await this.prisma.growthFraudSignal.findMany({ where: { OR: [{ evidenceRef: `rel:${id}` }, { evidenceRef: { startsWith: `claim:${r.codeId}:${(0, privacy_hash_1.subRefOf)(r.refereeSub).slice(0, 12)}` } }, { evidenceRef: `cancel:${id}` }] }, orderBy: { createdAt: 'asc' }, select: { id: true, ruleId: true, score: true, reviewStatus: true, createdAt: true } });
        return {
            id: r.id, status: r.status, reviewState: r.reviewState, rejectReason: r.rejectReason, createdAt: r.createdAt, completedAt: r.completedAt, holdUntil: r.holdUntil, qualifiedAt: r.qualifiedAt, ruleVersionId: r.ruleVersionId,
            referrerRef: (0, privacy_hash_1.subRefOf)(r.referrerSub), refereeRef: (0, privacy_hash_1.subRefOf)(r.refereeSub),
            checks: r.checks.map((c) => ({ key: c.checkKey, passed: c.passed, detail: c.detail, at: c.at })), signals,
        };
    }
    decide(u, id, b) {
        if (b.decision === 'QUALIFY_OVERRIDE' && !u.roles.includes('super_admin'))
            throw (0, errors_1.forbidden)('SUPER_ADMIN_REQUIRED', 'A qualify override needs a super admin');
        return this.qual.decide({ sub: u.sub }, id, b.decision, b.note);
    }
};
exports.ReferralAdminController = ReferralAdminController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-B1 funnel counts (k >= 10) and the review queue' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)('take')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ReferralAdminController.prototype, "overview", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-B1 reviewer view: checks, fraud signals, state (no contact data)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ReferralAdminController.prototype, "one", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('reviewFraud')),
    (0, common_1.Post)(':id/decision'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-B1 QUALIFY_OVERRIDE (two people), REJECT or RELEASE_HOLD' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, DecisionBody]),
    __metadata("design:returntype", void 0)
], ReferralAdminController.prototype, "decide", null);
exports.ReferralAdminController = ReferralAdminController = __decorate([
    (0, swagger_1.ApiTags)('growth-referral'),
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('read')),
    (0, common_1.Controller)('admin/growth/referrals'),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, referral_qualification_service_1.ReferralQualificationService])
], ReferralAdminController);
//# sourceMappingURL=referral-admin.controller.js.map