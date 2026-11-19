import { Body, Controller, Get, Header, Headers, HttpCode, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { cfg } from '../common/config';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { AuthUser, CurrentUser, Public } from '../common/auth';
import { forbidden, notFound } from '../common/errors';
import { ProductKeyGuard, RequiresFlag } from '../control-plane/control-plane-public';
import { PayService } from './pay.service';
import { PayIntentDto, PayLinkCheckoutDto, PayLinkDto, PspWebhookAckDto } from './pay.dto';

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

  @ApiOkResponse({ type: PayIntentDto })

  @Get('intents/:id') @ApiOperation({ summary: 'Own payment status' })
  async intent(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const p = await this.svc.getIntent(id);
    if (p.sub !== u.sub) throw notFound('PAYMENT_NOT_FOUND', 'Payment not found');
    return { id: p.id, bookingId: p.bookingId, amountMinor: p.amountMinor, currency: p.currency, status: p.status, checkoutUrl: p.checkoutUrl, refundedMinor: p.refundedMinor };
  }

  /** Hosted PSP webhook (HMAC verified by adapter). */
  @ApiOkResponse({ type: PspWebhookAckDto })
  @Public() @Post('webhooks/:psp') @HttpCode(200)
  webhook(@Param('psp') psp: string, @Req() req: any) {
    return this.svc.handlePspWebhook(psp, (req.rawBody ?? Buffer.from(JSON.stringify(req.body))).toString('utf8'), req.headers);
  }

  // ── pay links (PAY-03) ──
  @ApiCreatedResponse({ type: PayLinkDto })
  @Public() @UseGuards(ProductKeyGuard) @Post('links') @ApiOperation({ summary: 'Kiorly registers a deposit pay link (product-key HMAC)' })
  async createLink(@Req() req: any, @Body() b: PayLinkBody) {
    if (req.product !== 'kiorly-clinic') throw forbidden('PRODUCT_NOT_ALLOWED', 'Only Kiorly Clinic may register pay links');
    return this.svc.createPayLink(b);
  }
  @ApiOkResponse({ type: PayLinkDto })
  @Public() @Get('links/:token') @ApiOperation({ summary: 'Hosted pay link info' })
  link(@Param('token') token: string) { return this.svc.payLink(token); }
  @ApiOkResponse({ type: PayLinkCheckoutDto })
  @Public() @Post('links/:token/checkout') @HttpCode(200) @RequiresFlag('kiorex.pay_deposits') @ApiOperation({ summary: 'Start hosted checkout for a pay link' })
  async linkCheckout(@Param('token') token: string) {
    const p = await this.svc.payLinkCheckout(token);
    return { paymentId: p.id, checkoutUrl: p.checkoutUrl, status: p.status };
  }

  // ── sandbox fake hosted checkout ──
  @ApiOkResponse({ description: 'Sandbox hosted checkout page (HTML)', schema: { type: 'string' } })
  @Public() @Get('fake-checkout/:id') @Header('content-type', 'text/html; charset=utf-8')
  async fakePage(@Param('id') id: string, @Query('returnUrl') returnUrl?: string) {
    const p = await this.svc.getIntent(id);
    const ret = safeReturnUrl(returnUrl);
    return `<!doctype html><meta charset="utf-8"><title>Kiorex Pay sandbox</title><body style="font-family:sans-serif;max-width:420px;margin:48px auto"><h2>Kiorex Pay (sandbox)</h2><p>Deposit: ${(p.amountMinor / 100).toFixed(2)} ${p.currency}</p><p>Status: ${p.status}</p><form method="post" action="/api/v1/pay/fake-checkout/${p.id}/complete">${ret ? `<input type="hidden" name="returnUrl" value="${escAttr(ret)}">` : ''}<button name="outcome" value="pay">Pay</button> <button name="outcome" value="fail">Fail</button></form></body>`;
  }
  @ApiOkResponse({ type: PspWebhookAckDto })
  @Public() @Post('fake-checkout/:id/complete') @HttpCode(200)
  @ApiQuery({ name: 'returnUrl', required: false, description: 'DEV/SANDBOX ONLY: redirect (303) here after completing, with paymentId and status appended; must be an allow-listed host (PAY_RETURN_URL_HOSTS, default localhost/127.0.0.1). Without it the JSON ack is returned.' })
  async fakeComplete(@Param('id') id: string, @Body('outcome') outcome: string, @Body('returnUrl') bodyReturn: string | undefined, @Query('returnUrl') queryReturn: string | undefined, @Res({ passthrough: true }) res: Response) {
    const ack = await this.svc.fakeComplete(id, outcome === 'fail' ? 'fail' : 'pay');
    const ret = safeReturnUrl(bodyReturn ?? queryReturn);
    if (!ret) return ack;
    const u = new URL(ret);
    u.searchParams.set('paymentId', id); u.searchParams.set('status', outcome === 'fail' ? 'FAILED' : 'CAPTURED');
    res.status(303).setHeader('location', u.toString());
    return ack;
  }
}

const escAttr = (v: string) => v.replace(/[&"<>]/g, (c) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[c]!);
/** Sandbox-only return redirect: never in production, http(s) only, host must be allow-listed (open-redirect guard). */
function safeReturnUrl(raw?: string): string | undefined {
  if (!raw || cfg().isProd) return undefined;
  try {
    const u = new URL(raw);
    const hosts = (process.env.PAY_RETURN_URL_HOSTS ?? 'localhost,127.0.0.1').split(',').map((h) => h.trim()).filter(Boolean);
    return (u.protocol === 'http:' || u.protocol === 'https:') && hosts.includes(u.hostname) ? u.toString() : undefined;
  } catch { return undefined; }
}
