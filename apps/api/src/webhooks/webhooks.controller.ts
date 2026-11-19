import { Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/auth';
import { ApiError } from '../common/errors';
import { WebhooksService } from './webhooks.service';
import { WebhookAckDto } from './webhooks.dto';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly svc: WebhooksService) {}

  @ApiOkResponse({ type: WebhookAckDto })

  @Public() @Post('kiorly') @HttpCode(200)
  @ApiOperation({ summary: 'Kiorly outbox webhook: X-Kiorly-Signature sha256=HMAC(ts.rawBody), de-duplicated on eventId' })
  async kiorly(@Req() req: any, @Headers('x-kiorly-signature') sig?: string, @Headers('x-kiorly-timestamp') ts?: string, @Headers('x-kiorly-event-id') hdrId?: string, @Headers('x-kiorly-client-key') clientKey?: string) {
    const raw: Buffer | undefined = req.rawBody;
    if (!raw) throw new ApiError(400, 'RAW_BODY_REQUIRED', 'raw body unavailable');
    return this.svc.receive(raw.toString('utf8'), { signature: sig, timestamp: ts, eventIdHeader: hdrId });
  }

  @ApiOkResponse({ type: WebhookAckDto })

  @Public() @Post('pharmacy') @HttpCode(200)
  @ApiOperation({ summary: 'Kiorly Pharmacy outbox webhook (OrderReady / DispenseCompleted / OrderRejected): same signature scheme, KIORLY_PHARMACY_WEBHOOK_SECRET' })
  async pharmacy(@Req() req: any, @Headers('x-kiorly-signature') sig?: string, @Headers('x-kiorly-timestamp') ts?: string, @Headers('x-kiorly-event-id') hdrId?: string, @Headers('x-kiorly-client-key') clientKey?: string) {
    const raw: Buffer | undefined = req.rawBody;
    if (!raw) throw new ApiError(400, 'RAW_BODY_REQUIRED', 'raw body unavailable');
    return this.svc.receive(raw.toString('utf8'), { signature: sig, timestamp: ts, eventIdHeader: hdrId, clientKey }, 'pharmacy');
  }

  @ApiOkResponse({ type: WebhookAckDto })

  @Public() @Post('lab') @HttpCode(200)
  @ApiOperation({ summary: 'Kiorly Lab outbox webhook (LabResultReleased): same signature scheme, KIORLY_LAB_WEBHOOK_SECRET' })
  async lab(@Req() req: any, @Headers('x-kiorly-signature') sig?: string, @Headers('x-kiorly-timestamp') ts?: string, @Headers('x-kiorly-event-id') hdrId?: string, @Headers('x-kiorly-client-key') clientKey?: string) {
    const raw: Buffer | undefined = req.rawBody;
    if (!raw) throw new ApiError(400, 'RAW_BODY_REQUIRED', 'raw body unavailable');
    return this.svc.receive(raw.toString('utf8'), { signature: sig, timestamp: ts, eventIdHeader: hdrId, clientKey }, 'lab');
  }
}
