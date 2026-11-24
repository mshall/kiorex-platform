import { Body, Controller, Get, Header, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/auth';
import { RequiresFlag } from '../control-plane/control-plane-public';
import { BookingService } from './booking.service';
import { BookingDto, DepositCheckoutDto } from './booking.dto';

class CreateBody {
  @IsString() providerId!: string;
  @IsString() typeId!: string;
  @IsDateString() startsAt!: string;
  @IsOptional() @IsDateString() endsAt?: string;
  @IsOptional() @IsString() dependantId?: string;
  @IsOptional() @IsIn(['MARKETPLACE', 'CLINIC_LINK']) channel?: 'MARKETPLACE' | 'CLINIC_LINK';
  @IsOptional() @IsString() bookingPageSlug?: string;
  /** Rev 2.3 home visits (KXMHV02/03): HOME needs an address-book entry; the visit type's fee entry decides the location. */
  @IsOptional() @IsIn(['IN_CLINIC', 'HOME']) serviceLocation?: 'IN_CLINIC' | 'HOME';
  @IsOptional() @IsString() addressId?: string;
  /** GRW-P1-C: signed in-session provider-link token carried from the provider's link, QR or widget. Optional; a forged or expired token is ignored, never an error. */
  @IsOptional() @IsString() @MaxLength(600) lt?: string;
}
class ConfirmBody {
  @IsBoolean() marketplaceConsent!: boolean;
  @IsOptional() @IsBoolean() remindersConsent?: boolean;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}
class CancelBody { @IsOptional() @IsString() @MaxLength(500) reason?: string }
class RescheduleBody { @IsDateString() startsAt!: string; @IsOptional() @IsDateString() endsAt?: string }

type GrowthReq = { headers: Record<string, string | string[] | undefined> };
const VISITOR_KEY = /^kxv_[A-Za-z0-9_-]{16,64}$/;
const PLATFORMS = new Set(['web', 'ios', 'android', 'whatsapp', 'widget']);
/** Visitor key for attribution: header `X-KX-Visitor` (apps) or the `kxv` cookie (web). Only a well-formed key is used; consent is re-checked by the attribution service. */
export function growthContextOf(req: GrowthReq, platformHeader?: string) {
  const h = (n: string) => { const v = req.headers[n]; return Array.isArray(v) ? v[0] : v; };
  const cookie = /(?:^|;\s*)kxv=([^;]+)/.exec(h('cookie') ?? '')?.[1];
  const raw = h('x-kx-visitor') ?? cookie;
  const pf = (platformHeader ?? h('x-kx-platform') ?? '').toLowerCase();
  return { visitorKey: raw && VISITOR_KEY.test(raw) ? raw : null, platform: PLATFORMS.has(pf) ? pf : undefined };
}

@ApiTags('booking')
@Controller()
export class BookingController {
  constructor(private readonly svc: BookingService) {}

  @ApiCreatedResponse({ type: BookingDto })

  @ApiHeader({ name: 'X-KX-Platform', required: false, description: 'web | ios | android | whatsapp | widget (closed set for the growth stream; read from the request headers, optional)' })
  @Post('bookings') @ApiOperation({ summary: 'KXM-BK-02 create intent and 5-minute hold; 409 SLOT_TAKEN carries alternatives (BK-04). HOME visit types need addressId (KXMHV03); 422 OUT_OF_COVERAGE when the district is not covered' })
  create(@CurrentUser() u: AuthUser, @Body() b: CreateBody, @Req() req: GrowthReq) { return this.svc.createIntent(u.sub, b, growthContextOf(req)); }

  @ApiOkResponse({ type: BookingDto })

  @ApiHeader({ name: 'X-KX-Platform', required: false, description: 'web | ios | android | whatsapp | widget (closed set for the growth stream; read from the request headers, optional)' })
  @Post('bookings/:id/confirm') @HttpCode(200) @ApiOperation({ summary: 'KXM-BK-03/05/06 idempotent confirm (Kiorly Idempotency-Key = booking id)' })
  confirm(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: ConfirmBody, @Req() req: GrowthReq) { return this.svc.confirm(u.sub, id, b, growthContextOf(req)); }

  @ApiOkResponse({ type: BookingDto })

  @Post('bookings/:id/release') @HttpCode(200) release(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.release(u.sub, id); }
  @ApiOkResponse({ type: BookingDto })
  @Post('bookings/:id/cancel') @HttpCode(200) @ApiOperation({ summary: 'KXM-BK-07 cancel (policy enforced by Kiorly)' })
  cancel(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: CancelBody) { return this.svc.cancel(u.sub, id, b.reason); }
  @ApiOkResponse({ type: BookingDto })
  @Post('bookings/:id/reschedule') @HttpCode(200) @ApiOperation({ summary: 'KXM-BK-07 reschedule' })
  reschedule(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: RescheduleBody) { return this.svc.reschedule(u.sub, id, b); }

  @ApiOkResponse({ type: DepositCheckoutDto })

  @Post('bookings/:id/deposit-checkout') @HttpCode(200) @RequiresFlag('kiorex.pay_deposits') @ApiOperation({ summary: 'KXM-PAY-01 start hosted deposit checkout (flag kiorex.pay_deposits)' })
  deposit(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.depositCheckout(u.sub, id); }

  @ApiOkResponse({ type: BookingDto, isArray: true })

  @Get('bookings') list(@CurrentUser() u: AuthUser, @Query('status') status?: string) { return this.svc.list(u.sub, status); }
  @ApiOkResponse({ type: BookingDto })
  @Get('bookings/:id') get(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.get(u.sub, id); }
  @ApiOkResponse({ description: 'iCalendar (text/calendar)', schema: { type: 'string' } })
  @Get('bookings/:id/calendar.ics') @Header('content-type', 'text/calendar; charset=utf-8') @ApiOperation({ summary: 'KXM-BK-09 add to calendar' })
  ics(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.ics(u.sub, id); }
}
