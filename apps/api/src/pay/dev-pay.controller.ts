import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsInt, Min } from 'class-validator';
import { Public } from '../common/auth';
import { cfg } from '../common/config';
import { notFound } from '../common/errors';
import { newId } from '../common/ids';
import { PrismaService } from '../prisma/prisma.service';
import { PayService } from './pay.service';
import { FakePspAdapter, PspWebhookEvent } from './psp';

export class DevPaySimulateBody {
  @IsIn(['captured', 'failed', 'refund_settled']) outcome!: 'captured' | 'failed' | 'refund_settled';
  @IsOptional() @IsInt() @Min(1) amountMinor?: number;
}
export class DevPaymentDto {
  @ApiProperty() id!: string;
  @ApiProperty({ nullable: true, type: String }) bookingId!: string | null;
  @ApiProperty() amountMinor!: number;
  @ApiProperty() currency!: string;
  @ApiProperty() status!: string;
  @ApiProperty({ nullable: true, type: String }) checkoutUrl!: string | null;
  @ApiProperty() refundedMinor!: number;
  @ApiProperty({ type: [String], description: 'Refund id:status pairs' }) refunds!: string[];
}
export class DevPaySimulateResultDto { @ApiProperty() webhookStatus!: string; @ApiProperty({ type: DevPaymentDto }) payment!: DevPaymentDto }

/**
 * DEV ONLY (404 in production or PAYMENT_MODE=real): payment inbox + webhook simulation. `simulate` builds a signed PSP webhook and sends
 * it through PayService.handlePspWebhook, i.e. the very path a real PSP callback takes (signature check, receipt dedupe, ledger).
 */
@ApiTags('dev')
@Public()
@Controller('dev/payments')
export class DevPayController {
  constructor(private readonly prisma: PrismaService, private readonly pay: PayService) {}
  private guard() { if (!cfg().payDevRoutesEnabled) throw notFound('NOT_FOUND', 'Not found'); }
  private async present(id: string): Promise<DevPaymentDto> {
    const p = await this.prisma.paymentIntent.findUniqueOrThrow({ where: { id } });
    const refunds = await this.prisma.refund.findMany({ where: { paymentId: id }, orderBy: { createdAt: 'asc' } });
    return { id: p.id, bookingId: p.bookingId, amountMinor: p.amountMinor, currency: p.currency, status: p.status, checkoutUrl: p.checkoutUrl, refundedMinor: p.refundedMinor, refunds: refunds.map((r) => `${r.id}:${r.status}`) };
  }

  @ApiOkResponse({ type: DevPaymentDto, isArray: true })
  @Get() @ApiOperation({ summary: 'DEV: latest payment intents with refund state' })
  async list() {
    this.guard();
    const rows = await this.prisma.paymentIntent.findMany({ orderBy: { createdAt: 'desc' }, take: 50, select: { id: true } });
    return Promise.all(rows.map((r) => this.present(r.id)));
  }

  @ApiOkResponse({ type: DevPaySimulateResultDto })
  @Post(':id/simulate') @HttpCode(200) @ApiOperation({ summary: 'DEV: simulate a signed PSP webhook (captured | failed | refund_settled) for a payment' })
  async simulate(@Param('id') id: string, @Body() b: DevPaySimulateBody) {
    this.guard();
    const p = await this.prisma.paymentIntent.findUnique({ where: { id } });
    if (!p) throw notFound('PAYMENT_NOT_FOUND', 'Payment not found');
    const refund = b.outcome === 'refund_settled' ? await this.prisma.refund.findFirst({ where: { paymentId: id }, orderBy: { createdAt: 'desc' } }) : null;
    const ev: PspWebhookEvent = {
      eventId: newId('pspev'), type: b.outcome === 'captured' ? 'payment.captured' : b.outcome === 'failed' ? 'payment.failed' : 'refund.settled',
      pspRef: refund?.pspRefundRef ?? p.pspRef ?? '', paymentId: p.id, amountMinor: b.amountMinor ?? refund?.amountMinor ?? p.amountMinor,
      feeMinor: b.outcome === 'captured' ? Math.round((p.amountMinor * cfg().pspFeeBps) / 10000) : undefined, occurredAt: new Date().toISOString(),
    };
    const raw = JSON.stringify(ev);
    const r = await this.pay.handlePspWebhook(p.psp, raw, { 'x-psp-signature': FakePspAdapter.sign(raw) });
    return { webhookStatus: r.status, payment: await this.present(id) };
  }
}
