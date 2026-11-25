"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CatalogueResultDto = exports.PharmacyOrderDto = exports.OrderRefundDto = exports.RefundLineDto = exports.PharmacyOrderAddressDto = exports.OrderPaymentDto = exports.CartDto = exports.CartLineDto = exports.CatalogueItemDto = exports.PharmacyDto = void 0;
const swagger_1 = require("@nestjs/swagger");
class PharmacyDto {
    id;
    partnerId;
    name;
    pickup;
    deliveryEnabled;
    deliveryFeeMinor;
    prepMinutes;
}
exports.PharmacyDto = PharmacyDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PharmacyDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ nullable: true, type: String, description: 'Registration (partner) id that owns this pharmacy; pass it as partnerId when the same pharmacy id could be offered by two partners' }),
    __metadata("design:type", Object)
], PharmacyDto.prototype, "partnerId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PharmacyDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Boolean)
], PharmacyDto.prototype, "pickup", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Boolean)
], PharmacyDto.prototype, "deliveryEnabled", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], PharmacyDto.prototype, "deliveryFeeMinor", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", Number)
], PharmacyDto.prototype, "prepMinutes", void 0);
class CatalogueItemDto {
    pharmacyId;
    partnerId;
    sku;
    name;
    nameAr;
    activeIngredient;
    strength;
    form;
    formAr;
    priceMinor;
    rxRequired;
    available;
}
exports.CatalogueItemDto = CatalogueItemDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], CatalogueItemDto.prototype, "pharmacyId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ nullable: true, type: String, description: 'Registration (partner) that owns this pharmacy' }),
    __metadata("design:type", Object)
], CatalogueItemDto.prototype, "partnerId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], CatalogueItemDto.prototype, "sku", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], CatalogueItemDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Arabic brand name when the pharmacy holds one; fall back to `name`. Search matches Arabic and English.' }),
    __metadata("design:type", String)
], CatalogueItemDto.prototype, "nameAr", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", String)
], CatalogueItemDto.prototype, "activeIngredient", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", String)
], CatalogueItemDto.prototype, "strength", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", String)
], CatalogueItemDto.prototype, "form", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Arabic dosage form when known; fall back to `form`.' }),
    __metadata("design:type", String)
], CatalogueItemDto.prototype, "formAr", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], CatalogueItemDto.prototype, "priceMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Rx-only: ordering needs a prescription from your vault' }),
    __metadata("design:type", Boolean)
], CatalogueItemDto.prototype, "rxRequired", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Boolean)
], CatalogueItemDto.prototype, "available", void 0);
class CartLineDto {
    sku;
    name;
    nameAr;
    strength;
    form;
    formAr;
    qty;
    unitPriceMinor;
    rxRequired;
    available;
}
exports.CartLineDto = CartLineDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], CartLineDto.prototype, "sku", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], CartLineDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Arabic name snapshot (fall back to `name`)' }),
    __metadata("design:type", String)
], CartLineDto.prototype, "nameAr", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", String)
], CartLineDto.prototype, "strength", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", String)
], CartLineDto.prototype, "form", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", String)
], CartLineDto.prototype, "formAr", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], CartLineDto.prototype, "qty", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], CartLineDto.prototype, "unitPriceMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Boolean)
], CartLineDto.prototype, "rxRequired", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Boolean)
], CartLineDto.prototype, "available", void 0);
class CartDto {
    pharmacyId;
    partnerId;
    items;
    deliveryMethod;
    prescriptionRecordId;
    subtotalMinor;
    deliveryFeeMinor;
    totalMinor;
    currency;
    rxRequired;
}
exports.CartDto = CartDto;
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], CartDto.prototype, "pharmacyId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ nullable: true, type: String, description: 'Registration (partner) that owns the cart pharmacy' }),
    __metadata("design:type", Object)
], CartDto.prototype, "partnerId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [CartLineDto] }),
    __metadata("design:type", Array)
], CartDto.prototype, "items", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['PICKUP', 'DELIVERY'], nullable: true, type: String }),
    __metadata("design:type", Object)
], CartDto.prototype, "deliveryMethod", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], CartDto.prototype, "prescriptionRecordId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], CartDto.prototype, "subtotalMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], CartDto.prototype, "deliveryFeeMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], CartDto.prototype, "totalMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], CartDto.prototype, "currency", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Boolean)
], CartDto.prototype, "rxRequired", void 0);
class OrderPaymentDto {
    paymentId;
    status;
    checkoutUrl;
}
exports.OrderPaymentDto = OrderPaymentDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], OrderPaymentDto.prototype, "paymentId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], OrderPaymentDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], OrderPaymentDto.prototype, "checkoutUrl", void 0);
class PharmacyOrderAddressDto {
    line1;
    area;
    governorate;
    notes;
    phone;
}
exports.PharmacyOrderAddressDto = PharmacyOrderAddressDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PharmacyOrderAddressDto.prototype, "line1", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", String)
], PharmacyOrderAddressDto.prototype, "area", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", String)
], PharmacyOrderAddressDto.prototype, "governorate", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", String)
], PharmacyOrderAddressDto.prototype, "notes", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", String)
], PharmacyOrderAddressDto.prototype, "phone", void 0);
class RefundLineDto {
    sku;
    name;
    nameAr;
    unitPriceMinor;
    qtyOrdered;
    qtyFulfilled;
    qtyRefunded;
    refundMinor;
}
exports.RefundLineDto = RefundLineDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], RefundLineDto.prototype, "sku", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], RefundLineDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", String)
], RefundLineDto.prototype, "nameAr", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], RefundLineDto.prototype, "unitPriceMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Quantity ordered' }),
    __metadata("design:type", Number)
], RefundLineDto.prototype, "qtyOrdered", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Quantity the pharmacy dispensed' }),
    __metadata("design:type", Number)
], RefundLineDto.prototype, "qtyFulfilled", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Quantity refunded (rejected or unavailable)' }),
    __metadata("design:type", Number)
], RefundLineDto.prototype, "qtyRefunded", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Refund for this line = unit price x qtyRefunded' }),
    __metadata("design:type", Number)
], RefundLineDto.prototype, "refundMinor", void 0);
class OrderRefundDto {
    status;
    lines;
    goodsMinor;
    deliveryFeeMinor;
    totalMinor;
    fulfilledMinor;
    currency;
    policyNote;
    refundedAt;
}
exports.OrderRefundDto = OrderRefundDto;
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['REQUESTED', 'SETTLED'], description: 'SETTLED once the PSP confirmed the money moved back' }),
    __metadata("design:type", String)
], OrderRefundDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [RefundLineDto] }),
    __metadata("design:type", Array)
], OrderRefundDto.prototype, "lines", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], OrderRefundDto.prototype, "goodsMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Delivery fee refunded because the delivery was not made (0 otherwise)' }),
    __metadata("design:type", Number)
], OrderRefundDto.prototype, "deliveryFeeMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], OrderRefundDto.prototype, "totalMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Value of the lines that were fulfilled and released to the pharmacy' }),
    __metadata("design:type", Number)
], OrderRefundDto.prototype, "fulfilledMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], OrderRefundDto.prototype, "currency", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'PROPOSED_DEFAULT delegated by founder 23 Nov 2026', description: 'Policy provenance; the market/org policy is configurable' }),
    __metadata("design:type", String)
], OrderRefundDto.prototype, "policyNote", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], OrderRefundDto.prototype, "refundedAt", void 0);
class PharmacyOrderDto {
    id;
    status;
    pharmacyId;
    partnerId;
    items;
    subtotalMinor;
    deliveryFeeMinor;
    totalMinor;
    currency;
    deliveryMethod;
    rxStatus;
    deliveryAddress;
    rejectionReason;
    readyAt;
    outForDeliveryAt;
    dispensedAt;
    refund;
    payment;
    createdAt;
}
exports.PharmacyOrderDto = PharmacyOrderDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PharmacyOrderDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['PENDING_PAYMENT', 'PAID', 'SUBMITTED', 'READY', 'OUT_FOR_DELIVERY', 'DISPENSED', 'PARTIALLY_FULFILLED', 'PARTIAL_REVIEW', 'REJECTED', 'CANCELLED'], description: 'OUT_FOR_DELIVERY: DELIVERY orders handed to the courier. PARTIALLY_FULFILLED: part of the order was dispensed and the rest refunded (see `refund`). PARTIAL_REVIEW: parked for ops (manual review).' }),
    __metadata("design:type", String)
], PharmacyOrderDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PharmacyOrderDto.prototype, "pharmacyId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ nullable: true, type: String, description: 'Registration (partner) that owns the pharmacy and receives this order' }),
    __metadata("design:type", Object)
], PharmacyOrderDto.prototype, "partnerId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [CartLineDto] }),
    __metadata("design:type", Array)
], PharmacyOrderDto.prototype, "items", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], PharmacyOrderDto.prototype, "subtotalMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], PharmacyOrderDto.prototype, "deliveryFeeMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], PharmacyOrderDto.prototype, "totalMinor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], PharmacyOrderDto.prototype, "currency", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['PICKUP', 'DELIVERY'] }),
    __metadata("design:type", String)
], PharmacyOrderDto.prototype, "deliveryMethod", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['NOT_REQUIRED', 'PENDING', 'VALID', 'INVALID'] }),
    __metadata("design:type", String)
], PharmacyOrderDto.prototype, "rxStatus", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ type: PharmacyOrderAddressDto, nullable: true, description: 'DELIVERY orders only: the address the patient gave' }),
    __metadata("design:type", Object)
], PharmacyOrderDto.prototype, "deliveryAddress", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], PharmacyOrderDto.prototype, "rejectionReason", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, format: 'date-time' }),
    __metadata("design:type", Object)
], PharmacyOrderDto.prototype, "readyAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, format: 'date-time' }),
    __metadata("design:type", Object)
], PharmacyOrderDto.prototype, "outForDeliveryAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, format: 'date-time' }),
    __metadata("design:type", Object)
], PharmacyOrderDto.prototype, "dispensedAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: OrderRefundDto, nullable: true, description: 'Itemised refund of a partially fulfilled order; null when nothing was partially refunded' }),
    __metadata("design:type", Object)
], PharmacyOrderDto.prototype, "refund", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: OrderPaymentDto, nullable: true }),
    __metadata("design:type", Object)
], PharmacyOrderDto.prototype, "payment", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], PharmacyOrderDto.prototype, "createdAt", void 0);
class CatalogueResultDto {
    items;
}
exports.CatalogueResultDto = CatalogueResultDto;
__decorate([
    (0, swagger_1.ApiProperty)({ type: [CatalogueItemDto] }),
    __metadata("design:type", Array)
], CatalogueResultDto.prototype, "items", void 0);
//# sourceMappingURL=pharmacy.dto.js.map