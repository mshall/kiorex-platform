import { Body, Controller, Get, Header, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { AuthUser, CurrentUser, Roles } from '../../common/auth';
import { cfg } from '../../common/config';
import { ApiError } from '../../common/errors';
import { subRefOf } from '../../common/privacy-hash';
import { RequiresFlag } from '../../control-plane/control-plane-public';
import { PrismaService } from '../../prisma/prisma.service';
import { rolesFor } from '../admin/growth-access';
import { GROWTH_FLAG } from '../growth-flags';
import { GoodwillService } from './goodwill.service';
import { RewardFinanceService } from './reward-finance.service';
import { RewardHoldService } from './reward-hold.service';
import { RewardLedgerService } from './reward-ledger.service';
import { RewardReconcileJob } from './reward-reconcile.job';
import { RewardReversalService } from './reward-reversal.service';
import { RewardExpiryJob } from './reward-expiry.job';
import { RewardPolicyService } from './reward-policy.service';
import { GOODWILL_REASONS } from './goodwill-limits';

const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;
const ARR = { schema: { type: 'array', items: { type: 'object', additionalProperties: true } } } as const;
const SUB = /^[A-Za-z0-9_.:@|-]{3,128}$/;
/** A list size from the query string: a whole number from 1 to `max`, else `def`. */
const boundedTake = (v?: string, max = 200, def = 50) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= 1 ? Math.min(n, max) : def; };

class ManualIssueBody { @IsString() @Matches(SUB) sub!: string; @IsInt() @Min(1) @Max(100_000_000) amountMinor!: number; @IsString() @MaxLength(300) reason!: string; @IsOptional() @IsString() @MaxLength(80) bookingId?: string; @IsOptional() @IsString() @MaxLength(80) ticketRef?: string }
class GoodwillBody { @IsString() @Matches(SUB) sub!: string; @IsIn([...GOODWILL_REASONS]) reason!: string; @IsInt() @Min(1) @Max(100_000_000) amountMinor!: number; @IsOptional() @IsString() @MaxLength(80) bookingId?: string; @IsOptional() @IsString() @MaxLength(80) ticketRef?: string }
class HoldBody { @IsOptional() @IsString() @MaxLength(60) reasonCode?: string }
class DecideBody { @IsIn(['APPROVED', 'REJECTED']) decision!: 'APPROVED' | 'REJECTED'; @IsOptional() @IsString() @MaxLength(300) note?: string }

/**
 * Ops API of the patient reward ledger (GRW-P2-B2): reads for every ops role of the Growth module (patients appear only as an opaque reference, never a name or phone), manual issuance, holds and
 * reconcile runs for super admin, goodwill for super admin and support, the finance report for finance and super admin. No endpoint edits or deletes a ledger entry: the ledger is append-only in the database.
 */
@ApiTags('growth-credit')
@Roles(...rolesFor('read'))
@Controller('admin/growth')
export class RewardsAdminController {
  constructor(private readonly prisma: PrismaService, private readonly ledger: RewardLedgerService, private readonly holds: RewardHoldService, private readonly finance: RewardFinanceService, private readonly goodwill: GoodwillService, private readonly reconcile: RewardReconcileJob, private readonly expiry: RewardExpiryJob, private readonly policy: RewardPolicyService, private readonly reversal: RewardReversalService) {}

  @Get('rewards') @ApiOperation({ summary: 'GRW-P2-B2 rules summary, mode, switches and the pricing note' }) @ApiOkResponse(OBJ)
  async overview() {
    const { rules, versionId, source } = await this.policy.rewardRules();
    return {
      mode: rules.mode, effectiveMode: await this.policy.issueMode(rules), ruleVersionId: versionId, source, flags: { rewards: await this.policy.rewardsOn(), patientCredit: await this.policy.creditOn(), refundAsCredit: await this.policy.refundCreditAvailable(rules), family: await this.policy.familyAvailable(rules), goodwill: await this.policy.goodwillOn(), referral: await this.policy.referralOn() },
      amounts: rules.amounts, postToPayLedger: rules.postToPayLedger,
      // AD-4: with no deposit configured and no Kiorex fee there is nothing for a reward to discount
      banner: cfg().depositDefaultMinor === 0 && cfg().homeDepositDefaultMinor === 0 ? 'NO_DEPOSIT_CONFIGURED' : null,
      openApprovals: await this.prisma.rewardApprovalRequest.count({ where: { status: 'PENDING' } }),
    };
  }

