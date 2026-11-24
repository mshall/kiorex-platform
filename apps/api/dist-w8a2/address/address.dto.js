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
exports.AddressDto = void 0;
const swagger_1 = require("@nestjs/swagger");
class AddressDto {
    id;
    label;
    governorate;
    district;
    street;
    building;
    floor;
    flat;
    landmark;
    lat;
    lng;
    hasPin;
    pinSource;
    confirmed;
    confirmedAt;
    isDefault;
    createdAt;
    summary;
}
exports.AddressDto = AddressDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'Home' }),
    __metadata("design:type", String)
], AddressDto.prototype, "label", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'District code, e.g. nasr-city (GET /home/districts)' }),
    __metadata("design:type", String)
], AddressDto.prototype, "district", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], AddressDto.prototype, "street", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], AddressDto.prototype, "building", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], AddressDto.prototype, "floor", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], AddressDto.prototype, "flat", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], AddressDto.prototype, "landmark", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: Number }),
    __metadata("design:type", Object)
], AddressDto.prototype, "lat", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: Number }),
    __metadata("design:type", Object)
], AddressDto.prototype, "lng", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, enum: ['USER', 'GEOCODED'] }),
    __metadata("design:type", Object)
], AddressDto.prototype, "pinSource", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Confirmed with the OTP-verified phone (needed once before the first home booking)' }),
    __metadata("design:type", Boolean)
], AddressDto.prototype, "confirmed", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, format: 'date-time' }),
    __metadata("design:type", Object)
], AddressDto.prototype, "confirmedAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], AddressDto.prototype, "createdAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Masked one-line summary (label · district · governorate), safe to show anywhere' }),
    __metadata("design:type", String)
], AddressDto.prototype, "summary", void 0);
//# sourceMappingURL=address.dto.js.map