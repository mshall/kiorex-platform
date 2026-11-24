import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthUser, CurrentUser, OpsOnly, Public } from '../common/auth';
import { OkDto } from '../common/dto';
import { conflict } from '../common/errors';
import { BookingService } from '../booking/booking-public';
import { CONTINUITY_HEADER, continuityIdFrom } from '../growth/growth-ports-public';
import { TrustService } from '../trust/trust-public';
import { CarePlanService } from './care-plan.service';
import { FamilyShareService } from './family-share.service';
import { SafetyService } from './safety.service';
import { CarePlanDto, EscalationLogDto, FamilyShareCreatedDto, FamilyShareDto, ProblemReportDto, PublicVisitStatusDto, SafetyAlertDto, SafetyAlertListDto, SafetyCardDto, SafetySummaryDto, SweepSafetyDto, UnsafeAbortDto } from './homecare.dto';
import { cfg } from '../common/config';

class FamilyShareBody {
  @IsString() @MaxLength(80) contactName!: string;
  @IsString() @MaxLength(20) phone!: string;
  @IsOptional() @IsIn(['ar', 'en']) locale?: 'ar' | 'en';
  @IsBoolean() consentAttested!: boolean;
  @IsOptional() @IsBoolean() visitStatusSharingConsent?: boolean;
}
class ProblemBody {
  @IsIn(['SAFETY', 'CONDUCT', 'PROVIDER_NO_SHOW', 'BILLING', 'OTHER']) category!: string;
  @IsOptional() @IsString() @MaxLength(1000) body?: string;
}
class CarePlanBody {
  @IsString() providerId!: string;
  @IsString() addressId!: string;
  @IsOptional() @IsString() typeId?: string;
  @IsOptional() @IsString() preferredStartDate?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
class NoteBody { @IsOptional() @IsString() @MaxLength(500) note?: string }

/** Patient-facing home-visit extras: family share (KXMHV07), safety card + report a problem (KXMHV09), care plans (KXMHV08, P3 draft). */
@ApiTags('home-visits')
@Controller()
export class HomeCareController {
  constructor(private readonly shares: FamilyShareService, private readonly booking: BookingService, private readonly trust: TrustService, private readonly plans: CarePlanService) {}

  @ApiCreatedResponse({ type: FamilyShareCreatedDto })
  @Post('bookings/:id/family-shares') @ApiOperation({ summary: 'KXMHV07 share the visit status with a family contact by WhatsApp link (max 3; needs consentAttested + VISIT_STATUS_SHARING consent)' })
  addShare(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: FamilyShareBody) { return this.shares.create(u.sub, id, b); }
  @ApiOkResponse({ type: FamilyShareDto, isArray: true })
  @Get('bookings/:id/family-shares') listShares(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.shares.list(u.sub, id); }
  @ApiOkResponse({ type: OkDto })
  @Delete('bookings/:id/family-shares/:shareId') revokeShare(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('shareId') shareId: string) { return this.shares.revoke(u.sub, id, shareId); }

  @ApiOkResponse({ type: PublicVisitStatusDto })
  @Public() @Get('public/visit-status/:token') @ApiOperation({ summary: 'Family link (no login): visit status only. Never address, fee, phone or reasons' })
  publicStatus(@Param('token') token: string) { return this.shares.publicStatus(token); }
  @ApiOkResponse({ type: OkDto })
  @Public() @Post('public/visit-status/:token/stop') @HttpCode(200) @ApiOperation({ summary: 'Family contact stops the updates (STOP)' })
  stop(@Param('token') token: string) { return this.shares.stop(token); }

  @ApiOkResponse({ type: SafetyCardDto })
  @Get('bookings/:id/safety-card') @ApiOperation({ summary: 'KXMHV09 safety card: provider photo, name and badge before arrival, emergency number, report-a-problem' })
  async safetyCard(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const b = await this.booking.ownedBooking(u.sub, id);
    if (b.serviceLocation !== 'HOME') throw conflict('NOT_A_HOME_BOOKING', 'Safety card is for home visits');
    const p = await this.booking.providerOf(b);
    const prog = await this.booking.homeProgress(b, p);
    const raw: any = p?.raw ?? {};
    const a = prog.assignee;
    return {
      bookingId: b.id,
      provider: { displayName: a?.displayName ?? p?.nameEn ?? null, displayNameAr: a ? null : p?.nameAr ?? null, photoUrl: a?.photoUrl ?? raw.provider?.photoUrl ?? null, badge: a?.badge ?? null, profession: a?.profession ?? p?.profession ?? null, verified: p?.status === 'LIVE', register: p?.verificationRegister ?? null, agency: !!p?.assignsClinician },
      assignmentPending: prog.assignmentPending, emergencyNumber: '123',
      reportProblem: { slaMinutes: Math.round(cfg().homeComplaintSlaMinutes), endpoint: `/api/v1/bookings/${b.id}/report-problem` },
      familyShare: { max: cfg().familyShareMax, active: await this.shares.activeCount(b.id) },
    };
  }

