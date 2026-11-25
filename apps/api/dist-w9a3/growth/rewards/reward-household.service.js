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
exports.RewardHouseholdService = void 0;
const common_1 = require("@nestjs/common");
const errors_1 = require("../../common/errors");
const prisma_service_1 = require("../../prisma/prisma.service");
const growth_flags_1 = require("../growth-flags");
const reward_policy_service_1 = require("./reward-policy.service");
let RewardHouseholdService = class RewardHouseholdService {
    prisma;
    policy;
    constructor(prisma, policy) {
        this.prisma = prisma;
        this.policy = policy;
    }
    async assertOn() { if (!(await this.policy.familyAvailable()))
        throw new errors_1.ApiError(403, 'FEATURE_DISABLED', 'Household credit is switched off', { key: 'growth.family_credit', scope: 'global' }); }
    async view(owner) {
        await this.assertOn();
        const h = await this.prisma.rewardHousehold.findFirst({ where: { ownerSub: owner }, include: { members: { where: { endedAt: null } } } });
        const deps = h?.members.length ? await this.prisma.dependant.findMany({ where: { id: { in: h.members.map((m) => m.memberSub.slice(4)) } }, select: { id: true, nameEn: true, nameAr: true, relationship: true } }) : [];
        return { ownerIsMe: true, members: (h?.members ?? []).map((m) => ({ dependantId: m.memberSub.slice(4), addedAt: m.addedAt, ...(deps.find((d) => d.id === m.memberSub.slice(4)) ?? {}) })) };
    }
    async add(owner, dependantId) {
        await this.assertOn();
        const dep = await this.prisma.dependant.findFirst({ where: { id: dependantId, guardianSub: owner, deletedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
        if (!dep)
            throw new errors_1.ApiError(404, 'DEPENDANT_NOT_FOUND', 'Dependant not found');
        const h = (await this.prisma.rewardHousehold.findFirst({ where: { ownerSub: owner } })) ?? await this.prisma.rewardHousehold.create({ data: { ownerSub: owner, market: growth_flags_1.GROWTH_DEFAULT_MARKET } }).catch(async () => this.prisma.rewardHousehold.findFirstOrThrow({ where: { ownerSub: owner } }));
        await this.prisma.rewardHouseholdMember.upsert({ where: { householdId_memberSub: { householdId: h.id, memberSub: `dep:${dep.id}` } }, create: { householdId: h.id, memberSub: `dep:${dep.id}` }, update: { endedAt: null, addedAt: new Date() } });
        await this.prisma.rewardLot.updateMany({ where: { ownerSub: owner, householdId: null }, data: { householdId: h.id } });
        return this.view(owner);
    }
    async remove(owner, memberId) {
        await this.assertOn();
        const h = await this.prisma.rewardHousehold.findFirst({ where: { ownerSub: owner } });
        if (!h)
            throw new errors_1.ApiError(404, 'HOUSEHOLD_NOT_FOUND', 'No household');
        const r = await this.prisma.rewardHouseholdMember.updateMany({ where: { householdId: h.id, memberSub: `dep:${memberId}`, endedAt: null }, data: { endedAt: new Date() } });
        if (!r.count)
            throw new errors_1.ApiError(404, 'MEMBER_NOT_FOUND', 'Member not found');
        return this.view(owner);
    }
};
exports.RewardHouseholdService = RewardHouseholdService;
exports.RewardHouseholdService = RewardHouseholdService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, reward_policy_service_1.RewardPolicyService])
], RewardHouseholdService);
//# sourceMappingURL=reward-household.service.js.map