import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { AuthUser, CurrentUser, OpsOnly } from '../common/auth';
import { BookingService } from '../booking/booking-public';
import { CatalogService } from '../catalog/catalog-public';
import { EngagementService } from '../engagement/engagement-public';
import { KiorlyClient } from '../kiorly/kiorly-public';
import { OutboxService } from '../outbox/outbox-public';
import { PayService } from '../pay/pay-public';
import { PrismaService } from '../prisma/prisma.service';
import { TrustService } from '../trust/trust-public';

class RefundBody { @IsString() paymentId!: string; @IsString() reason!: string; @IsOptional() @IsInt() @Min(1) amountMinor?: number }
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
    private readonly kiorly: KiorlyClient, private readonly prisma: PrismaService, private readonly engagement: EngagementService,
  ) {}

  @Get('providers') @ApiOperation({ summary: 'KXM-OP-01 provider directory' })
  providers(@Query('status') status?: string, @Query('q') q?: string, @Query('page') page?: string) { return this.catalog.opsList({ status, q, page: page ? Number(page) : 1 }); }
  @Post('providers/sync') @HttpCode(200) syncProviders(@Query('full') full?: string) { return this.catalog.syncOnce({ full: full === 'true' }); }

  @Get('bookings') @ApiOperation({ summary: 'KXM-OP-02 bookings' })
  bookingsList(@Query('status') status?: string, @Query('clinicId') clinicId?: string, @Query('sub') sub?: string) { return this.bookings.opsList({ status, clinicId, sub }); }
  @Get('bookings/:id/timeline') @ApiOperation({ summary: 'KXM-OP-02 booking timeline: intents, holds, Kiorly calls, events, payments' })
  timeline(@Param('id') id: string) { return this.bookings.opsTimeline(id); }

  @Get('outbox') @ApiOperation({ summary: 'KXM-OP-03 outbox monitor' })
  async outboxList(@Query('status') status?: string, @Query('type') type?: string) { return { stats: await this.outbox.stats(), items: await this.outbox.list({ status, type }) }; }
  @Post('outbox/:id/replay') @HttpCode(200) @ApiOperation({ summary: 'KXM-OP-03 replay a DEAD/FAILED event' })
  async replay(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.prisma.auditLog.create({ data: { actor: u.sub, action: 'outbox.replay', resource: 'OutboxEvent', resourceId: id } });
    return this.outbox.replay(id);
  }

  @Get('payments/dashboard') @ApiOperation({ summary: 'KXM-OP-04 refunds, payouts, reconciliation dashboard' })
  payments() { return this.pay.dashboard(); }
  @Post('payments/refund') @HttpCode(200)
  async refund(@CurrentUser() u: AuthUser, @Body() b: RefundBody) {
    await this.prisma.auditLog.create({ data: { actor: u.sub, action: 'pay.ops_refund', resource: 'PaymentIntent', resourceId: b.paymentId, metadata: { reason: b.reason, amountMinor: b.amountMinor } } });
    return this.pay.refund(b.paymentId, { reason: `OPS:${b.reason}`, amountMinor: b.amountMinor, idempotencyKey: `ops-refund:${b.paymentId}:${b.amountMinor ?? 'full'}:${b.reason}` });
  }
  @Post('payouts/run') @HttpCode(200) runPayouts() { return this.pay.runPayouts(); }
  @Post('reconciliation/psp/run') @HttpCode(200) reconcilePsp(@Query('date') date?: string) { return this.pay.reconcileDaily(date ? new Date(date) : new Date()); }
  @Post('reconciliation/psp/import') @HttpCode(200) importLines(@Body() b: ImportBody) { return this.pay.importSettlementLines(b.lines); }
  @Post('reconciliation/bookings/run') @HttpCode(200) reconcileBookings() { return this.bookings.reconcileNightly(); }
  @Get('reconciliation/runs') runs() { return this.prisma.reconciliationRun.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }); }

  @Get('moderation') @ApiOperation({ summary: 'KXM-OP-05 review moderation queue' }) queue(@Query('status') status?: string) { return this.trust.queue(status); }
  @Post('moderation/:id/resolve') @HttpCode(200) resolve(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: ResolveBody) { return this.trust.resolve(u.sub, id, b.resolution); }
  @Get('complaints') complaints(@Query('status') status?: string) { return this.trust.complaints(status); }
  @Post('complaints/:id/resolve') @HttpCode(200) resolveComplaint(@Param('id') id: string) { return this.trust.resolveComplaint(id); }

  @Get('liquidity') @ApiOperation({ summary: 'KXM-OP-06 cluster liquidity metrics' }) liquidity(@Query('days') days?: string) { return this.bookings.liquidity(days ? Number(days) : 30); }
  @Get('circuits') circuits() { return this.kiorly.circuitStates(); }
  @Get('messages') messages() { return this.engagement.messageLog(); }
  @Get('audit-log') auditLog() { return this.prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }); }
}
