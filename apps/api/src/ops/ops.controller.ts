import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { FlagsService } from '../control-plane/control-plane-public';
import { SafetyService } from '../homecare/homecare-public';
import { AuthUser, CurrentUser, OpsOnly } from '../common/auth';
import { BookingService } from '../booking/booking-public';
import { CatalogService } from '../catalog/catalog-public';
import { EngagementService } from '../engagement/engagement-public';
import { OkDto } from '../common/dto';
import { KiorlyClient } from '../kiorly/kiorly-public';
import { MessageLogDto, MessagingHub, MessagingStatsDto, DeliveryTickDto, MessageLogItemDto } from '../messaging/messaging-public';
import { HeldDepositDto, HomeGateMetricDto, ReviewDecisionDto, AuditLogDto, CircuitDto, ComplaintDto, FeeStatementDto, ImportResultDto, LiquidityDto, ModerationCaseDto, OpsBookingDto, BookingTimelineOpsDto, OpsMessageDto, OpsOkDto, OpsProviderListDto, OutboxListDto, PaymentsDashboardDto, PayoutRunDto, ReconciliationRunDto, RefundDto, ReplayResultDto, SyncResultDto } from './ops.dto';
import { OutboxService } from '../outbox/outbox-public';
import { PayService } from '../pay/pay-public';
import { PrismaService } from '../prisma/prisma.service';
import { TrustService } from '../trust/trust-public';

class RefundBody { @IsString() paymentId!: string; @IsString() @MinLength(3) @MaxLength(300) reason!: string; @IsOptional() @IsInt() @Min(1) @Max(2_147_483_647) amountMinor?: number }
class PaymentReviewBody { @IsString() reason!: string }
class SimulateBody { @IsIn(['DELIVERED', 'READ', 'FAILED']) state!: 'DELIVERED' | 'READ' | 'FAILED' }
class ResolveBody { @IsIn(['RESTORED', 'KEPT_HIDDEN']) resolution!: 'RESTORED' | 'KEPT_HIDDEN' }
class SettlementLine {
  @IsString() psp!: string;
  @IsString() pspRef!: string;
  @IsIn(['CAPTURE', 'REFUND']) kind!: 'CAPTURE' | 'REFUND';
  @IsInt() amountMinor!: number;
  @IsOptional() @IsInt() feeMinor?: number;
  @IsString() date!: string;
}
class ImportBody {
  @ValidateNested({ each: true }) @Type(() => SettlementLine) lines!: SettlementLine[];
}

@ApiTags('ops')
@OpsOnly()
@Controller('admin')
export class OpsController {
  constructor(
    private readonly catalog: CatalogService, private readonly bookings: BookingService, private readonly outbox: OutboxService, private readonly pay: PayService, private readonly trust: TrustService,
    private readonly kiorly: KiorlyClient, private readonly prisma: PrismaService, private readonly engagement: EngagementService, private readonly hub: MessagingHub, private readonly flags: FlagsService, private readonly safety: SafetyService,
  ) {}

  @ApiOkResponse({ type: OpsProviderListDto })

  @Get('providers') @ApiOperation({ summary: 'KXM-OP-01 provider directory' })
  providers(@Query('status') status?: string, @Query('q') q?: string, @Query('page') page?: string) { return this.catalog.opsList({ status, q, page: page ? Number(page) : 1 }); }
  @ApiOkResponse({ type: SyncResultDto })
  @Post('providers/sync') @HttpCode(200) syncProviders(@Query('full') full?: string) { return this.catalog.syncOnce({ full: full === 'true' }); }

  @ApiOkResponse({ type: OpsBookingDto, isArray: true })

  @Get('bookings') @ApiOperation({ summary: 'KXM-OP-02 bookings' })
  bookingsList(@Query('status') status?: string, @Query('clinicId') clinicId?: string, @Query('sub') sub?: string) { return this.bookings.opsList({ status, clinicId, sub }); }
  @ApiOkResponse({ type: BookingTimelineOpsDto })
  @Get('bookings/:id/timeline') @ApiOperation({ summary: 'KXM-OP-02 booking timeline: intents, holds, Kiorly calls, events, payments' })
  timeline(@Param('id') id: string) { return this.bookings.opsTimeline(id); }