  @ApiCreatedResponse({ type: ProblemReportDto })
  @Post('bookings/:id/report-problem') @ApiOperation({ summary: 'KXMHV09 report a problem during/after a home visit: routes to ops with a 1 h SLA (KXMOP05)' })
  async report(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: ProblemBody) {
    const bk = await this.booking.ownedBooking(u.sub, id);
    if (bk.serviceLocation !== 'HOME') throw conflict('NOT_A_HOME_BOOKING', 'Use /complaints for clinic visits');
    const c = await this.trust.complain(u.sub, { category: `HOME_${b.category}`, body: b.body ?? '', bookingId: id });
    return { id: c.id, category: c.category, slaDueAt: c.slaDueAt, homeVisit: c.homeVisit, status: c.status };
  }

  @ApiCreatedResponse({ type: CarePlanDto })
  @Post('care-plans') @ApiOperation({ summary: 'KXMHV08 (P3 draft) request a care plan; 403 FEATURE_DISABLED until nurse.care_plans (GKN1) and kiorex.home_visits are effective' })
  requestPlan(@CurrentUser() u: AuthUser, @Body() b: CarePlanBody, @Headers(CONTINUITY_HEADER) cont?: string) { return this.plans.request(u.sub, b, { continuityId: continuityIdFrom(cont) }); }
  @ApiOkResponse({ type: CarePlanDto, isArray: true })
  @Get('care-plans') listPlans(@CurrentUser() u: AuthUser) { return this.plans.list(u.sub); }
  @ApiOkResponse({ type: CarePlanDto })
  @Get('care-plans/:id') getPlan(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.plans.get(u.sub, id); }
}

/** KXMOP12 home-visit safety console API. */
@ApiTags('ops')
@OpsOnly()
@Controller('admin/safety')
export class SafetyConsoleController {
  constructor(private readonly svc: SafetyService) {}

  @ApiOkResponse({ type: SafetyAlertListDto })
  @Get('alerts') @ApiOperation({ summary: 'KXMOP12 SAFETY_ALERT_RAISED feed with the 60 s delivery SLO fields' })
  alerts(@Query('status') status?: string, @Query('kind') kind?: string, @Query('limit') limit?: string) { return this.svc.list({ status, kind, limit: limit ? Number(limit) : undefined }); }
  @ApiOkResponse({ type: SafetySummaryDto })
  @Get('summary') summary() { return this.svc.summary(); }
  @ApiOkResponse({ type: EscalationLogDto, isArray: true })
  @Get('escalations') escalations() { return this.svc.escalationLog(); }
  @ApiOkResponse({ type: UnsafeAbortDto, isArray: true })
  @Get('unsafe-aborts') unsafeAborts() { return this.svc.unsafeAborts(); }
  @ApiOkResponse({ type: SafetyAlertDto })
  @Get('alerts/:id') get(@Param('id') id: string) { return this.svc.get(id); }
  @ApiOkResponse({ type: SafetyAlertDto })
  @Post('alerts/:id/acknowledge') @HttpCode(200) ack(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: NoteBody) { return this.svc.acknowledge(u.sub, id, b.note); }
  @ApiOkResponse({ type: SafetyAlertDto })
  @Post('alerts/:id/escalate') @HttpCode(200) escalate(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: NoteBody) { return this.svc.escalate(u.sub, id, b.note); }
  @ApiOkResponse({ type: SafetyAlertDto })
  @Post('alerts/:id/resolve') @HttpCode(200) resolve(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: NoteBody) { return this.svc.resolve(u.sub, id, b.note); }
  @ApiOkResponse({ type: SweepSafetyDto })
  @Post('sweep') @HttpCode(200) @ApiOperation({ summary: 'Retry undelivered alerts and auto-escalate alerts unacknowledged for 10 minutes' })
  sweep() { return this.svc.sweep(); }
}
