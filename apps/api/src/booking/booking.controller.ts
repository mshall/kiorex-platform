import { Body, Controller, Get, Header, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/auth';
import { RequiresFlag } from '../control-plane/control-plane-public';
import { BookingService } from './booking.service';

class CreateBody {
  @IsString() providerId!: string;
  @IsString() typeId!: string;
  @IsDateString() startsAt!: string;
  @IsOptional() @IsDateString() endsAt?: string;
  @IsOptional() @IsString() dependantId?: string;
  @IsOptional() @IsIn(['MARKETPLACE', 'CLINIC_LINK']) channel?: 'MARKETPLACE' | 'CLINIC_LINK';
  @IsOptional() @IsString() bookingPageSlug?: string;
}
class ConfirmBody {
  @IsBoolean() marketplaceConsent!: boolean;
  @IsOptional() @IsBoolean() remindersConsent?: boolean;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}
class CancelBody { @IsOptional() @IsString() @MaxLength(500) reason?: string }
class RescheduleBody { @IsDateString() startsAt!: string; @IsOptional() @IsDateString() endsAt?: string }

@ApiTags('booking')
@Controller()
export class BookingController {
  constructor(private readonly svc: BookingService) {}

  @Post('bookings') @ApiOperation({ summary: 'KXM-BK-02 create intent and 5-minute hold; 409 SLOT_TAKEN carries alternatives (BK-04)' })
  create(@CurrentUser() u: AuthUser, @Body() b: CreateBody) { return this.svc.createIntent(u.sub, b); }

  @Post('bookings/:id/confirm') @HttpCode(200) @ApiOperation({ summary: 'KXM-BK-03/05/06 idempotent confirm (Kiorly Idempotency-Key = booking id)' })
  confirm(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: ConfirmBody) { return this.svc.confirm(u.sub, id, b); }

  @Post('bookings/:id/release') @HttpCode(200) release(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.release(u.sub, id); }
  @Post('bookings/:id/cancel') @HttpCode(200) @ApiOperation({ summary: 'KXM-BK-07 cancel (policy enforced by Kiorly)' })
  cancel(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: CancelBody) { return this.svc.cancel(u.sub, id, b.reason); }
  @Post('bookings/:id/reschedule') @HttpCode(200) @ApiOperation({ summary: 'KXM-BK-07 reschedule' })
  reschedule(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: RescheduleBody) { return this.svc.reschedule(u.sub, id, b); }

  @Post('bookings/:id/deposit-checkout') @HttpCode(200) @RequiresFlag('kiorex.pay_deposits') @ApiOperation({ summary: 'KXM-PAY-01 start hosted deposit checkout (flag kiorex.pay_deposits)' })
  deposit(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.depositCheckout(u.sub, id); }

  @Get('bookings') list(@CurrentUser() u: AuthUser, @Query('status') status?: string) { return this.svc.list(u.sub, status); }
  @Get('bookings/:id') get(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.get(u.sub, id); }
  @Get('bookings/:id/calendar.ics') @Header('content-type', 'text/calendar; charset=utf-8') @ApiOperation({ summary: 'KXM-BK-09 add to calendar' })
  ics(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.ics(u.sub, id); }
}
