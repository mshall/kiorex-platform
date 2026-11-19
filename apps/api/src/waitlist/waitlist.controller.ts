import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString } from 'class-validator';
import { AuthUser, CurrentUser, OpsOnly } from '../common/auth';
import { RequiresFlag } from '../control-plane/control-plane-public';
import { OkDto } from '../common/dto';
import { WaitlistEntryDto, WaitlistScanResultDto } from './waitlist.dto';
import { WaitlistService } from './waitlist.service';

export class JoinWaitlistBody {
  @IsString() providerId!: string;
  @IsString() typeId!: string;
  @IsOptional() @IsDateString() preferredFrom?: string;
  @IsOptional() @IsDateString() preferredTo?: string;
  @IsOptional() @IsString() dependantId?: string;
}

@ApiTags('waitlist')
@Controller()
export class WaitlistController {
  constructor(private readonly svc: WaitlistService) {}

  @Post('waitlist') @HttpCode(201) @RequiresFlag('kiorex.marketplace')
  @ApiOperation({ summary: 'KXM-BK-12 join a doctor\'s waitlist (idempotent per patient+doctor+visit type)' })
  @ApiCreatedResponse({ type: WaitlistEntryDto })
  join(@CurrentUser() u: AuthUser, @Body() b: JoinWaitlistBody) { return this.svc.join(u.sub, b); }

  @Get('waitlist') @ApiOperation({ summary: 'KXM-BK-12 my waitlist entries with their offers' })
  @ApiOkResponse({ type: WaitlistEntryDto, isArray: true })
  list(@CurrentUser() u: AuthUser) { return this.svc.list(u.sub); }

  @Delete('waitlist/:id') @ApiOkResponse({ type: OkDto }) cancel(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.cancel(u.sub, id); }

  @ApiOkResponse({ schema: { $ref: '#/components/schemas/BookingDto' } })

  @Post('waitlist/offers/:id/accept') @HttpCode(200) @RequiresFlag('kiorex.marketplace')
  @ApiOperation({ summary: 'KXM-BK-12 accept an offered slot: creates the normal 5-minute hold (returns the booking; then POST /bookings/{id}/confirm). 409 SLOT_TAKEN / 410 OFFER_EXPIRED' })
  accept(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.accept(u.sub, id); }

  @Post('waitlist/offers/:id/decline') @HttpCode(200) @ApiOkResponse({ type: OkDto }) decline(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.decline(u.sub, id); }

  @OpsOnly() @Post('admin/waitlist/scan') @HttpCode(200) @ApiOperation({ summary: 'OP: run the waitlist autofill scan now' })
  @ApiOkResponse({ type: WaitlistScanResultDto })
  scan() { return this.svc.scan(); }
}
