import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PharmacyDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() pickup!: boolean;
  @ApiProperty() deliveryEnabled!: boolean;
  @ApiProperty() deliveryFeeMinor!: number;
  @ApiPropertyOptional() prepMinutes?: number;
}
export class CatalogueItemDto {
  @ApiProperty() pharmacyId!: string;
  @ApiProperty() sku!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional() strength?: string;
  @ApiPropertyOptional() form?: string;
  @ApiProperty() priceMinor!: number;
  @ApiProperty({ description: 'Rx-only: ordering needs a prescription from your vault' }) rxRequired!: boolean;
  @ApiProperty() available!: boolean;
}
export class CartLineDto {
  @ApiProperty() sku!: string;
  @ApiProperty() name!: string;
  @ApiProperty() qty!: number;
  @ApiProperty() unitPriceMinor!: number;
  @ApiProperty() rxRequired!: boolean;
  @ApiProperty() available!: boolean;
}
export class CartDto {
  @ApiProperty({ nullable: true, type: String }) pharmacyId!: string | null;
  @ApiProperty({ type: [CartLineDto] }) items!: CartLineDto[];
  @ApiProperty({ enum: ['PICKUP', 'DELIVERY'], nullable: true, type: String }) deliveryMethod!: string | null;
  @ApiProperty({ nullable: true, type: String }) prescriptionRecordId!: string | null;
  @ApiProperty() subtotalMinor!: number;
  @ApiProperty() deliveryFeeMinor!: number;
  @ApiProperty() totalMinor!: number;
  @ApiProperty() currency!: string;
  @ApiProperty() rxRequired!: boolean;
}
export class OrderPaymentDto {
  @ApiProperty() paymentId!: string;
  @ApiProperty() status!: string;
  @ApiProperty({ nullable: true, type: String }) checkoutUrl!: string | null;
}
export class PharmacyOrderAddressDto {
  @ApiProperty() line1!: string;
  @ApiPropertyOptional() area?: string;
  @ApiPropertyOptional() governorate?: string;
  @ApiPropertyOptional() notes?: string;
  @ApiPropertyOptional() phone?: string;
}
export class PharmacyOrderDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['PENDING_PAYMENT', 'PAID', 'SUBMITTED', 'READY', 'DISPENSED', 'PARTIAL_REVIEW', 'REJECTED', 'CANCELLED'] }) status!: string;
  @ApiProperty() pharmacyId!: string;
  @ApiProperty({ type: [CartLineDto] }) items!: CartLineDto[];
  @ApiProperty() subtotalMinor!: number;
  @ApiProperty() deliveryFeeMinor!: number;
  @ApiProperty() totalMinor!: number;
  @ApiProperty() currency!: string;
  @ApiProperty({ enum: ['PICKUP', 'DELIVERY'] }) deliveryMethod!: string;
  @ApiProperty({ enum: ['NOT_REQUIRED', 'PENDING', 'VALID', 'INVALID'] }) rxStatus!: string;
  @ApiPropertyOptional({ type: PharmacyOrderAddressDto, nullable: true, description: 'DELIVERY orders only: the address the patient gave' }) deliveryAddress?: PharmacyOrderAddressDto | null;
  @ApiProperty({ nullable: true, type: String }) rejectionReason!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) readyAt!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) dispensedAt!: string | null;
  @ApiProperty({ type: OrderPaymentDto, nullable: true }) payment!: OrderPaymentDto | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
export class CatalogueResultDto { @ApiProperty({ type: [CatalogueItemDto] }) items!: CatalogueItemDto[] }
