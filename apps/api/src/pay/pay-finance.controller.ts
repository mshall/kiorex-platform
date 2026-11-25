import { Body, Controller, StreamableFile, Get, Header, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { AuthUser, CurrentUser, Public, Roles } from '../common/auth';
import { badRequest } from '../common/errors';
import { PayUnifiedService } from './pay-unified.service';

const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;
const ARR = { schema: { type: 'array', items: { type: 'object', additionalProperties: true } } } as const;
/** Finance-only money views: matching, rollups and the money side of fraud. `finance` + `super_admin` (the role matrix of the Growth console); `ops_admin` alone cannot read them. */
export const PAY_FINANCE_ROLES = ['super_admin', 'finance'];
/** Fraud review is a support act (like referral fraud): support and super admin decide, finance reads. */
export const PAY_FRAUD_REVIEW_ROLES = ['super_admin', 'support'];

class PayIpnFileBody { @IsString() @MinLength(1) @MaxLength(8_000_000) content!: string; @IsOptional() @IsIn(['csv', 'json']) format?: 'csv' | 'json'; @IsOptional() @IsString() @MaxLength(200) filename?: string }
class PayMatchConfirmBody { @IsString() @MinLength(3) @MaxLength(80) targetId!: string }
class PayMatchNoteBody { @IsOptional() @IsString() @MaxLength(300) note?: string }
class PayFraudReviewBody { @IsIn(['CONFIRMED', 'FALSE_POSITIVE', 'DISMISSED']) outcome!: 'CONFIRMED' | 'FALSE_POSITIVE' | 'DISMISSED'; @IsOptional() @IsString() @MaxLength(300) note?: string }
class PayOrgPrefBody { @IsObject() preference!: { order: string[]; blocked?: string[] } }
class PayLinkIssueBody {
  @IsIn(['CLINIC_INVOICE', 'HOME_VISIT', 'FRONT_DESK', 'SAAS_INVOICE', 'ORDER', 'OTHER']) context!: 'CLINIC_INVOICE' | 'HOME_VISIT' | 'FRONT_DESK' | 'SAAS_INVOICE' | 'ORDER' | 'OTHER';
  @IsString() @MinLength(1) @MaxLength(120) subjectId!: string;
  @IsString() @MinLength(1) @MaxLength(120) organisationId!: string;
  @IsOptional() @IsString() @MaxLength(120) branchId?: string;
  @IsInt() @Min(1) @Max(2_147_483_647) amountMinor!: number;
  @IsOptional() @IsString() @Matches(/^[A-Za-z]{3}$/) currency?: string;
  @IsOptional() @IsIn(['card', 'wallet']) rail?: string;
  @IsOptional() @IsInt() @Min(60) @Max(604800) ttlSec?: number;
}

@ApiTags('ops')
@Controller('admin/payments')
export class PayFinanceController {
  constructor(private readonly u: PayUnifiedService) {}

  @ApiOkResponse(OBJ) @Roles(...PAY_FINANCE_ROLES) @Post('matching/ipn') @HttpCode(200) @ApiOperation({ summary: 'Upload a bank IPN file (CSV / JSON): rows are matched to payments; exact matches apply, the rest wait for finance' })
  ipn(@CurrentUser() a: AuthUser, @Body() b: PayIpnFileBody) { return this.u.ingestIpnFile({ content: b.content, format: b.format, filename: b.filename, actor: a.sub }); }
  @ApiOkResponse(ARR) @Roles(...PAY_FINANCE_ROLES) @Get('matching/queue') queue(@Query('status') status?: string) { return this.u.queue({ status }); }
  @ApiOkResponse(OBJ) @Roles(...PAY_FINANCE_ROLES) @Post('matching/:id/confirm') @HttpCode(200) confirm(@CurrentUser() a: AuthUser, @Param('id') id: string, @Body() b: PayMatchConfirmBody) { return this.u.confirm(id, b.targetId, a.sub); }
  @ApiOkResponse(OBJ) @Roles(...PAY_FINANCE_ROLES) @Post('matching/:id/reject') @HttpCode(200) reject(@CurrentUser() a: AuthUser, @Param('id') id: string, @Body() b: PayMatchNoteBody) { return this.u.reject(id, a.sub, b.note); }

  @ApiOkResponse(OBJ) @Roles('super_admin', 'finance', 'ops_admin') @Post('links') @HttpCode(200) @ApiOperation({ summary: 'Create a signed, expiring, single-use, amount-locked payment link with a QR plan' })
  link(@CurrentUser() a: AuthUser, @Body() b: PayLinkIssueBody) { return this.u.createLink({ ...b, actor: a.sub }); }
  @ApiOkResponse(OBJ) @Roles('super_admin', 'finance', 'ops_admin') @Post('links/:id/cancel') @HttpCode(200) cancel(@CurrentUser() a: AuthUser, @Param('id') id: string) { return this.u.cancelLink(id, a.sub); }

  @ApiOkResponse(OBJ) @Roles('super_admin') @Put('organisations/:id/provider-preference') @ApiOperation({ summary: 'Per-organisation provider preference (ordered list, blocked list); audited' })
  pref(@CurrentUser() a: AuthUser, @Param('id') id: string, @Body() b: PayOrgPrefBody) { return this.u.setOrgPreference(id, b.preference, a.sub); }
  @ApiOkResponse(OBJ) @Roles(...PAY_FINANCE_ROLES, 'ops_admin') @Get('organisations/:id/provider-preference') async getPref(@Param('id') id: string) { return (await this.u.getOrgPreference(id)) ?? { organisationId: id, order: [], blocked: [] }; }

  @ApiOkResponse(ARR) @Roles(...PAY_FINANCE_ROLES, ...PAY_FRAUD_REVIEW_ROLES) @Get('fraud/queue') fraud(@Query('status') status?: string, @Query('band') band?: string) { return this.u.fraudQueue({ status, band }); }
  @ApiOkResponse(OBJ) @Roles(...PAY_FINANCE_ROLES, ...PAY_FRAUD_REVIEW_ROLES) @Get('fraud/config') fraudConfig() { return this.u.fraudConfigInForce(); }
  @ApiOkResponse(OBJ) @Roles(...PAY_FRAUD_REVIEW_ROLES) @Post('fraud/:id/review') @HttpCode(200) review(@CurrentUser() a: AuthUser, @Param('id') id: string, @Body() b: PayFraudReviewBody) { return this.u.reviewFraud(id, b.outcome, a.sub, b.note); }

  @ApiOkResponse({ description: 'Rollup (json | csv | pdf)', schema: { type: 'object', additionalProperties: true } })
  @Roles(...PAY_FINANCE_ROLES) @Get('reports/rollup') @ApiOperation({ summary: 'Payments rollup by organisation / psp / day / platform; json, CSV or PDF; AR or EN' })
  async rollup(@Res({ passthrough: true }) res: Response, @Query('level') level = 'platform', @Query('from') from?: string, @Query('to') to?: string, @Query('organisationId') organisationId?: string, @Query('lang') lang = 'en', @Query('format') format = 'json') {
    if (!['organisation', 'platform', 'psp', 'day'].includes(level)) throw badRequest('INVALID_LEVEL', 'level must be organisation, platform, psp or day (branches live in the Clinic)');
    const t = to ? new Date(to) : new Date(); const f = from ? new Date(from) : new Date(t.getTime() - 30 * 86_400_000);
    if (Number.isNaN(+t) || Number.isNaN(+f)) throw badRequest('INVALID_RANGE', 'from / to must be dates');
    const r = await this.u.report({ level: level as never, from: f, to: t, organisationId, lang: lang === 'ar' ? 'ar' : 'en', format: format === 'csv' ? 'csv' : format === 'pdf' ? 'pdf' : 'json' });
    res.setHeader('content-type', r.contentType);
    if (format === 'csv' || format === 'pdf') res.setHeader('content-disposition', `attachment; filename="payments-rollup.${format}"`);
    return Buffer.isBuffer(r.body) ? new StreamableFile(r.body) : r.body;
  }
}

/** Public: the payer's link page and checkout. The token IS the credential (signed, single-use, amount-locked, expiring). */
@ApiTags('pay')
@Controller('pay/l')
export class PayLinkPublicController {
  constructor(private readonly u: PayUnifiedService) {}
  @ApiOkResponse(OBJ) @Public() @Get(':token') status(@Param('token') token: string) { return this.u.linkStatus(token); }
  @ApiOkResponse(OBJ) @Public() @Post(':token/checkout') @HttpCode(200) @Header('cache-control', 'no-store') checkout(@Param('token') token: string) { return this.u.redeemAndCheckout(token); }
}