  @ApiOkResponse({ type: OutboxListDto })

  @Get('outbox') @ApiOperation({ summary: 'KXM-OP-03 outbox monitor' })
  async outboxList(@Query('status') status?: string, @Query('type') type?: string) { return { stats: await this.outbox.stats(), items: await this.outbox.list({ status, type }) }; }
  @ApiOkResponse({ type: ReplayResultDto })
  @Post('outbox/:id/replay') @HttpCode(200) @ApiOperation({ summary: 'KXM-OP-03 replay a DEAD/FAILED event' })
  async replay(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.prisma.auditLog.create({ data: { actor: u.sub, action: 'outbox.replay', resource: 'OutboxEvent', resourceId: id } });
    return this.outbox.replay(id);
  }

  @ApiOkResponse({ type: PaymentsDashboardDto })

  @Get('payments/dashboard') @ApiOperation({ summary: 'KXM-OP-04 refunds, payouts, reconciliation dashboard' })
  payments() { return this.pay.dashboard(); }
  @ApiOkResponse({ type: RefundDto })
  @Post('payments/refund') @HttpCode(200)
  async refund(@CurrentUser() u: AuthUser, @Body() b: RefundBody) {
    await this.prisma.auditLog.create({ data: { actor: u.sub, action: 'pay.ops_refund', resource: 'PaymentIntent', resourceId: b.paymentId, metadata: { reason: b.reason, amountMinor: b.amountMinor } } });
    return this.pay.refund(b.paymentId, { reason: `OPS:${b.reason}`, amountMinor: b.amountMinor, idempotencyKey: `ops-refund:${b.paymentId}:${b.amountMinor ?? 'full'}:${b.reason}` });
  }
  @ApiOkResponse({ type: HeldDepositDto, isArray: true })
  @Get('payments/held-for-review') @ApiOperation({ summary: 'KXMPAY07 deposits of unsafe-aborted home visits held for ops review (never auto-forfeited)' })
  heldForReview() { return this.pay.heldForReview(); }
  @ApiOkResponse({ type: ReviewDecisionDto })
  @Post('payments/:paymentId/review/release') @HttpCode(200) @ApiOperation({ summary: 'KXMPAY07 review decision: release the held deposit to the provider (reason required, audited)' })
  reviewRelease(@CurrentUser() u: AuthUser, @Param('paymentId') id: string, @Body() b: PaymentReviewBody) { return this.pay.reviewRelease(id, u.sub, b.reason); }
  @ApiOkResponse({ type: ReviewDecisionDto })
  @Post('payments/:paymentId/review/refund') @HttpCode(200) @ApiOperation({ summary: 'KXMPAY07 review decision: refund the held deposit to the patient (reason required, audited)' })
  reviewRefund(@CurrentUser() u: AuthUser, @Param('paymentId') id: string, @Body() b: PaymentReviewBody) { return this.pay.reviewRefund(id, u.sub, b.reason); }
  @ApiOkResponse({ type: HomeGateMetricDto })
  @Get('home-visits/gate-metric') @ApiOperation({ summary: 'Home-visit release gate: >=50 home-enabled providers per launch cluster, GHV1/GHV2 evidence state, safety console live. The metric never satisfies a gate' })
  async homeGate() {
    const m = await this.catalog.homeGateMetric();
    const board = await this.flags.gateBoard();
    const gates: Record<string, unknown> = {};
    for (const id of ['GHV1', 'GHV2']) gates[id] = { recordedFor: board.gates.find((g) => g.gateId === id)?.flags.filter((f) => f.evidence).map((f) => f.key) ?? [], requiredFor: board.gates.find((g) => g.gateId === id)?.flags.map((f) => f.key) ?? [] };
    return { ...m, gates, safetyConsoleLive: !!this.safety };
  }
  @ApiOkResponse({ type: FeeStatementDto })
  @Get('fee-statements') @ApiOperation({ summary: 'Kiorex\'s own marketplace fee statement per partner (pharmacy/lab take); VAT is a config line.' })
  async feeStatements(@Query('from') from?: string, @Query('to') to?: string) {
    const f = from ? new Date(from) : new Date(Date.now() - 30 * 86400_000);
    const t = to ? new Date(to) : new Date(Date.now() + 86400_000);
    return this.pay.feeStatement({ from: f, to: t });
  }
  @ApiOkResponse({ type: PayoutRunDto })
  @Post('payouts/run') @HttpCode(200) runPayouts() { return this.pay.runPayouts(); }
  @ApiOkResponse({ type: ReconciliationRunDto })
  @Post('reconciliation/psp/run') @HttpCode(200) reconcilePsp(@Query('date') date?: string) { return this.pay.reconcileDaily(date ? new Date(date) : new Date()); }
  @ApiOkResponse({ type: ImportResultDto })
  @Post('reconciliation/psp/import') @HttpCode(200) importLines(@Body() b: ImportBody) { return this.pay.importSettlementLines(b.lines); }
  @ApiOkResponse({ description: 'Nightly booking reconciliation counters', schema: { type: 'object', additionalProperties: true } })
  @Post('reconciliation/bookings/run') @HttpCode(200) reconcileBookings() { return this.bookings.reconcileNightly(); }
  @ApiOkResponse({ type: ReconciliationRunDto, isArray: true })
  @Get('reconciliation/runs') runs() { return this.prisma.reconciliationRun.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }); }

  @ApiOkResponse({ type: ModerationCaseDto, isArray: true })

  @Get('moderation') @ApiOperation({ summary: 'KXM-OP-05 review moderation queue' }) queue(@Query('status') status?: string) { return this.trust.queue(status); }
  @ApiOkResponse({ type: OpsOkDto })
  @Post('moderation/:id/resolve') @HttpCode(200) resolve(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: ResolveBody) { return this.trust.resolve(u.sub, id, b.resolution); }
  @ApiOkResponse({ type: ComplaintDto, isArray: true })
  @Get('complaints') complaints(@Query('status') status?: string) { return this.trust.complaints(status); }
  @ApiOkResponse({ type: OpsOkDto })
  @Post('complaints/:id/resolve') @HttpCode(200) resolveComplaint(@Param('id') id: string) { return this.trust.resolveComplaint(id); }

  @ApiOkResponse({ type: LiquidityDto })

  @Get('liquidity') @ApiOperation({ summary: 'KXM-OP-06 cluster liquidity metrics' }) liquidity(@Query('days') days?: string) { return this.bookings.liquidity(days ? Number(days) : 30); }
  @ApiOkResponse({ type: CircuitDto, isArray: true })
  @Get('circuits') circuits() { return this.kiorly.circuitStates(); }
  @ApiOkResponse({ type: OpsMessageDto, isArray: true })
  @Get('messages') messages() { return this.engagement.messageLog(); }
  @ApiOkResponse({ type: MessagingStatsDto })
  @Get('messaging/stats') @ApiOperation({ summary: 'OP: unified messaging (email/whatsapp/sms/push) mode and counts per channel/status' })
  messagingStats() { return this.hub.stats(); }
  @ApiOkResponse({ type: MessageLogDto })
  @Get('messaging/log') @ApiOperation({ summary: 'OP: unified message log (recipient masked; body only present in mock mode)' })
  async messagingLog(@Query('channel') channel?: string, @Query('status') status?: string, @Query('direction') direction?: string, @Query('limit') limit?: string) {
    const rows = await this.hub.list({ channel, status, direction, limit: limit ? Number(limit) : 100 });
    return { mode: this.hub.mode(), items: rows.map(({ recipient: _r, ...m }) => m) };
  }
  @ApiOkResponse({ type: MessageLogItemDto })
  @Post('messaging/log/:id/simulate') @HttpCode(200) @ApiOperation({ summary: 'OP (mock mode): move a message to DELIVERED / READ / FAILED to exercise delivery handling' })
  async messagingSimulate(@Param('id') id: string, @Body() b: SimulateBody) { const { recipient: _r, ...m } = await this.hub.simulate(id, b.state); return m; }
  @ApiOkResponse({ type: DeliveryTickDto })
  @Post('messaging/delivery-tick') @HttpCode(200) messagingTick() { return this.hub.simulateDeliveries(); }
  @ApiOkResponse({ type: AuditLogDto, isArray: true })
  @Get('audit-log') auditLog() { return this.prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }); }
}
