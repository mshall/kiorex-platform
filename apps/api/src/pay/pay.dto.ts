import { ApiProperty } from '@nestjs/swagger';

export class PayIntentDto {
  id!: string;
  @ApiProperty({ nullable: true, type: String }) bookingId!: string | null;
  amountMinor!: number;
  currency!: string;
  @ApiProperty({ enum: ['CREATED', 'CAPTURED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED'] }) status!: string;
  @ApiProperty({ nullable: true, type: String }) checkoutUrl!: string | null;
  refundedMinor!: number;
}
export class PspWebhookAckDto { @ApiProperty({ description: 'CAPTURED | ALREADY_CAPTURED | FAILED_RECORDED | DUPLICATE | IGNORED' }) status!: string }
export class PayLinkDto {
  token!: string;
  clinicId!: string;
  amountMinor!: number;
  currency!: string;
  @ApiProperty({ enum: ['OPEN', 'PAID', 'EXPIRED'] }) status!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
}
export class PayLinkCheckoutDto {
  paymentId!: string;
  @ApiProperty({ nullable: true, type: String }) checkoutUrl!: string | null;
  status!: string;
}
