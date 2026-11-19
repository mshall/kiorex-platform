import { Body, Controller, Get, Header, Headers, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { AuthUser, CurrentUser, Public } from '../common/auth';
import { forbidden, notFound } from '../common/errors';
import { ProductKeyGuard, RequiresFlag } from '../control-plane/control-plane-public';
import { PayService } from './pay.service';

class PayLinkBody {
  @IsString() token!: string;
  @IsString() clinicId!: string;
  @IsInt() @Min(1) amountMinor!: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() externalRef?: string;
}

@ApiTags('pay')
@Controller('pay')
export class PayController {
  constructor(private readonly svc: PayService) {}

  @Get('intents/:id') @ApiOperation({ summary: 'Own payment status' })
  async intent(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const p = await this.svc.getIntent(id);
    if (p.sub !== u.sub) throw notFound('PAYMENT_NOT_FOUND', 'Payment not found');
    return { id: p.id, bookingId: p.bookingId, amountMinor: p.amountMinor, currency: p.currency, status: p.status, checkoutUrl: p.checkoutUrl, refundedMinor: p.refundedMinor };
  }

  /** Hosted PSP webhook (HMAC verified by adapter). */
  @Public() @Post('webhooks/:psp') @HttpCode(200)
  webhook(@Param('psp') psp: string, @Req() req: any) {
    return this.svc.handlePspWebhook(psp, (req.rawBody ?? Buffer.from(JSON.stringify(req.body))).toString('utf8'), req.headers);
  }

  // ── pay links (PAY-03) ──
  @Public() @UseGuards(ProductKeyGuard) @Post('links') @ApiOperation({ summary: 'Kiorly registers a deposit pay link (product-key HMAC)' })
  async createLink(@Req() req: any, @Body() b: PayLinkBody) {
    if (req.product !== 'kiorly-clinic') throw forbidden('PRODUCT_NOT_ALLOWED', 'Only Kiorly Clinic may register pay links');
    return this.svc.createPayLink(b);
  }
  @Public() @Get('links/:token') @ApiOperation({ summary: 'Hosted pay link info' })
  link(@Param('token') token: string) { return this.svc.payLink(token); }
  @Public() @Post('links/:token/checkout') @HttpCode(200) @RequiresFlag('kiorex.pay_deposits') @ApiOperation({ summary: 'Start hosted checkout for a pay link' })
  async linkCheckout(@Param('token') token: string) {
    const p = await this.svc.payLinkCheckout(token);
    return { paymentId: p.id, checkoutUrl: p.checkoutUrl, status: p.status };
  }

  // ── sandbox fake hosted checkout ──
  @Public() @Get('fake-checkout/:id') @Header('content-type', 'text/html; charset=utf-8')
  async fakePage(@Param('id') id: string) {
    const p = await this.svc.getIntent(id);
    return `<!doctype html><meta charset="utf-8"><title>Kiorex Pay sandbox</title><body style="font-family:sans-serif;max-width:420px;margin:48px auto"><h2>Kiorex Pay (sandbox)</h2><p>Deposit: ${(p.amountMinor / 100).toFixed(2)} ${p.currency}</p><p>Status: ${p.status}</p><form method="post" action="/api/v1/pay/fake-checkout/${p.id}/complete"><button name="outcome" value="pay">Pay</button> <button name="outcome" value="fail">Fail</button></form></body>`;
  }
  @Public() @Post('fake-checkout/:id/complete') @HttpCode(200)
  fakeComplete(@Param('id') id: string, @Body('outcome') outcome: string) { return this.svc.fakeComplete(id, outcome === 'fail' ? 'fail' : 'pay'); }
}
