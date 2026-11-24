import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthUser, CurrentUser } from '../../common/auth';
import { RequiresFlag } from '../../control-plane/control-plane-public';
import { CORPORATE_FLAG } from '../growth-flags';
import { CorporateBenefitService } from './corporate-benefit.service';
import { CorporateMemberService } from './corporate-member.service';

const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;
class CorporateJoinBody { @IsOptional() @IsString() @MaxLength(40) code?: string }
class CorporateQuoteQuery { @IsString() @MaxLength(80) bookingId!: string }

/**
 * Patient endpoints of the corporate programme (GRW-P4-C). Every route is the caller's OWN data (the session sub; nothing names another person). Joining needs a verified session; there is no route that
 * moves, tops up, transfers, gifts or withdraws value: the benefit is quoted per booking and settled by Pay through the benefit port. Leaving is always possible and ends eligibility, never history.
 */
@ApiTags('growth-corporate')
@Controller('growth/v1/corporate')
@RequiresFlag(CORPORATE_FLAG)
export class CorporatePublicController {
  constructor(private readonly members: CorporateMemberService, private readonly benefit: CorporateBenefitService) {}
  @Get('me') @ApiOperation({ summary: 'GRW-P4-C my programme and my allowance usage' }) @ApiOkResponse(OBJ)
  me(@CurrentUser() u: AuthUser) { return this.members.me(u.sub); }
  @Post('join') @HttpCode(200) @ApiOperation({ summary: 'GRW-P4-C join with a company code, or with a verified work e-mail when no code is sent' }) @ApiOkResponse(OBJ)
  join(@CurrentUser() u: AuthUser, @Body() b: CorporateJoinBody) { return this.members.join({ sub: u.sub, phone: u.phone, email: u.email, emailVerified: u.emailVerified }, b.code); }
  @Post('leave') @HttpCode(200) @ApiOperation({ summary: 'GRW-P4-C leave the programme' }) @ApiOkResponse(OBJ)
  leave(@CurrentUser() u: AuthUser) { return this.members.leave(u.sub); }
  @Get('benefit/quote') @ApiOperation({ summary: 'GRW-P4-C what the programme would cover of the deposit of one of MY bookings' }) @ApiOkResponse(OBJ)
  async quote(@CurrentUser() u: AuthUser, @Query() q: CorporateQuoteQuery) { return { quote: await this.benefit.quote(u.sub, q.bookingId) }; }
}
