import { Body, Controller, Get, Header, Headers, HttpCode, Param, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsIn, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { AuthUser, CurrentUser, OpsOnly, Public, SuperAdminOnly } from '../common/auth';
import { badRequest, forbidden } from '../common/errors';
import { FLAG_CATALOGUE } from './flag-catalogue';
import { FlagGuard } from './flag.guard';
import { FlagsService } from './flags.service';
import { ProductKeyGuard } from './product-key.guard';

class SetFlagBody {
  @IsIn(['GLOBAL', 'MARKET', 'ORG']) scope!: 'GLOBAL' | 'MARKET' | 'ORG';
  @IsOptional() @IsString() scopeId?: string;
  @IsIn(['ON', 'OFF']) value!: 'ON' | 'OFF';
  @IsString() @MaxLength(500) reason!: string;
  @IsString() @MaxLength(100) ticket!: string;
  @IsOptional() @IsDateString() expiresAt?: string;
  @IsOptional() @IsDateString() startsAt?: string;
  @IsOptional() @IsBoolean() emergency?: boolean;
}
class GateBody {
  @IsString() gateId!: string;
  @IsString() approver!: string;
  @IsDateString() approvedOn!: string;
  @IsUrl({ require_tld: false }) documentUrl!: string;
}
class DefinitionBody {
  @IsString() key!: string;
  @IsIn(['kiorly-clinic', 'kiorex', 'kiorex-account', 'kiorly-pharmacy', 'kiorly-lab', 'all']) product!: any;
  @IsIn(['MODULE', 'COMMERCIAL', 'INTEGRATION', 'AI', 'LAUNCH_LOCKED']) class!: any;
  @IsString({ each: true }) scopes!: any[];
  @IsOptional() @IsString({ each: true }) dependsOn?: string[];
  @IsString() description!: string;
  @IsOptional() @IsString() whenOff?: string;
  @IsOptional() @IsBoolean() moneyPath?: boolean;
}
class ReasonBody { @IsString() reason!: string }
class ProductBody {
  @IsOptional() @IsUrl({ require_tld: false }) webhookUrl?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

@ApiTags('control-plane')
@Controller()
export class ControlPlaneController {
  constructor(private readonly flags: FlagsService) {}

  // ── product-facing (HMAC) ──
  @Public() @UseGuards(ProductKeyGuard) @Get('control/v1/flags/snapshot')
  @ApiOperation({ summary: 'Signed flag snapshot per product (ETag, poll every 30 s)' })
  @ApiQuery({ name: 'product', required: true })
  @ApiHeader({ name: 'X-Kiorex-Product-Key', required: true })
  @ApiHeader({ name: 'If-None-Match', required: false })
  async snapshot(@Query('product') product: string, @Req() req: any, @Headers('if-none-match') inm: string | undefined, @Res({ passthrough: true }) res: Response) {
    if (!product) throw badRequest('PRODUCT_REQUIRED', 'product query param required');
    if (req.product !== product) throw forbidden('PRODUCT_KEY_MISMATCH', 'Key does not belong to that product');
    const snap = await this.flags.snapshot(product, { touch: true });
    res.setHeader('ETag', snap.etag);
    res.setHeader('Cache-Control', 'no-cache');
    if (inm && inm === snap.etag) {
      res.status(304);
      return;
    }
    return snap.body;
  }

  // ── Kiorex clients: effective flags for UI gating ──
  @Public() @Get('flags/effective')
  @ApiOperation({ summary: 'Effective state of every Kiorex flag (for web/mobile to hide entry points)' })
  async effective(@Query('market') market = 'EG') {
    const out: Record<string, { enabled: boolean; reason: string; scope?: string }> = {};
    for (const f of FLAG_CATALOGUE.filter((x) => x.product === 'kiorex')) {
      const r = await this.flags.evaluate(f.key, { market });
      out[f.key] = { enabled: r.effective, reason: r.reason, scope: r.scope };
    }
    return { market: market.toUpperCase(), version: await this.flags.currentVersion(), flags: out };
  }

  // ── super admin (KXM-OP-07..11) ──
  @OpsOnly() @Get('admin/flags')
  @ApiOperation({ summary: 'Every flag of every product with effective value, source, class, deps, last change (OP-07)' })
  list(@Query('market') market?: string, @Query('product') product?: string) {
    return this.flags.listAdmin({ market, product });
  }

  @SuperAdminOnly() @Put('admin/flags/:key/values')
  @ApiOperation({ summary: 'Toggle OFF/ON at global/market/org scope; reason+ticket required; optional expiry/schedule; two-person rule for money-path (OP-08/10)' })
  set(@CurrentUser() u: AuthUser, @Param('key') key: string, @Body() b: SetFlagBody) {
    return this.flags.setValue(u.sub, { key, scope: b.scope, scopeId: b.scopeId, value: b.value, reason: b.reason, ticket: b.ticket, expiresAt: b.expiresAt ? new Date(b.expiresAt) : null, startsAt: b.startsAt ? new Date(b.startsAt) : null, emergency: b.emergency });
  }

  @SuperAdminOnly() @Put('admin/flags/:key/gate')
  @ApiOperation({ summary: 'Record launch gate evidence (OP-09). STOP flag: only a human may call this.' })
  gate(@CurrentUser() u: AuthUser, @Param('key') key: string, @Body() b: GateBody) {
    return this.flags.recordGate(u.sub, key, { ...b, approvedOn: new Date(b.approvedOn) });
  }

  @SuperAdminOnly() @Post('admin/flags/:key/gate/revoke') @HttpCode(200)
  revokeGate(@CurrentUser() u: AuthUser, @Param('key') key: string, @Body() b: ReasonBody) {
    return this.flags.revokeGate(u.sub, key, b.reason);
  }

  @SuperAdminOnly() @Post('admin/flags/definitions')
  @ApiOperation({ summary: 'Register a flag definition (e.g. market.<cc>.live). Safety controls are refused (ADR-025).' })
  define(@CurrentUser() u: AuthUser, @Body() b: DefinitionBody) {
    return this.flags.registerDefinition(u.sub, { ...b, dependsOn: b.dependsOn ?? [], whenOff: b.whenOff ?? '', launchLocked: b.class === 'LAUNCH_LOCKED' });
  }

  @OpsOnly() @Get('admin/flags/requests')
  requests(@Query('status') status?: string) {
    return this.flags.listRequests(status);
  }
  @SuperAdminOnly() @Post('admin/flags/requests/:id/approve') @HttpCode(200)
  approve(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.flags.approveRequest(u.sub, id);
  }
  @SuperAdminOnly() @Post('admin/flags/requests/:id/reject') @HttpCode(200)
  reject(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.flags.rejectRequest(u.sub, id);
  }
  @SuperAdminOnly() @Post('admin/flags/requests/:id/review') @HttpCode(200)
  review(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.flags.reviewEmergency(u.sub, id);
  }
  @OpsOnly() @Get('admin/flags/emergency-reviews/overdue')
  overdue() {
    return this.flags.overdueEmergencyReviews();
  }

  @OpsOnly() @Get('admin/flags/audit')
  @ApiOperation({ summary: 'Flag audit trail; ?format=csv exports (OP-11)' })
  async audit(@Query('flagKey') flagKey?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('format') format?: string, @Res({ passthrough: true }) res?: Response) {
    const rows = await this.flags.auditQuery({ flagKey, from: from ? new Date(from) : undefined, to: to ? new Date(to) : undefined });
    if (format === 'csv') {
      res!.setHeader('content-type', 'text/csv; charset=utf-8');
      res!.setHeader('content-disposition', 'attachment; filename="flag-audit.csv"');
      return this.flags.toCsv(rows as any);
    }
    return rows;
  }

  @OpsOnly() @Get('admin/flags/propagation')
  @ApiOperation({ summary: 'Snapshot version and age per product (OP-11)' })
  propagation() {
    return this.flags.propagation();
  }

  @SuperAdminOnly() @Put('admin/flags/products/:product')
  async product(@Param('product') product: string, @Body() b: ProductBody) {
    const data: Record<string, unknown> = {};
    if (b.webhookUrl !== undefined) data.webhookUrl = b.webhookUrl;
    if (b.active !== undefined) data.active = b.active;
    return this.flags['prisma'].productRegistration.update({ where: { product }, data, select: { product: true, webhookUrl: true, active: true } });
  }

  @SuperAdminOnly() @Post('admin/flags/sweep') @HttpCode(200)
  sweep() {
    return this.flags.sweep();
  }
}
