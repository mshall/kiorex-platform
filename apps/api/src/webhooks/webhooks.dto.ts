import { ApiProperty } from '@nestjs/swagger';

export class WebhookAckDto {
  @ApiProperty({ description: 'APPLIED | IGNORED | UNKNOWN_BOOKING | DUPLICATE (de-duplicated on eventId); other values are event-specific outcomes' }) status!: string;
}
