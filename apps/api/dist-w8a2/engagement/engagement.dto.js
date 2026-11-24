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
exports.DeviceDto = exports.NotificationPreferenceDto = exports.InboxItemDto = void 0;
const swagger_1 = require("@nestjs/swagger");
class InboxItemDto {
    id;
    kind;
    bookingId;
    body;
    readAt;
    createdAt;
}
exports.InboxItemDto = InboxItemDto;
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Notification kind, e.g. BOOKING_CONFIRMED, REMINDER_24H, WAITLIST_OFFER, FOLLOW_UP_DUE, RECORD_SHARED' }),
    __metadata("design:type", String)
], InboxItemDto.prototype, "kind", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], InboxItemDto.prototype, "bookingId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Rendered in the patient locale' }),
    __metadata("design:type", String)
], InboxItemDto.prototype, "body", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, format: 'date-time' }),
    __metadata("design:type", Object)
], InboxItemDto.prototype, "readAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], InboxItemDto.prototype, "createdAt", void 0);
class NotificationPreferenceDto {
    sub;
    channel;
    enabled;
    quietStart;
    quietEnd;
}
exports.NotificationPreferenceDto = NotificationPreferenceDto;
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['WHATSAPP', 'PUSH', 'SMS', 'EMAIL'] }),
    __metadata("design:type", String)
], NotificationPreferenceDto.prototype, "channel", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: Number, description: 'Local quiet-hours start (0-23)' }),
    __metadata("design:type", Object)
], NotificationPreferenceDto.prototype, "quietStart", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: Number }),
    __metadata("design:type", Object)
], NotificationPreferenceDto.prototype, "quietEnd", void 0);
class DeviceDto {
    id;
    platform;
    appVersion;
    locale;
    createdAt;
    lastSeenAt;
}
exports.DeviceDto = DeviceDto;
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['IOS', 'ANDROID', 'WEB'] }),
    __metadata("design:type", String)
], DeviceDto.prototype, "platform", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], DeviceDto.prototype, "appVersion", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], DeviceDto.prototype, "locale", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], DeviceDto.prototype, "createdAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], DeviceDto.prototype, "lastSeenAt", void 0);
//# sourceMappingURL=engagement.dto.js.map