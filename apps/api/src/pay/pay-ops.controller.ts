import { Body, Controller, Get, Header, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsIn, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { AuthUser, CurrentUser, OpsOnly } from '../common/auth';
import { badRequest } from '../common/errors';
import { PayConnectionService } from './pay-connection.service';
import { PayReconcileService } from './pay-reconcile.service';
import { TEST_SCENARIOS } from './pay-test-cards';
import { PspConfigService } from './psp-config.service';
import { PayService } from './pay.service';
import { PSP_NAMES } from './psp-config';

const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;
const ARR = { schema: { type: 'array', items: { type: 'object', additionalProperties: true } } } as const;

class SettingsBody { @IsOptional() @IsString() @Matches(/^(\*|[A-Za-z]{2})$/) market?: string; @IsObject() settings!: Record<string, unknown> }
class ImportFileBody {
  @IsIn(PSP_NAMES) psp!: string;
  @IsString() @MinLength(1) @MaxLength(200) filename!: string;
  @IsString() @MinLength(1) @MaxLength(8_000_000) content!: string;
  @IsOptional() @IsIn(['CSV', 'JSON']) format?: 'CSV' | 'JSON';
}
class DisputeBody {
  @IsIn(['OPEN', 'WON', 'LOST']) state!: 'OPEN' | 'WON' | 'LOST';
  @IsString() @MinLength(3) @MaxLength(120) @Matches(/^[A-Za-z0-9_.:#-]+$/) reference!: string;
  @IsOptional() @IsInt() @Min(1) @Max(2_147_483_647) amountMinor?: number;
  @IsOptional() @IsString() @MaxLength(64) reasonCode?: string;
  @IsOptional() @IsDateString() evidenceDueAt?: string;
}
class ReasonBody { @IsOptional() @IsString() @MaxLength(300) reason?: string }

/** PAY-READY ops surface: connection check, settings, settlement import, disputes, polling, capture / void, refund retry. Ops roles only; every change is audited with the actor; secrets never appear in a request or a response. */
@ApiTags('ops')
@OpsOnly()
@Controller('admin/payments')
export class PayOpsController {
  constructor(private readonly pay: PayService, private readonly conn: PayConnectionService, private readonly config: PspConfigService, private readonly recon: PayReconcileService) {}

  @ApiOkResponse(OBJ)
  @Get('connection-check') @ApiOperation({ summary: 'Payments connection check: PSP readiness, secret references (never values), webhook URLs, signature self-test; `live=true` adds one read-only authenticated probe per enabled PSP (real mode only)' })
  check(@Query('live') live?: string) { return this.conn.check({ live: live === 'true' }); }

  @ApiOkResponse(ARR)
  @Get('settings') @ApiOperation({ summary: 'Resolved payment settings per PSP and market (env < console), with problems' })
  settings(@Query('market') market?: string) { return this.config.view(market && /^[A-Za-z]{2}$/.test(market) ? market.toUpperCase() : 'EG'); }

  @ApiOkResponse(OBJ)
  @Put('settings/:psp') @HttpCode(200) @ApiOperation({ summary: 'Change settings of one PSP (enabled, order, fees, 3DS, capture mode, refund window, timeouts, retries, tolerance, sandbox/live, settlement format); audited; secrets are refused' })
  saveSettings(@CurrentUser() u: AuthUser, @Param('psp') psp: string, @Body() b: SettingsBody) { return this.config.update(psp, b.market ?? '*', b.settings, u.sub); }

  @ApiOkResponse(OBJ)
  @Post('settlement/import') @HttpCode(200) @ApiOperation({ summary: 'Import a vendor settlement / report file (CSV or JSON), idempotent on the file hash; chargeback lines open disputes' })
  importFile(@CurrentUser() u: AuthUser, @Body() b: ImportFileBody) { return this.pay.importSettlementFile({ psp: b.psp, filename: b.filename, content: b.content, format: b.format, actor: u.sub }); }

  @ApiOkResponse(ARR)
  @Get('settlement/files') files() { return this.recon.files(); }

  @ApiOkResponse({ description: 'Mismatch report of one reconciliation run (CSV)', schema: { type: 'string' } })
  @Get('reconciliation/:runId/mismatches.csv') @Header('content-type', 'text/csv; charset=utf-8') @Header('content-disposition', 'attachment; filename="reconciliation-mismatches.csv"')
  mismatches(@Param('runId') runId: string) { return this.recon.mismatchCsv(runId); }

  @ApiOkResponse(OBJ)
  @Post('poll') @HttpCode(200) @ApiOperation({ summary: 'Run the status-polling fallback now (payments whose callback never arrived)' })
  poll() { return this.pay.pollPending(); }

  @ApiOkResponse(ARR)
  @Get('disputes') disputes(@Query('state') state?: string) { return this.pay.disputes(state && ['OPEN', 'WON', 'LOST'].includes(state) ? state : undefined); }

  @ApiOkResponse(OBJ)
  @Post(':paymentId/dispute') @HttpCode(200) @ApiOperation({ summary: 'Record a dispute / chargeback from the PSP dashboard (OPEN, WON, LOST); idempotent per reference' })
  async dispute(@CurrentUser() u: AuthUser, @Param('paymentId') paymentId: string, @Body() b: DisputeBody) {
    const p = await this.pay.getIntent(paymentId);
    if (!p.pspRef) throw badRequest('NO_PSP_REF', 'Payment has no PSP reference');
    const status = await this.pay.recordDispute(p.psp, { eventId: `ops:${p.id}:${b.reference}:${b.state}`, type: b.state === 'OPEN' ? 'dispute.opened' : b.state === 'WON' ? 'dispute.won' : 'dispute.lost', pspRef: p.pspRef, paymentId: p.id, amountMinor: b.amountMinor ?? p.amountMinor, occurredAt: new Date().toISOString(), dispute: { ref: b.reference, ...(b.reasonCode ? { reasonCode: b.reasonCode } : {}), ...(b.evidenceDueAt ? { evidenceDueAt: b.evidenceDueAt } : {}) } }, b.state);
    await this.pay.auditOps(u.sub, 'pay.ops_dispute', p.id, { state: b.state, reference: b.reference });
    return { status };
  }

  @ApiOkResponse(OBJ)
  @Post(':paymentId/capture') @HttpCode(200) @ApiOperation({ summary: 'Manual capture mode: capture an authorised payment' })
  capture(@CurrentUser() u: AuthUser, @Param('paymentId') id: string) { return this.pay.captureAuthorized(id, u.sub); }

  @ApiOkResponse(OBJ)
  @Post(':paymentId/void') @HttpCode(200) @ApiOperation({ summary: 'Void an authorised payment' })
  void(@CurrentUser() u: AuthUser, @Param('paymentId') id: string, @Body() b: ReasonBody) { return this.pay.voidAuthorized(id, u.sub, b.reason ?? 'OPS_VOID'); }

  @ApiOkResponse(OBJ)
  @Post('refunds/:refundId/retry') @HttpCode(200) @ApiOperation({ summary: 'Retry a FAILED refund' })
  retry(@CurrentUser() u: AuthUser, @Param('refundId') id: string) { return this.pay.retryRefund(id, u.sub); }

  @ApiOkResponse(ARR)
  @Get('test-scenarios') @ApiOperation({ summary: 'The sandbox test scenario matrix (what to run and what Kiorex must show)' })
  scenarios() { return TEST_SCENARIOS; }
}