  @Get('rewards/lots') @ApiOperation({ summary: 'GRW-P2-B2 lots with balances (patient as an opaque reference)' }) @ApiOkResponse(ARR)
  async lots(@Query('status') status?: string, @Query('kind') kind?: string, @Query('funding') funding?: string, @Query('take') take?: string) {
    const rows = await this.prisma.rewardLot.findMany({ where: { ...(status ? { status } : {}), ...(kind ? { kind } : {}), ...(funding ? { funding } : {}) }, orderBy: { createdAt: 'desc' }, take: boundedTake(take) });
    const balances = await this.ledger.balances(this.prisma, rows.map((l) => l.id));
    return rows.map((l) => { const b = balances.get(l.id)!; return { id: l.id, patientRef: subRefOf(l.ownerSub ?? l.sub), kind: l.kind, mode: l.mode, funding: l.funding, status: l.status, amountMinor: l.amountMinor, currency: l.currency, availableMinor: b.available, heldMinor: b.held, reservedMinor: b.reserved, expiresAt: l.expiresAt, createdAt: l.createdAt, campaignId: l.campaignId, ruleVersionId: l.ruleVersionId }; });
  }
  @Get('rewards/lots/:id/ledger') @ApiOperation({ summary: 'GRW-P2-B2 every entry of one lot (append-only)' }) @ApiOkResponse(ARR)
  async lotLedger(@Param('id') id: string) {
    const lot = await this.prisma.rewardLot.findUnique({ where: { id } });
    if (!lot) throw new ApiError(404, 'REWARD_LOT_NOT_FOUND', 'Reward lot not found');
    return (await this.prisma.rewardLedgerEntry.findMany({ where: { lotId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })).map((e) => ({ id: e.id, type: e.type, amountMinor: e.amountMinor, reasonCode: e.reasonCode, bookingId: e.bookingId, refundId: e.refundId, actor: e.actor, idempotencyKey: e.idempotencyKey, createdAt: e.createdAt }));
  }

  @Roles(...rolesFor('manage')) @RequiresFlag(GROWTH_FLAG.REWARDS) @Post('rewards/manual-issue') @ApiOperation({ summary: 'GRW-P2-B2 manual issuance: reason, daily cap per actor, second approver above the threshold' }) @ApiOkResponse(OBJ)
  manualIssue(@CurrentUser() u: AuthUser, @Body() b: ManualIssueBody) { return this.goodwill.manualIssue(u, b); }
  @Roles(...rolesFor('manage')) @Post('rewards/lots/:id/hold') @HttpCode(200) @ApiOperation({ summary: 'GRW-P2-B2 freeze the available part of a lot (fraud review)' }) @ApiOkResponse(OBJ)
  hold(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: HoldBody) { return this.holds.hold(id, (b.reasonCode ?? 'FRAUD_HOLD').replace(/[^A-Z0-9_]/gi, '_').toUpperCase(), u.sub); }
  @Roles(...rolesFor('manage')) @Post('rewards/lots/:id/release') @HttpCode(200) @ApiOperation({ summary: 'GRW-P2-B2 release a hold' }) @ApiOkResponse(OBJ)
  release(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.holds.release(id, u.sub); }

  @Roles(...rolesFor('manage')) @Post('rewards/lots/:id/reverse') @HttpCode(200) @ApiOperation({ summary: 'GRW-P2-B2 reverse the unspent part of a lot found fraudulent (never a refund credit or restored lot: the patient\'s own money)' }) @ApiOkResponse(OBJ)
  reverse(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: HoldBody) { return this.reversal.reverseLot(id, (b.reasonCode ?? 'MANUAL_REVERSAL').replace(/[^A-Z0-9_]/gi, '_').toUpperCase(), u.sub); }

  @Get('rewards/approvals') @ApiOperation({ summary: 'GRW-P2-B2 pending second-approver requests (manual issue, goodwill)' }) @ApiOkResponse(ARR)
  approvals() { return this.goodwill.pending(); }
  @Roles(...rolesFor('manage')) @Post('rewards/approvals/:id/decide') @HttpCode(200) @ApiOperation({ summary: 'GRW-P2-B2 approve or reject (never the requester)' }) @ApiOkResponse(OBJ)
  decide(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: DecideBody) { return this.goodwill.decide(u, id, b.decision, b.note); }

  @Roles(...rolesFor('readFinance')) @Get('rewards/finance') @ApiOperation({ summary: 'GRW-P2-B2 finance report for a month (YYYY-MM): issued, redeemed, reversed, expired, outstanding; format=csv exports' }) @ApiOkResponse(OBJ)
  async financeReport(@Query('month') month?: string, @Query('format') format?: string) {
    const r = await this.finance.report(month ?? new Date().toISOString().slice(0, 7));
    return format === 'csv' ? { csv: this.finance.csv(r) } : r;
  }
  @Roles(...rolesFor('readFinance')) @Get('rewards/finance.csv') @Header('content-type', 'text/csv; charset=utf-8') @ApiOperation({ summary: 'GRW-P2-B2 finance report as CSV' }) @ApiOkResponse({ schema: { type: 'string' } })
  async financeCsv(@Query('month') month?: string) { return this.finance.csv(await this.finance.report(month ?? new Date().toISOString().slice(0, 7))); }

  @Roles(...rolesFor('manage')) @Post('rewards/housekeeping/run') @HttpCode(200) @ApiOperation({ summary: 'GRW-P2-B2 run the expiry and release job once (idempotent; also what the hourly job does)' }) @ApiOkResponse(OBJ)
  runExpiry() { return this.expiry.runOnce(); }

  // ───────────── credit (patient credit system) ─────────────
  @Get('credit/lots') @ApiOperation({ summary: 'GRW-P2-B2 credit lots (CREDIT mode, refund credit, restored) with the refund-credit liability apart' }) @ApiOkResponse(ARR)
  creditLots(@Query('take') take?: string) { return this.lots(undefined, undefined, undefined, take).then((l) => l.filter((x) => x.mode === 'CREDIT' || x.funding === 'PATIENT_REFUND')); }
  @Roles(...rolesFor('reviewFraud')) @Post('credit/goodwill') @ApiOperation({ summary: 'GRW-P2-B2 support goodwill (flag growth.support_goodwill, second approver above the threshold)' }) @ApiOkResponse(OBJ)
  grantGoodwill(@CurrentUser() u: AuthUser, @Body() b: GoodwillBody) { return this.goodwill.grant(u, b); }
  @Get('credit/reconcile') @ApiOperation({ summary: 'GRW-P2-B2 reconcile runs (RC-1 to RC-7), newest first' }) @ApiOkResponse(ARR)
  reconcileRuns() { return this.reconcile.latest(); }
  @Roles(...rolesFor('manage')) @Post('credit/reconcile/run') @HttpCode(200) @ApiOperation({ summary: 'GRW-P2-B2 run the reconciliation now (never corrects, records a case on failure)' }) @ApiOkResponse(OBJ)
  runReconcile() { return this.reconcile.run(); }
}
