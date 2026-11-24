import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PharmacyDto {
  @ApiProperty() id!: string;
  @ApiPropertyOptional({ nullable: true, type: String, description: 'Registration (partner) id that owns this pharmacy; pass it as partnerId when the same pharmacy id could be offered by two partners' }) partnerId?: string | null;
  @ApiProperty() name!: string;
  @ApiProperty() pickup!: boolean;
  @ApiProperty() deliveryEnabled!: boolean;
  @ApiProperty() deliveryFeeMinor!: number;
  @ApiPropertyOptional() prepMinutes?: number;
}
export class CatalogueItemDto {
  @ApiProperty() pharmacyId!: string;
  @ApiPropertyOptional({ nullable: true, type: String, description: 'Registration (partner) that owns this pharmacy' }) partnerId?: string | null;
  @ApiProperty() sku!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ description: 'Arabic brand name when the pharmacy holds one; fall back to `name`. Search matches Arabic and English.' }) nameAr?: string;
  @ApiPropertyOptional() activeIngredient?: string;
  @ApiPropertyOptional() strength?: string;
  @ApiPropertyOptional() form?: string;
  @ApiPropertyOptional({ description: 'Arabic dosage form when known; fall back to `form`.' }) formAr?: string;
  @ApiProperty() priceMinor!: number;
  @ApiProperty({ description: 'Rx-only: ordering needs a prescription from your vault' }) rxRequired!: boolean;
  @ApiProperty() available!: boolean;
}
export class CartLineDto {
  @ApiProperty() sku!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ description: 'Arabic name snapshot (fall back to `name`)' }) nameAr?: string;
  @ApiPropertyOptional() strength?: string;
  @ApiPropertyOptional() form?: string;
  @ApiPropertyOptional() formAr?: string;
  @ApiProperty() qty!: number;
  @ApiProperty() unitPriceMinor!: number;
  @ApiProperty() rxRequired!: boolean;
  @ApiProperty() available!: boolean;
}
export class CartDto {
  @ApiProperty({ nullable: true, type: String }) pharmacyId!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, description: 'Registration (partner) that owns the cart pharmacy' }) partnerId?: string | null;
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
export class RefundLineDto {
  @ApiProperty() sku!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional() nameAr?: string;
  @ApiProperty() unitPriceMinor!: number;
  @ApiProperty({ description: 'Quantity ordered' }) qtyOrdered!: number;
  @ApiProperty({ description: 'Quantity the pharmacy dispensed' }) qtyFulfilled!: number;
  @ApiProperty({ description: 'Quantity refunded (rejected or unavailable)' }) qtyRefunded!: number;
  @ApiProperty({ description: 'Refund for this line = unit price x qtyRefunded' }) refundMinor!: number;
}
export class OrderRefundDto {
  @ApiProperty({ enum: ['REQUESTED', 'SETTLED'], description: 'SETTLED once the PSP confirmed the money moved back' }) status!: string;
  @ApiProperty({ type: [RefundLineDto] }) lines!: RefundLineDto[];
  @ApiProperty() goodsMinor!: number;
  @ApiProperty({ description: 'Delivery fee refunded because the delivery was not made (0 otherwise)' }) deliveryFeeMinor!: number;
  @ApiProperty() totalMinor!: number;
  @ApiProperty({ description: 'Value of the lines that were fulfilled and released to the pharmacy' }) fulfilledMinor!: number;
  @ApiProperty() currency!: string;
  @ApiProperty({ example: 'PROPOSED_DEFAULT delegated by founder 23 Nov 2026', description: 'Policy provenance; the market/org policy is configurable' }) policyNote!: string;
  @ApiProperty({ format: 'date-time' }) refundedAt!: string;
}
export class PharmacyOrderDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['PENDING_PAYMENT', 'PAID', 'SUBMITTED', 'READY', 'OUT_FOR_DELIVERY', 'DISPENSED', 'PARTIALLY_FULFILLED', 'PARTIAL_REVIEW', 'REJECTED', 'CANCELLED'], description: 'OUT_FOR_DELIVERY: DELIVERY orders handed to the courier. PARTIALLY_FULFILLED: part of the order was dispensed and the rest refunded (see `refund`). PARTIAL_REVIEW: parked for ops (manual review).' }) status!: string;
  @ApiProperty() pharmacyId!: string;
  @ApiPropertyOptional({ nullable: true, type: String, description: 'Registration (partner) that owns the pharmacy and receives this order' }) partnerId?: string | null;
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
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) outForDeliveryAt!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) dispensedAt!: string | null;
  @ApiProperty({ type: OrderRefundDto, nullable: true, description: 'Itemised refund of a partially fulfilled order; null when nothing was partially refunded' }) refund!: OrderRefundDto | null;
  @ApiProperty({ type: OrderPaymentDto, nullable: true }) payment!: OrderPaymentDto | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
export class CatalogueResultDto { @ApiProperty({ type: [CatalogueItemDto] }) items!: CatalogueItemDto[] }
