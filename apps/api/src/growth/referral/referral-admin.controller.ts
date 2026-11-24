import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthUser, CurrentUser, Roles } from '../../common/auth';
import { forbidden, notFound } from '../../common/errors';
import { subRefOf } from '../../common/privacy-hash';
import { PrismaService } from '../../prisma/prisma.service';
import { rolesFor } from '../admin/growth-access';
import { maskCount } from '../analytics/kanon';
import { ReferralQualificationService } from './referral-qualification.service';

const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;
class DecisionBody {
  @IsIn(['QUALIFY_OVERRIDE', 'REJECT', 'RELEASE_HOLD']) decision!: 'QUALIFY_OVERRIDE' | 'REJECT' | 'RELEASE_HOLD';
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

/**
 * Ops view of referrals (GRW-P2-B1). The overview is AGGREGATE with k >= 10 masking. The reviewer view of one relationship shows the check rows and the fraud signals with an opaque reference of each
 * side, NEVER a phone, name or contact. A decision needs the reviewer role (super admin or support); a QUALIFY_OVERRIDE moves money, so a DIFFERENT person must confirm it with the same call.
 */
@ApiTags('growth-referral')
@Roles(...rolesFor('read'))
@Controller('admin/growth/referrals')
export class ReferralAdminController {
  constructor(private readonly prisma: PrismaService, private readonly qual: ReferralQualificationService) {}

  @Get() @ApiOperation({ summary: 'GRW-P2-B1 funnel counts (k >= 10) and the review queue' }) @ApiOkResponse(OBJ)
  async overview(@Query('take') take?: string) {
    const by = await this.prisma.referralRelationship.groupBy({ by: ['status'], _count: { _all: true } });
    const c = (s: string) => by.find((x) => x.status === s)?._count._all ?? 0;
    const total = by.reduce((s, x) => s + x._count._all, 0);
    const held = await this.prisma.referralRelationship.count({ where: { reviewState: 'HOLD', status: { in: ['SIGNED_UP', 'BOOKED'] } } });
    const queue = await this.prisma.referralRelationship.findMany({ where: { reviewState: 'HOLD', status: { in: ['SIGNED_UP', 'BOOKED'] } }, orderBy: { createdAt: 'asc' }, take: Math.min(Number(take) || 50, 200), select: { id: true, status: true, createdAt: true, holdUntil: true } });
    return {
      funnel: { relationships: maskCount(total), signedUp: maskCount(c('SIGNED_UP')), booked: maskCount(c('BOOKED')), qualified: maskCount(c('QUALIFIED')), rejected: maskCount(c('REJECTED')), expired: maskCount(c('EXPIRED')), onHold: maskCount(held) },
      queue,
      note: 'Counts below 10 are shown as <10. The queue lists relationship ids only.',
    };
  }

  @Get(':id') @ApiOperation({ summary: 'GRW-P2-B1 reviewer view: checks, fraud signals, state (no contact data)' }) @ApiOkResponse(OBJ)
  async one(@Param('id') id: string) {
    const r = await this.prisma.referralRelationship.findUnique({ where: { id }, include: { checks: { orderBy: { at: 'asc' } } } });
    if (!r) throw notFound('REFERRAL_NOT_FOUND', 'Relationship not found');
    const signals = await this.prisma.growthFraudSignal.findMany({ where: { OR: [{ evidenceRef: `rel:${id}` }, { evidenceRef: { startsWith: `claim:${r.codeId}:${subRefOf(r.refereeSub).slice(0, 12)}` } }, { evidenceRef: `cancel:${id}` }] }, orderBy: { createdAt: 'asc' }, select: { id: true, ruleId: true, score: true, reviewStatus: true, createdAt: true } });
    return {
      id: r.id, status: r.status, reviewState: r.reviewState, rejectReason: r.rejectReason, createdAt: r.createdAt, completedAt: r.completedAt, holdUntil: r.holdUntil, qualifiedAt: r.qualifiedAt, ruleVersionId: r.ruleVersionId,
      referrerRef: subRefOf(r.referrerSub), refereeRef: subRefOf(r.refereeSub),
      checks: r.checks.map((c) => ({ key: c.checkKey, passed: c.passed, detail: c.detail, at: c.at })), signals,
    };
  }

  @Roles(...rolesFor('reviewFraud')) @Post(':id/decision') @HttpCode(200) @ApiOperation({ summary: 'GRW-P2-B1 QUALIFY_OVERRIDE (two people), REJECT or RELEASE_HOLD' }) @ApiOkResponse(OBJ)
  decide(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: DecisionBody) {
    if (b.decision === 'QUALIFY_OVERRIDE' && !u.roles.includes('super_admin')) throw forbidden('SUPER_ADMIN_REQUIRED', 'A qualify override needs a super admin');
    return this.qual.decide({ sub: u.sub }, id, b.decision, b.note);
  }
}
