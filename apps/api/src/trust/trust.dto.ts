import { ApiProperty } from '@nestjs/swagger';

export class ReviewDto {
  id!: string;
  bookingId!: string;
  @ApiProperty({ minimum: 1, maximum: 5 }) rating!: number;
  @ApiProperty({ nullable: true, type: String }) text!: string | null;
  @ApiProperty({ enum: ['VISIBLE', 'HIDDEN'] }) status!: string;
  @ApiProperty({ nullable: true, type: String }) clinicReply!: string | null;
  @ApiProperty({ format: 'date-time', description: 'Editable for 7 days' }) editableUntil!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
export class PublicReviewDto {
  id!: string;
  rating!: number;
  @ApiProperty({ nullable: true, type: String }) text!: string | null;
  @ApiProperty({ nullable: true, type: String }) clinicReply!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
export class ProviderReviewsDto {
  average!: number;
  count!: number;
  @ApiProperty({ type: [PublicReviewDto] }) reviews!: PublicReviewDto[];
}
export class ComplaintCreatedDto {
  id!: string;
  @ApiProperty({ nullable: true, type: String }) bookingId!: string | null;
  category!: string;
  @ApiProperty({ enum: ['OPEN', 'RESOLVED'] }) status!: string;
  @ApiProperty({ format: 'date-time', description: 'Support SLA due time' }) slaDueAt!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
