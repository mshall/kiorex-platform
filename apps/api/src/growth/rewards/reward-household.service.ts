import { Injectable } from '@nestjs/common';
import { ApiError } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { GROWTH_DEFAULT_MARKET } from '../growth-flags';
import { RewardPolicyService } from './reward-policy.service';

/**
 * Household credit (GRW-P2-B2, behind growth.family_credit and the credit rules). One OWNER holds the credit; dependants (guardian links of the Passport patient profile) are enabled one by one
 * by the owner and then a booking made for them draws from the owner's credit. A dependant who reaches majority, is deleted or leaves the guardian link loses access at once and nothing moves.
 * No owner change, no merge of households, no transfer between households (there is no endpoint for any of them). Members are stored as `dep:<dependantId>`: a dependant never has a sub.
 */
@Injectable()
export class RewardHouseholdService {
  constructor(private readonly prisma: PrismaService, private readonly policy: RewardPolicyService) {}

  private async assertOn() { if (!(await this.policy.familyAvailable())) throw new ApiError(403, 'FEATURE_DISABLED', 'Household credit is switched off', { key: 'growth.family_credit', scope: 'global' }); }

  async view(owner: string) {
    await this.assertOn();
    const h = await this.prisma.rewardHousehold.findFirst({ where: { ownerSub: owner }, include: { members: { where: { endedAt: null } } } });
    const deps = h?.members.length ? await this.prisma.dependant.findMany({ where: { id: { in: h.members.map((m) => m.memberSub.slice(4)) } }, select: { id: true, nameEn: true, nameAr: true, relationship: true } }) : [];
    return { ownerIsMe: true, members: (h?.members ?? []).map((m) => ({ dependantId: m.memberSub.slice(4), addedAt: m.addedAt, ...(deps.find((d) => d.id === m.memberSub.slice(4)) ?? {}) })) };
  }

  async add(owner: string, dependantId: string) {
    await this.assertOn();
    const dep = await this.prisma.dependant.findFirst({ where: { id: dependantId, guardianSub: owner, deletedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
    if (!dep) throw new ApiError(404, 'DEPENDANT_NOT_FOUND', 'Dependant not found');
    const h = (await this.prisma.rewardHousehold.findFirst({ where: { ownerSub: owner } })) ?? await this.prisma.rewardHousehold.create({ data: { ownerSub: owner, market: GROWTH_DEFAULT_MARKET } }).catch(async () => this.prisma.rewardHousehold.findFirstOrThrow({ where: { ownerSub: owner } }));
    await this.prisma.rewardHouseholdMember.upsert({ where: { householdId_memberSub: { householdId: h.id, memberSub: `dep:${dep.id}` } }, create: { householdId: h.id, memberSub: `dep:${dep.id}` }, update: { endedAt: null, addedAt: new Date() } });
    await this.prisma.rewardLot.updateMany({ where: { ownerSub: owner, householdId: null }, data: { householdId: h.id } });
    return this.view(owner);
  }

  async remove(owner: string, memberId: string) {
    await this.assertOn();
    const h = await this.prisma.rewardHousehold.findFirst({ where: { ownerSub: owner } });
    if (!h) throw new ApiError(404, 'HOUSEHOLD_NOT_FOUND', 'No household');
    const r = await this.prisma.rewardHouseholdMember.updateMany({ where: { householdId: h.id, memberSub: `dep:${memberId}`, endedAt: null }, data: { endedAt: new Date() } });
    if (!r.count) throw new ApiError(404, 'MEMBER_NOT_FOUND', 'Member not found');
    return this.view(owner);
  }
}
