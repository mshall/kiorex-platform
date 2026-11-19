import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AuthUser, CurrentUser, Public } from '../common/auth';
import { TrustService } from './trust.service';

class ReviewBody { @IsInt() @Min(1) @Max(5) rating!: number; @IsOptional() @IsString() @MaxLength(2000) text?: string }
class ReviewEdit { @IsOptional() @IsInt() @Min(1) @Max(5) rating?: number; @IsOptional() @IsString() @MaxLength(2000) text?: string }
class ComplaintBody { @IsString() category!: string; @IsString() @MaxLength(2000) body!: string; @IsOptional() @IsString() bookingId?: string }

@ApiTags('trust')
@Controller()
export class TrustController {
  constructor(private readonly svc: TrustService) {}
  @Post('bookings/:id/review') @ApiOperation({ summary: 'KXM-RV-01 review a completed Kiorex visit (flag kiorex.reviews)' })
  submit(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: ReviewBody) { return this.svc.submit(u.sub, id, b); }
  @Put('reviews/:id') @ApiOperation({ summary: 'KXM-RV-01 edit within 7 days' })
  edit(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: ReviewEdit) { return this.svc.edit(u.sub, id, b); }
  @Get('me/reviews') mine(@CurrentUser() u: AuthUser) { return this.svc.mine(u.sub); }
  @Public() @Get('providers/:id/reviews') @ApiOperation({ summary: 'KXM-PR-03 latest 20 visible reviews with clinic replies' })
  forProvider(@Param('id') id: string) { return this.svc.forProvider(id); }
  @Post('complaints') complain(@CurrentUser() u: AuthUser, @Body() b: ComplaintBody) { return this.svc.complain(u.sub, b); }
}
