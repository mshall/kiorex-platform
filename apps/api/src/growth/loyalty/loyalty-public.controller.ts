import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { AuthUser, CurrentUser } from '../../common/auth';
import { RequiresFlag } from '../../control-plane/control-plane-public';
import { LOYALTY_FLAG } from '../growth-flags';
import { LoyaltyService } from './loyalty.service';
import { PartnershipOfferService } from './partnership-offer.service';

const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;
class ConvertBody { @IsString() @Matches(/^[A-Za-z0-9_-]{8,64}$/) requestKey!: string }
class RedeemBody { @IsString() @MaxLength(40) code!: string }
class HistoryQuery { @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) take?: number }

/**
 * Patient endpoints of loyalty and partner offers (GRW-P4-D). Every route is the caller's OWN data (the session sub; nothing names another person). Points are not money: the only way to use them is
 * `convert`, which exchanges one block of points for a voucher or credit lot that then lives in the normal rewards wallet. There is no route to top up, transfer, gift, sell or withdraw points.
 */
@ApiTags('growth-loyalty')
@Controller('growth/v1/loyalty')
@RequiresFlag(LOYALTY_FLAG)
export class LoyaltyPublicController {
  constructor(private readonly loyalty: LoyaltyService, private readonly programs: PartnershipOfferService) {}
  @Get('me') @ApiOperation({ summary: 'GRW-P4-D my tier, progress, points and the conversion on offer' }) @ApiOkResponse(OBJ)
  me(@CurrentUser() u: AuthUser) { return this.loyalty.me(u.sub); }
  @Get('history') @ApiOperation({ summary: 'GRW-P4-D my points movements (no booking or provider detail)' }) @ApiOkResponse(OBJ)
  history(@CurrentUser() u: AuthUser, @Query() q: HistoryQuery) { return this.loyalty.history(u.sub, q.take); }
  @Post('convert') @HttpCode(200) @ApiOperation({ summary: 'GRW-P4-D exchange one block of points for a voucher or credit lot (one transaction; retry-safe with the same requestKey)' }) @ApiOkResponse(OBJ)
  convert(@CurrentUser() u: AuthUser, @Body() b: ConvertBody) { return this.loyalty.convert(u.sub, b.requestKey); }
  @Post('partner/redeem') @HttpCode(200) @ApiOperation({ summary: 'GRW-P4-D redeem a partner code for a voucher (one per person per offer)' }) @ApiOkResponse(OBJ)
  redeem(@CurrentUser() u: AuthUser, @Body() b: RedeemBody) { return this.programs.redeem(u.sub, b.code); }
}
