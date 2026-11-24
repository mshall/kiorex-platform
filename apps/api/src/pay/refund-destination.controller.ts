import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/auth';
import { RefundDestinationService } from './refund-destination.service';

class PreviewBody { @IsString() @MinLength(3) @MaxLength(80) bookingRef!: string }

@ApiTags('growth-credit')
@Controller('pay/v1/refunds')
export class RefundDestinationController {
  constructor(private readonly svc: RefundDestinationService) {}

  @Post('preview') @HttpCode(200) @ApiOperation({ summary: 'GRW-P2-B2 both refund destinations with the exact amounts; "original payment method" is the default and is first' }) @ApiOkResponse({ schema: { type: 'object', additionalProperties: true } })
  preview(@CurrentUser() u: AuthUser, @Body() b: PreviewBody) { return this.svc.preview(u.sub, b.bookingRef); }
}
