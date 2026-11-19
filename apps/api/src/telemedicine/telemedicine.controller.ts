import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { AuthUser, CurrentUser, Public } from '../common/auth';
import { forbidden } from '../common/errors';
import { ProductKeyGuard, RequiresFlag } from '../control-plane/control-plane-public';
import { TeleProvidersResultDto, TeleSessionDto, VideoTokenDto } from './tele.dto';
import { TelemedicineService } from './telemedicine.service';

export class CreateSessionBody { @ApiProperty({ description: 'Your CONFIRMED booking id (kx_bk_...) with a video-capable doctor' }) @IsString() bookingId!: string }
export class JoinResultDto {
  @ApiProperty({ type: TeleSessionDto }) session!: TeleSessionDto;
  @ApiProperty({ type: VideoTokenDto }) video!: VideoTokenDto;
}

/** Telemedicine (launch-locked `kiorex.telemedicine`): matching + session creation gated; joining/ending an existing visit is not. */
@ApiTags('telemedicine')
@Controller()
export class TelemedicineController {
  constructor(private readonly svc: TelemedicineService) {}

  @Get('telemedicine/providers') @RequiresFlag('kiorex.telemedicine') @ApiOperation({ summary: 'Matching: video-capable doctors for a specialty/keyword (emergency language returns 123 guidance, no results)' })
  @ApiOkResponse({ type: TeleProvidersResultDto })
  providers(@Query('specialty') specialty?: string, @Query('q') q?: string) { return this.svc.match({ specialty, q }); }

  @Post('telemedicine/sessions') @HttpCode(201) @RequiresFlag('kiorex.telemedicine') @ApiOperation({ summary: 'Create the video session for your confirmed booking (idempotent per booking)' })
  @ApiCreatedResponse({ type: TeleSessionDto })
  create(@CurrentUser() u: AuthUser, @Body() b: CreateSessionBody) { return this.svc.create(u.sub, b.bookingId); }

  @Get('telemedicine/sessions') @ApiOkResponse({ type: TeleSessionDto, isArray: true }) list(@CurrentUser() u: AuthUser) { return this.svc.list(u.sub); }
  @Get('telemedicine/sessions/:id') @ApiOkResponse({ type: TeleSessionDto }) get(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.get(u.sub, id); }

  @Post('telemedicine/sessions/:id/join') @HttpCode(200) @ApiOperation({ summary: 'Join: issues a room token (MOCK video provider: fake token). Room opens 15 min before the visit' })
  @ApiOkResponse({ type: JoinResultDto })
  join(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.patientJoin(u.sub, id); }

  @Post('telemedicine/sessions/:id/end') @HttpCode(200) @ApiOkResponse({ type: TeleSessionDto }) end(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.patientEnd(u.sub, id); }

  // ── Kiorly Clinic side (product-key HMAC; clinical record stays in Kiorly) ──
  @Public() @UseGuards(ProductKeyGuard) @Post('telemedicine/clinician/bookings/:bookingId/token') @HttpCode(200)
  @ApiOperation({ summary: 'Kiorly Clinic (product-key HMAC): clinician room token for a Kiorex booking id' })
  @ApiOkResponse({ type: JoinResultDto })
  clinicianToken(@Req() req: { product?: string }, @Param('bookingId') bookingId: string) { this.onlyClinic(req); return this.svc.clinicianJoin(bookingId); }

  @Public() @UseGuards(ProductKeyGuard) @Post('telemedicine/clinician/bookings/:bookingId/end') @HttpCode(200)
  @ApiOperation({ summary: 'Kiorly Clinic (product-key HMAC): end the session' })
  @ApiOkResponse({ type: TeleSessionDto })
  clinicianEnd(@Req() req: { product?: string }, @Param('bookingId') bookingId: string) { this.onlyClinic(req); return this.svc.clinicianEnd(bookingId); }

  private onlyClinic(req: { product?: string }) { if (req.product !== 'kiorly-clinic') throw forbidden('PRODUCT_NOT_ALLOWED', 'Only Kiorly Clinic may use clinician endpoints'); }
}
