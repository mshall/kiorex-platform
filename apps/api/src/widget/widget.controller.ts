import { Body, Controller, Get, HttpCode, Post, Query, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { GROWTH_ERROR_STATUS } from '@kiorex/contracts';
import { OpsOnly, Public } from '../common/auth';
import { ApiError, badRequest, forbidden, notFound } from '../common/errors';
import { ipHashOf } from '../common/privacy-hash';
import { CatalogService } from '../catalog/catalog-public';
import { FlagsService } from '../control-plane/control-plane-public';
import { PrismaService } from '../prisma/prisma.service';
import { WidgetAuditService } from './widget-audit.service';
import { WidgetLimiter, widgetLimits } from './widget-limiter';
import { originOfUrl, widgetSelfOrigin } from './widget-origins';
import { WidgetPolicyService } from './widget-policy.service';
import { WidgetRegistrationService } from './widget-registration.service';
import { issueWidgetToken } from './widget-token';
import { widgetCfg } from './widget.config';

class SessionBody {
  /** The organisation (clinic) slug of the embed URL. */
  @IsString() @MaxLength(80) org!: string;
  /** Origin of the embedding page as the browser reported it (postMessage event.origin, or ancestorOrigins / referrer for a plain iframe). Re-checked against the allow-list. */
  @IsString() @MaxLength(255) parentOrigin!: string;
  @IsOptional() @IsBoolean() sandbox?: boolean;
}

@ApiTags('widget')
@Controller('widget/v1')
export class WidgetController {
  constructor(
    private readonly flags: FlagsService, private readonly regs: WidgetRegistrationService, private readonly audit: WidgetAuditService, private readonly limiter: WidgetLimiter,
    private readonly policy: WidgetPolicyService, private readonly prisma: PrismaService, private readonly catalog: CatalogService,
  ) {}

  @Public() @Post('session') @HttpCode(200)
  @ApiOperation({ summary: 'GRW-P1-G short-lived widget session token bound to the embedding origin (HMAC, no personal data). 403 GROWTH_WIDGET_ORIGIN_NOT_ALLOWED for an origin that is not in the organisation allow-list; 403 FEATURE_DISABLED when growth.widgets is OFF' })
  @ApiOkResponse({ description: '{ token, expiresAt, org, slug }' })
  async session(@Req() req: any, @Body() b: SessionBody) {
    await this.flags.assertEnabled('growth.widgets', { market: 'EG' });
    const self = widgetSelfOrigin(req.protocol, req.headers?.host);
    const seen = originOfUrl(req.headers?.origin);
    if (!seen || seen !== self) { await this.audit.denied(null, req.headers?.origin ?? '', 'ORIGIN_MISMATCH', 'session'); throw forbidden('WIDGET_ORIGIN_MISMATCH', 'Sessions are issued to the widget app only'); }
    await this.limiter.take('session-ip', ipHashOf(req.ip), widgetLimits().sessionPerMin);
    const reg = await this.regs.resolve(b.org);
    if (!reg) throw notFound('WIDGET_NOT_FOUND', 'Unknown organisation');
    const parent = originOfUrl(b.parentOrigin);
    if (!parent) { await this.audit.denied(reg.orgRef, b.parentOrigin, 'NO_PARENT', 'session'); throw badRequest('WIDGET_PARENT_ORIGIN_REQUIRED', 'The embedding page origin could not be determined'); }
    const sandbox = b.sandbox === true && widgetCfg().sandbox && parent === self;
    if (!sandbox && !this.regs.effectiveOrigins(reg).includes(parent)) {
      await this.audit.denied(reg.orgRef, parent, 'ORIGIN_NOT_ALLOWED', 'session');
      throw new ApiError(GROWTH_ERROR_STATUS.GROWTH_WIDGET_ORIGIN_NOT_ALLOWED, 'GROWTH_WIDGET_ORIGIN_NOT_ALLOWED', 'This site is not allowed to embed the booking widget');
    }
    const ttl = (await this.policy.get()).sessionTokenTtlSeconds;
    return { ...issueWidgetToken({ org: reg.orgRef, origin: parent, sandbox }, ttl), org: reg.orgRef, slug: reg.orgSlug ?? reg.orgRef };
  }

  @Public() @Get('config')
  @ApiOperation({ summary: 'GRW-P1-G widget data: clinic, bookable doctors with visit types and fees (IN_CLINIC only), specialties. Needs X-KX-Widget' })
  @ApiOkResponse({ description: 'Widget configuration' })
  async config(@Req() req: any, @Query('doctor') doctor?: string, @Query('specialty') specialty?: string) {
    const w = req.widget as { org: string } | undefined;
    if (!w) throw new ApiError(401, 'WIDGET_TOKEN_INVALID', 'Widget session is required');
    const providers = await this.prisma.provider.findMany({ where: { clinicId: w.org, status: 'LIVE' }, orderBy: [{ nameEn: 'asc' }], take: 60 });
    let doctorId: string | undefined;
    if (doctor) {
      doctorId = providers.find((p) => p.id === doctor)?.id;
      if (!doctorId) { const s = await this.prisma.growthSlug.findFirst({ where: { entityType: 'DOCTOR', slug: String(doctor).slice(0, 80) }, select: { entityId: true } }); doctorId = providers.find((p) => p.id === s?.entityId)?.id; }
      if (!doctorId) throw notFound('WIDGET_DOCTOR_NOT_FOUND', 'This doctor is not available in this widget');
    }
    const picked = providers.filter((p) => (!doctorId || p.id === doctorId) && (!specialty || p.specialty === specialty));
    const raw: any = providers[0]?.raw ?? {};
    const specs = await this.catalog.specialties();
    return {
      org: { id: w.org, slug: (req.widget as any).orgSlug, nameEn: providers[0]?.clinicNameEn ?? raw.clinic?.nameEn ?? null, nameAr: providers[0]?.clinicNameAr ?? raw.clinic?.nameAr ?? null, logoUrl: typeof raw.clinic?.logoUrl === 'string' && /^https:\/\//.test(raw.clinic.logoUrl) ? raw.clinic.logoUrl : null },
      providers: picked.map((p) => {
        const prov: any = (p.raw as any)?.provider ?? {};
        const fees = (prov.fees ?? []).filter((f: any) => this.catalog.feeLocation(p, f) !== 'HOME').map((f: any) => ({ typeId: f.appointmentTypeId, nameEn: f.nameEn ?? null, nameAr: f.nameAr ?? null, amountMinor: Math.round(Number(f.amount) * 100), currency: f.currency ?? p.currency }));
        return { id: p.id, nameEn: p.nameEn, nameAr: p.nameAr, specialty: p.specialty, titleEn: prov.titleEn ?? null, titleAr: prov.titleAr ?? null, photoUrl: typeof (prov.photoUrl ?? null) === 'string' && /^https:\/\//.test(prov.photoUrl) ? prov.photoUrl : null, rating: { average: p.ratingAvg, count: p.ratingCount }, acceptsDeposit: p.acceptsDeposit, fees };
      }).filter((p) => p.fees.length > 0),
      specialties: specs.filter((s: any) => picked.some((p) => p.specialty === s.code)),
      patientUrl: widgetCfg().patientUrl,
      scope: { doctor: doctorId ?? null, specialty: specialty ?? null },
    };
  }

  @OpsOnly() @Get('ops/audit')
  @ApiOperation({ summary: 'GRW-P1-G ops-visible audit: refused origins, invalid tokens and allow-list changes (AuditLog resource WidgetRegistration)' })
  @ApiOkResponse({ description: 'Audit rows, newest first' })
  opsAudit(@Query('org') org?: string, @Query('limit') limit?: string) { return this.audit.list({ orgRef: org, limit: limit ? Number(limit) : undefined }); }

  @OpsOnly() @Get('ops/registrations')
  @ApiOperation({ summary: 'GRW-P1-G widget registrations (verified origins per clinic, synced from PROVIDER_PROFILE_UPDATED)' })
  @ApiOkResponse({ description: 'Registrations' })
  async opsRegistrations() { return (await this.regs.list()).map((r) => ({ orgRef: r.orgRef, orgSlug: r.orgSlug, origins: r.origins, status: r.status, syncedAt: r.syncedAt })); }
}
