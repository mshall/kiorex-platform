import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { AuthUser, CurrentUser, OpsOnly } from '../common/auth';
import { OkDto } from '../common/dto';
import { RequiresFlag } from '../control-plane/control-plane-public';
import { CartDto, CatalogueResultDto, PharmacyDto, PharmacyOrderDto } from './pharmacy.dto';
import { PharmacyService } from './pharmacy.service';

export class CartItemBody { @IsString() @MaxLength(64) sku!: string; @IsInt() @Min(1) @Max(20) qty!: number }
export class CartBody {
  @IsString() pharmacyId!: string;
  @IsOptional() @IsString() @MaxLength(80) partnerId?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => CartItemBody) items!: CartItemBody[];
  @IsOptional() @IsString() prescriptionRecordId?: string;
}
export class PharmacyDeliveryAddressBody {
  @IsString() @MaxLength(200) line1!: string;
  @IsOptional() @IsString() @MaxLength(80) area?: string;
  @IsOptional() @IsString() @MaxLength(80) governorate?: string;
  @IsOptional() @IsString() @MaxLength(200) notes?: string;
  @IsOptional() @IsString() @MaxLength(32) phone?: string;
}
export class DeliveryBody {
  @IsIn(['PICKUP', 'DELIVERY']) method!: 'PICKUP' | 'DELIVERY';
  @IsOptional() @ValidateNested() @Type(() => PharmacyDeliveryAddressBody) address?: PharmacyDeliveryAddressBody;
}
export class DispensedLineBody { @IsString() @MaxLength(64) sku!: string; @IsInt() @Min(0) @Max(1000) quantityDispensed!: number }
export class ResolvePartialBody {
  @IsOptional() @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => DispensedLineBody) lines?: DispensedLineBody[];
  @IsOptional() @IsBoolean() deliveryMade?: boolean;
}
export class CreateOrderBody { @IsOptional() @IsString() prescriptionRecordId?: string }

/**
 * Pharmacy marketplace (launch-locked `kiorex.pharmacy_orders`). New actions (search, cart, order) are flag-gated; reading
 * and cancelling existing orders is never blocked ("open orders completed or refunded").
 */
@ApiTags('pharmacy')
@Controller()
export class PharmacyController {
  constructor(private readonly svc: PharmacyService) {}

  @Get('pharmacy/pharmacies') @RequiresFlag('kiorex.pharmacy_orders') @ApiOperation({ summary: 'Pharmacies that accept Kiorex orders (from Kiorly Pharmacy)' })
  @ApiOkResponse({ type: PharmacyDto, isArray: true })
  pharmacies(@Query('partnerId') partnerId?: string) { return this.svc.pharmacies(partnerId); }

  @Get('pharmacy/search') @RequiresFlag('kiorex.pharmacy_orders') @ApiOperation({ summary: 'Medicine search with availability-to-promise (controlled medicines are never returned)' })
  @ApiOkResponse({ type: CatalogueResultDto })
  search(@Query('q') q?: string, @Query('pharmacyId') pharmacyId?: string, @Query('partnerId') partnerId?: string) { return this.svc.search({ q, pharmacyId, partnerId }); }

  @Get('pharmacy/cart') @RequiresFlag('kiorex.pharmacy_orders') @ApiOkResponse({ type: CartDto }) cart(@CurrentUser() u: AuthUser) { return this.svc.getCart(u.sub); }
  @Put('pharmacy/cart') @RequiresFlag('kiorex.pharmacy_orders') @ApiOperation({ summary: 'Replace the cart (one pharmacy per cart); prices come from the pharmacy quote' })
  @ApiOkResponse({ type: CartDto })
  putCart(@CurrentUser() u: AuthUser, @Body() b: CartBody) { return this.svc.putCart(u.sub, b); }
  @Put('pharmacy/cart/delivery') @RequiresFlag('kiorex.pharmacy_orders') @ApiOperation({ summary: 'Delivery choice: PICKUP or DELIVERY (with address)' })
  @ApiOkResponse({ type: CartDto })
  delivery(@CurrentUser() u: AuthUser, @Body() b: DeliveryBody) { return this.svc.setDelivery(u.sub, b); }
  @Delete('pharmacy/cart') @RequiresFlag('kiorex.pharmacy_orders') @ApiOkResponse({ type: OkDto }) clear(@CurrentUser() u: AuthUser) { return this.svc.clearCart(u.sub); }

  @Post('pharmacy/orders') @HttpCode(201) @RequiresFlag('kiorex.pharmacy_orders')
  @ApiOperation({ summary: 'Create the order intent from the cart + Kiorex Pay checkout. Rx items need prescriptionRecordId (vault). After payment the order is sent to Kiorly Pharmacy for Rx validation' })
  @ApiCreatedResponse({ type: PharmacyOrderDto })
  create(@CurrentUser() u: AuthUser, @Body() b: CreateOrderBody) { return this.svc.createOrder(u.sub, b); }

  @Get('pharmacy/orders') @ApiOkResponse({ type: PharmacyOrderDto, isArray: true }) list(@CurrentUser() u: AuthUser) { return this.svc.list(u.sub); }
  @Get('pharmacy/orders/:id') @ApiOkResponse({ type: PharmacyOrderDto }) get(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.get(u.sub, id); }
  @Post('pharmacy/orders/:id/cancel') @HttpCode(200) @ApiOperation({ summary: 'Cancel before the pharmacy marks it ready; paid orders are refunded automatically' })
  @ApiOkResponse({ type: PharmacyOrderDto })
  cancel(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.cancel(u.sub, id); }

  @ApiOkResponse({ schema: { type: 'array', items: { allOf: [{ $ref: '#/components/schemas/PharmacyOrderDto' }, { type: 'object', properties: { sub: { type: 'string' }, platformFeeMinor: { type: 'number' }, takeRateBps: { type: 'number' } } }] } } })

  @OpsOnly() @Get('admin/pharmacy/orders') @ApiOperation({ summary: 'OP: pharmacy orders (status filter)' }) opsList(@Query('status') status?: string, @Query('partnerId') partnerId?: string) { return this.svc.opsList(status, partnerId); }
  @ApiOkResponse({ schema: { type: 'object', properties: { order: { $ref: '#/components/schemas/PharmacyOrderDto' }, refundTotalMinor: { type: 'number' } } } })
  @OpsOnly() @Post('admin/pharmacy/orders/:id/resolve-partial') @HttpCode(200) @ApiOperation({ summary: 'OP: settle a PARTIAL_REVIEW order with the market/org partial-fulfilment policy (pro-rata refund of the undispensed lines)' })
  resolvePartial(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: ResolvePartialBody) { return this.svc.resolvePartial(id, u.sub, b); }
  @ApiOkResponse({ schema: { type: 'object', properties: { status: { type: 'string', description: 'SUBMITTED | REJECTED | ...' } } } })
  @OpsOnly() @Post('admin/pharmacy/orders/:id/resubmit') @HttpCode(200) @ApiOperation({ summary: 'OP: re-send a PAID order to Kiorly Pharmacy (idempotent)' }) resubmit(@Param('id') id: string) { return this.svc.resubmit(id); }
}
