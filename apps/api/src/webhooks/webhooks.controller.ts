import { Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/auth';
import { ApiError } from '../common/errors';
import { WebhooksService } from './webhooks.service';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly svc: WebhooksService) {}

  @Public() @Post('kiorly') @HttpCode(200)
  @ApiOperation({ summary: 'Kiorly outbox webhook: X-Kiorly-Signature sha256=HMAC(ts.rawBody), de-duplicated on eventId' })
  async kiorly(@Req() req: any, @Headers('x-kiorly-signature') sig?: string, @Headers('x-kiorly-timestamp') ts?: string, @Headers('x-kiorly-event-id') hdrId?: string) {
    const raw: Buffer | undefined = req.rawBody;
    if (!raw) throw new ApiError(400, 'RAW_BODY_REQUIRED', 'raw body unavailable');
    return this.svc.receive(raw.toString('utf8'), { signature: sig, timestamp: ts, eventIdHeader: hdrId });
  }
}
