import { ApiProperty } from '@nestjs/swagger';

export class InboxItemDto {
  id!: string;
  @ApiProperty({ description: 'Notification kind, e.g. BOOKING_CONFIRMED, REMINDER_24H, WAITLIST_OFFER, FOLLOW_UP_DUE, RECORD_SHARED' }) kind!: string;
  @ApiProperty({ nullable: true, type: String }) bookingId!: string | null;
  @ApiProperty({ description: 'Rendered in the patient locale' }) body!: string;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) readAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
export class NotificationPreferenceDto {
  sub!: string;
  @ApiProperty({ enum: ['WHATSAPP', 'PUSH', 'SMS', 'EMAIL'] }) channel!: string;
  enabled!: boolean;
  @ApiProperty({ nullable: true, type: Number, description: 'Local quiet-hours start (0-23)' }) quietStart!: number | null;
  @ApiProperty({ nullable: true, type: Number }) quietEnd!: number | null;
}

export class DeviceDto {
  id!: string;
  @ApiProperty({ enum: ['IOS', 'ANDROID', 'WEB'] }) platform!: string;
  @ApiProperty({ nullable: true, type: String }) appVersion!: string | null;
  @ApiProperty({ nullable: true, type: String }) locale!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) lastSeenAt!: string;
}
