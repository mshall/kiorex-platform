import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AuthUser, CurrentUser, Roles } from '../../common/auth';
import { RequiresFlag } from '../../control-plane/control-plane-public';
import { rolesFor } from '../admin/growth-access';
import { GROWTH_FLAG } from '../growth-flags';
import { PromotionLedgerViewService } from './promotion-ledger-view.service';
import { PromotionReviewService } from './promotion-review.service';

const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;
class PromotionDecideBody {
  @IsInt() @Min(1) @Max(1_000_000) version!: number;
  @IsIn(['CONTENT', 'SCOPE', 'HIGH_VALUE']) kind!: 'CONTENT' | 'SCOPE' | 'HIGH_VALUE';
  @IsIn(['APPROVED', 'REJECTED', 'NEEDS_CHANGES']) decision!: 'APPROVED' | 'REJECTED' | 'NEEDS_CHANGES';
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

/**
 * Ops pages of provider-sponsored promotions (GRW-P2-S): the review queue, one promotion with the guard result and the review state, the decision (Super Admin or a growth admin, a second approver for a
 * high-value one), and the per-booking sponsored ledger. Launch-locked behind growth.sponsored_promotions (counsel on advertising and accounting, H-26 to H-28): reads keep working, writes need the flag.
 */
@ApiTags('growth-sponsored-promotions')
@Roles(...rolesFor('read'))
@Controller('admin/growth/sponsored-promotions')
export class PromotionsAdminController {
  constructor(private readonly review: PromotionReviewService, private readonly ledger: PromotionLedgerViewService) {}
  @Get() @ApiOperation({ summary: 'GRW-P2-S review queue (status IN_REVIEW by default; ACTIVE or ALL)' }) @ApiOkResponse(OBJ)
  queue(@Query('status') status?: string, @Query('take') take?: string) { return this.review.queue({ status: status === 'ACTIVE' || status === 'ALL' ? status : 'IN_REVIEW', take: take ? Number(take) : undefined }); }
  @Get(':id') @ApiOperation({ summary: 'GRW-P2-S one promotion: public text, scope, rules, automated guard result, high-value reasons, review state' }) @ApiOkResponse(OBJ)
  detail(@Param('id') id: string, @Query('version') version?: string) { return this.review.detail(id, version ? Number(version) : undefined); }
  @Get(':id/ledger') @ApiOperation({ summary: 'GRW-P2-S the distinct provider-sponsored discount line per booking' }) @ApiOkResponse(OBJ)
  ledgerOf(@Param('id') id: string, @Query('page') page?: string) { return this.ledger.forPromotion(id, page ? Number(page) : 1); }
  @Roles(...rolesFor('reviewPromotions')) @RequiresFlag(GROWTH_FLAG.SPONSORED_PROMOTIONS) @Post(':id/decisions') @HttpCode(200) @ApiOperation({ summary: 'GRW-P2-S decide a review (not the author; a second approver for HIGH_VALUE)' }) @ApiOkResponse(OBJ)
  decide(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: PromotionDecideBody) { return this.review.decide({ sub: u.sub, roles: u.roles }, id, b); }
}
