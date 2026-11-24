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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PharmacyController = exports.CreateOrderBody = exports.ResolvePartialBody = exports.DispensedLineBody = exports.DeliveryBody = exports.PharmacyDeliveryAddressBody = exports.CartBody = exports.CartItemBody = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
const auth_1 = require("../common/auth");
const dto_1 = require("../common/dto");
const control_plane_public_1 = require("../control-plane/control-plane-public");
const pharmacy_dto_1 = require("./pharmacy.dto");
const pharmacy_service_1 = require("./pharmacy.service");
class CartItemBody {
    sku;
    qty;
}
exports.CartItemBody = CartItemBody;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(64),
    __metadata("design:type", String)
], CartItemBody.prototype, "sku", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(20),
    __metadata("design:type", Number)
], CartItemBody.prototype, "qty", void 0);
class CartBody {
    pharmacyId;
    partnerId;
    items;
    prescriptionRecordId;
}
exports.CartBody = CartBody;
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CartBody.prototype, "pharmacyId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(80),
    __metadata("design:type", String)
], CartBody.prototype, "partnerId", void 0);
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMinSize)(1),
    (0, class_validator_1.ArrayMaxSize)(30),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => CartItemBody),
    __metadata("design:type", Array)
], CartBody.prototype, "items", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CartBody.prototype, "prescriptionRecordId", void 0);
class PharmacyDeliveryAddressBody {
    line1;
    area;
    governorate;
    notes;
    phone;
}
exports.PharmacyDeliveryAddressBody = PharmacyDeliveryAddressBody;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], PharmacyDeliveryAddressBody.prototype, "line1", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(80),
    __metadata("design:type", String)
], PharmacyDeliveryAddressBody.prototype, "area", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(80),
    __metadata("design:type", String)
], PharmacyDeliveryAddressBody.prototype, "governorate", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], PharmacyDeliveryAddressBody.prototype, "notes", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(32),
    __metadata("design:type", String)
], PharmacyDeliveryAddressBody.prototype, "phone", void 0);
class DeliveryBody {
    method;
    address;
}
exports.DeliveryBody = DeliveryBody;
__decorate([
    (0, class_validator_1.IsIn)(['PICKUP', 'DELIVERY']),
    __metadata("design:type", String)
], DeliveryBody.prototype, "method", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateNested)(),
    (0, class_transformer_1.Type)(() => PharmacyDeliveryAddressBody),
    __metadata("design:type", PharmacyDeliveryAddressBody)
], DeliveryBody.prototype, "address", void 0);
class DispensedLineBody {
    sku;
    quantityDispensed;
}
exports.DispensedLineBody = DispensedLineBody;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(64),
    __metadata("design:type", String)
], DispensedLineBody.prototype, "sku", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(1000),
    __metadata("design:type", Number)
], DispensedLineBody.prototype, "quantityDispensed", void 0);
class ResolvePartialBody {
    lines;
    deliveryMade;
}
exports.ResolvePartialBody = ResolvePartialBody;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMaxSize)(60),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => DispensedLineBody),
    __metadata("design:type", Array)
], ResolvePartialBody.prototype, "lines", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], ResolvePartialBody.prototype, "deliveryMade", void 0);
class CreateOrderBody {
    prescriptionRecordId;
}
exports.CreateOrderBody = CreateOrderBody;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateOrderBody.prototype, "prescriptionRecordId", void 0);
let PharmacyController = class PharmacyController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    pharmacies(partnerId) { return this.svc.pharmacies(partnerId); }
    search(q, pharmacyId, partnerId) { return this.svc.search({ q, pharmacyId, partnerId }); }
    cart(u) { return this.svc.getCart(u.sub); }
    putCart(u, b) { return this.svc.putCart(u.sub, b); }
    delivery(u, b) { return this.svc.setDelivery(u.sub, b); }
    clear(u) { return this.svc.clearCart(u.sub); }
    create(u, b) { return this.svc.createOrder(u.sub, b); }
    list(u) { return this.svc.list(u.sub); }
    get(u, id) { return this.svc.get(u.sub, id); }
    cancel(u, id) { return this.svc.cancel(u.sub, id); }
    opsList(status, partnerId) { return this.svc.opsList(status, partnerId); }
    resolvePartial(u, id, b) { return this.svc.resolvePartial(id, u.sub, b); }
    resubmit(id) { return this.svc.resubmit(id); }
};
exports.PharmacyController = PharmacyController;
__decorate([
    (0, common_1.Get)('pharmacy/pharmacies'),
    (0, control_plane_public_1.RequiresFlag)('kiorex.pharmacy_orders'),
    (0, swagger_1.ApiOperation)({ summary: 'Pharmacies that accept Kiorex orders (from Kiorly Pharmacy)' }),
    (0, swagger_1.ApiOkResponse)({ type: pharmacy_dto_1.PharmacyDto, isArray: true }),
    __param(0, (0, common_1.Query)('partnerId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], PharmacyController.prototype, "pharmacies", null);
__decorate([
    (0, common_1.Get)('pharmacy/search'),
    (0, control_plane_public_1.RequiresFlag)('kiorex.pharmacy_orders'),
    (0, swagger_1.ApiOperation)({ summary: 'Medicine search with availability-to-promise (controlled medicines are never returned)' }),
    (0, swagger_1.ApiOkResponse)({ type: pharmacy_dto_1.CatalogueResultDto }),
    __param(0, (0, common_1.Query)('q')),
    __param(1, (0, common_1.Query)('pharmacyId')),
    __param(2, (0, common_1.Query)('partnerId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", void 0)
], PharmacyController.prototype, "search", null);
__decorate([
    (0, common_1.Get)('pharmacy/cart'),
    (0, control_plane_public_1.RequiresFlag)('kiorex.pharmacy_orders'),
    (0, swagger_1.ApiOkResponse)({ type: pharmacy_dto_1.CartDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], PharmacyController.prototype, "cart", null);
__decorate([
    (0, common_1.Put)('pharmacy/cart'),
    (0, control_plane_public_1.RequiresFlag)('kiorex.pharmacy_orders'),
    (0, swagger_1.ApiOperation)({ summary: 'Replace the cart (one pharmacy per cart); prices come from the pharmacy quote' }),
    (0, swagger_1.ApiOkResponse)({ type: pharmacy_dto_1.CartDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, CartBody]),
    __metadata("design:returntype", void 0)
], PharmacyController.prototype, "putCart", null);
__decorate([
    (0, common_1.Put)('pharmacy/cart/delivery'),
    (0, control_plane_public_1.RequiresFlag)('kiorex.pharmacy_orders'),
    (0, swagger_1.ApiOperation)({ summary: 'Delivery choice: PICKUP or DELIVERY (with address)' }),
    (0, swagger_1.ApiOkResponse)({ type: pharmacy_dto_1.CartDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, DeliveryBody]),
    __metadata("design:returntype", void 0)
], PharmacyController.prototype, "delivery", null);
__decorate([
    (0, common_1.Delete)('pharmacy/cart'),
    (0, control_plane_public_1.RequiresFlag)('kiorex.pharmacy_orders'),
    (0, swagger_1.ApiOkResponse)({ type: dto_1.OkDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], PharmacyController.prototype, "clear", null);
__decorate([
    (0, common_1.Post)('pharmacy/orders'),
    (0, common_1.HttpCode)(201),
    (0, control_plane_public_1.RequiresFlag)('kiorex.pharmacy_orders'),
    (0, swagger_1.ApiOperation)({ summary: 'Create the order intent from the cart + Kiorex Pay checkout. Rx items need prescriptionRecordId (vault). After payment the order is sent to Kiorly Pharmacy for Rx validation' }),
    (0, swagger_1.ApiCreatedResponse)({ type: pharmacy_dto_1.PharmacyOrderDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, CreateOrderBody]),
    __metadata("design:returntype", void 0)
], PharmacyController.prototype, "create", null);
__decorate([
    (0, common_1.Get)('pharmacy/orders'),
    (0, swagger_1.ApiOkResponse)({ type: pharmacy_dto_1.PharmacyOrderDto, isArray: true }),
    __param(0, (0, auth_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], PharmacyController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('pharmacy/orders/:id'),
    (0, swagger_1.ApiOkResponse)({ type: pharmacy_dto_1.PharmacyOrderDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], PharmacyController.prototype, "get", null);
__decorate([
    (0, common_1.Post)('pharmacy/orders/:id/cancel'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'Cancel before the pharmacy marks it ready; paid orders are refunded automatically' }),
    (0, swagger_1.ApiOkResponse)({ type: pharmacy_dto_1.PharmacyOrderDto }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], PharmacyController.prototype, "cancel", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ schema: { type: 'array', items: { allOf: [{ $ref: '#/components/schemas/PharmacyOrderDto' }, { type: 'object', properties: { sub: { type: 'string' }, platformFeeMinor: { type: 'number' }, takeRateBps: { type: 'number' } } }] } } }),
    (0, auth_1.OpsOnly)(),
    (0, common_1.Get)('admin/pharmacy/orders'),
    (0, swagger_1.ApiOperation)({ summary: 'OP: pharmacy orders (status filter)' }),
    __param(0, (0, common_1.Query)('status')),
    __param(1, (0, common_1.Query)('partnerId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], PharmacyController.prototype, "opsList", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ schema: { type: 'object', properties: { order: { $ref: '#/components/schemas/PharmacyOrderDto' }, refundTotalMinor: { type: 'number' } } } }),
    (0, auth_1.OpsOnly)(),
    (0, common_1.Post)('admin/pharmacy/orders/:id/resolve-partial'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'OP: settle a PARTIAL_REVIEW order with the market/org partial-fulfilment policy (pro-rata refund of the undispensed lines)' }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, ResolvePartialBody]),
    __metadata("design:returntype", void 0)
], PharmacyController.prototype, "resolvePartial", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ schema: { type: 'object', properties: { status: { type: 'string', description: 'SUBMITTED | REJECTED | ...' } } } }),
    (0, auth_1.OpsOnly)(),
    (0, common_1.Post)('admin/pharmacy/orders/:id/resubmit'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'OP: re-send a PAID order to Kiorly Pharmacy (idempotent)' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], PharmacyController.prototype, "resubmit", null);
exports.PharmacyController = PharmacyController = __decorate([
    (0, swagger_1.ApiTags)('pharmacy'),
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [pharmacy_service_1.PharmacyService])
], PharmacyController);
//# sourceMappingURL=pharmacy.controller.js.map