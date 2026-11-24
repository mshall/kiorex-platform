import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { AuthUser, CurrentUser } from '../../common/auth';
import { RequiresFlag } from '../../control-plane/control-plane-public';
import { GROWTH_FLAG } from '../growth-flags';
import { RewardHouseholdService } from './reward-household.service';
import { RewardsQueryService } from './rewards-query.service';

const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;
const loc = (u: AuthUser): 'ar' | 'en' => (u.locale === 'en' ? 'en' : 'ar');

class QuoteBody {
  @IsInt() @Min(1) @Max(2_147_483_647) amountMinor!: number;
  @IsOptional() @IsString() @MaxLength(80) bookingRef?: string;
  @IsOptional() @IsIn(['IN_CLINIC', 'VIDEO', 'HOME_VISIT']) careType?: string;
  /** A coupon code typed at checkout (COUPON mode). Never logged. */
  @IsOptional() @IsString() @MaxLength(24) couponCode?: string;
  /** One tap on a voucher of the list. */
  @IsOptional() @IsString() @Matches(/^rwl_[a-z0-9]+$/) lotId?: string;
}
class HouseholdBody { @IsString() @MaxLength(80) dependantId!: string }

/**
 * Patient endpoints of the reward ledger (contract kiorex-growth.v1.openapi.json 1.1.0, GRW-P2-B2). Every route is the caller's OWN data (sub from the verified session). There is no route that
 * names another subject, moves value, withdraws, tops up or sends a gift: those operations do not exist (S1, S2, S7, asserted by rewards-guard.unit.spec.ts).
 */
@ApiTags('growth-credit')
@Controller('growth/v1')
export class RewardsController {
  constructor(private readonly q: RewardsQueryService, private readonly households: RewardHouseholdService) {}

  @RequiresFlag(GROWTH_FLAG.REWARDS) @Get('referral/rewards') @ApiOperation({ summary: 'GRW-P2-B2 my vouchers and credit lots with expiry and status (coupons are masked until revealed once)' }) @ApiOkResponse(OBJ)
  rewards(@CurrentUser() u: AuthUser, @Query('cursor') cursor?: string, @Query('take') take?: string) { return this.q.rewards(u.sub, { cursor, take: take ? Number(take) : undefined }); }

  @RequiresFlag(GROWTH_FLAG.REWARDS) @Post('rewards/:lotId/reveal') @HttpCode(200) @ApiOperation({ summary: 'GRW-P2-B2 show a coupon code once' }) @ApiOkResponse(OBJ)
  reveal(@CurrentUser() u: AuthUser, @Param('lotId') lotId: string) { return this.q.reveal(u.sub, lotId); }

  @RequiresFlag(GROWTH_FLAG.REWARDS) @Post('rewards/quote') @HttpCode(200) @ApiOperation({ summary: 'GRW-P2-B2 checkout lines for a deposit: price, credit, card (read only; the booking and pay flow apply them)' }) @ApiOkResponse(OBJ)
  quote(@CurrentUser() u: AuthUser, @Body() b: QuoteBody) { return this.q.quote(u.sub, b); }

  @RequiresFlag(GROWTH_FLAG.PATIENT_CREDIT) @Get('credit') @ApiOperation({ summary: 'GRW-P2-B2 my credit: open balance, lots by expiry with scope text, household' }) @ApiOkResponse(OBJ)
  credit(@CurrentUser() u: AuthUser) { return this.q.credit(u.sub, loc(u)); }

  @RequiresFlag(GROWTH_FLAG.FAMILY_CREDIT) @Get('credit/household') @ApiOperation({ summary: 'GRW-P2-B2 my household (owner only)' }) @ApiOkResponse(OBJ)
  household(@CurrentUser() u: AuthUser) { return this.households.view(u.sub); }
  @RequiresFlag(GROWTH_FLAG.FAMILY_CREDIT) @Post('credit/household') @HttpCode(200) @ApiOperation({ summary: 'GRW-P2-B2 let one of my dependants draw from my credit' }) @ApiOkResponse(OBJ)
  addMember(@CurrentUser() u: AuthUser, @Body() b: HouseholdBody) { return this.households.add(u.sub, b.dependantId); }
  @RequiresFlag(GROWTH_FLAG.FAMILY_CREDIT) @Delete('credit/household') @ApiOperation({ summary: 'GRW-P2-B2 stop a member drawing from my credit' }) @ApiOkResponse(OBJ)
  removeMember(@CurrentUser() u: AuthUser, @Query('memberId') memberId: string) { return this.households.remove(u.sub, memberId); }
}
