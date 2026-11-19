import { ApiProperty } from '@nestjs/swagger';

export class MessageLogItemDto {
  id!: string;
  @ApiProperty({ nullable: true, type: String }) messageId!: string | null;
  @ApiProperty({ enum: ['EMAIL', 'WHATSAPP', 'SMS', 'PUSH'] }) channel!: string;
  @ApiProperty({ enum: ['OUT', 'IN'] }) direction!: string;
  @ApiProperty({ enum: ['mock', 'real'] }) mode!: string;
  @ApiProperty({ nullable: true, type: String }) sub!: string | null;
  @ApiProperty({ description: 'Masked recipient; raw recipients never leave the dev inbox' }) recipientMasked!: string;
  @ApiProperty({ nullable: true, type: String }) templateId!: string | null;
  locale!: string;
  @ApiProperty({ nullable: true, type: String, description: 'Only present in mock mode' }) body!: string | null;
  @ApiProperty({ enum: ['QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'RECEIVED'] }) status!: string;
  @ApiProperty({ nullable: true, type: String }) providerRef!: string | null;
  @ApiProperty({ nullable: true, type: String }) error!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) sentAt!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) deliveredAt!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) readAt!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) failedAt!: string | null;
}
export class MessageLogDto {
  @ApiProperty({ enum: ['mock', 'real'] }) mode!: string;
  @ApiProperty({ type: [MessageLogItemDto] }) items!: MessageLogItemDto[];
}
export class MessagingCountDto { channel!: string; direction!: string; status!: string; count!: number }
export class MessagingStatsDto {
  @ApiProperty({ enum: ['mock', 'real'] }) mode!: string;
  @ApiProperty({ type: [String] }) channels!: string[];
  @ApiProperty({ type: [MessagingCountDto] }) counts!: MessagingCountDto[];
}
export class DeliveryTickDto { delivered!: number }

export class DevMessageDto extends MessageLogItemDto {
  @ApiProperty({ nullable: true, type: String, description: 'Raw recipient / sender (dev inbox only)' }) recipient!: string | null;
}
export class DevOutboxDto { @ApiProperty({ type: [DevMessageDto] }) items!: DevMessageDto[] }
export class DevInboundResultDto {
  @ApiProperty() inboundId!: string;
  @ApiProperty({ type: [DevMessageDto], description: 'Messages the platform sent in reaction to this inbound message' }) replies!: DevMessageDto[];
}
export class DevClearResultDto { @ApiProperty() deleted!: number }
