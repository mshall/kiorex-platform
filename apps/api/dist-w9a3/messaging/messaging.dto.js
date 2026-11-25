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
exports.DevClearResultDto = exports.DevInboundResultDto = exports.DevOutboxDto = exports.DevMessageDto = exports.DeliveryTickDto = exports.MessagingStatsDto = exports.MessagingCountDto = exports.MessageLogDto = exports.MessageLogItemDto = void 0;
const swagger_1 = require("@nestjs/swagger");
class MessageLogItemDto {
    id;
    messageId;
    channel;
    direction;
    mode;
    sub;
    recipientMasked;
    templateId;
    locale;
    body;
    status;
    providerRef;
    error;
    createdAt;
    sentAt;
    deliveredAt;
    readAt;
    failedAt;
}
exports.MessageLogItemDto = MessageLogItemDto;
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], MessageLogItemDto.prototype, "messageId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['EMAIL', 'WHATSAPP', 'SMS', 'PUSH'] }),
    __metadata("design:type", String)
], MessageLogItemDto.prototype, "channel", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['OUT', 'IN'] }),
    __metadata("design:type", String)
], MessageLogItemDto.prototype, "direction", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['mock', 'real'] }),
    __metadata("design:type", String)
], MessageLogItemDto.prototype, "mode", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], MessageLogItemDto.prototype, "sub", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Masked recipient; raw recipients never leave the dev inbox' }),
    __metadata("design:type", String)
], MessageLogItemDto.prototype, "recipientMasked", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], MessageLogItemDto.prototype, "templateId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, description: 'Only present in mock mode' }),
    __metadata("design:type", Object)
], MessageLogItemDto.prototype, "body", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'RECEIVED'] }),
    __metadata("design:type", String)
], MessageLogItemDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], MessageLogItemDto.prototype, "providerRef", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String }),
    __metadata("design:type", Object)
], MessageLogItemDto.prototype, "error", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ format: 'date-time' }),
    __metadata("design:type", String)
], MessageLogItemDto.prototype, "createdAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, format: 'date-time' }),
    __metadata("design:type", Object)
], MessageLogItemDto.prototype, "sentAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, format: 'date-time' }),
    __metadata("design:type", Object)
], MessageLogItemDto.prototype, "deliveredAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, format: 'date-time' }),
    __metadata("design:type", Object)
], MessageLogItemDto.prototype, "readAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, format: 'date-time' }),
    __metadata("design:type", Object)
], MessageLogItemDto.prototype, "failedAt", void 0);
class MessageLogDto {
    mode;
    items;
}
exports.MessageLogDto = MessageLogDto;
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['mock', 'real'] }),
    __metadata("design:type", String)
], MessageLogDto.prototype, "mode", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [MessageLogItemDto] }),
    __metadata("design:type", Array)
], MessageLogDto.prototype, "items", void 0);
class MessagingCountDto {
    channel;
    direction;
    status;
    count;
}
exports.MessagingCountDto = MessagingCountDto;
class MessagingStatsDto {
    mode;
    channels;
    counts;
}
exports.MessagingStatsDto = MessagingStatsDto;
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['mock', 'real'] }),
    __metadata("design:type", String)
], MessagingStatsDto.prototype, "mode", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [String] }),
    __metadata("design:type", Array)
], MessagingStatsDto.prototype, "channels", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [MessagingCountDto] }),
    __metadata("design:type", Array)
], MessagingStatsDto.prototype, "counts", void 0);
class DeliveryTickDto {
    delivered;
}
exports.DeliveryTickDto = DeliveryTickDto;
class DevMessageDto extends MessageLogItemDto {
    recipient;
}
exports.DevMessageDto = DevMessageDto;
__decorate([
    (0, swagger_1.ApiProperty)({ nullable: true, type: String, description: 'Raw recipient / sender (dev inbox only)' }),
    __metadata("design:type", Object)
], DevMessageDto.prototype, "recipient", void 0);
class DevOutboxDto {
    items;
}
exports.DevOutboxDto = DevOutboxDto;
__decorate([
    (0, swagger_1.ApiProperty)({ type: [DevMessageDto] }),
    __metadata("design:type", Array)
], DevOutboxDto.prototype, "items", void 0);
class DevInboundResultDto {
    inboundId;
    replies;
}
exports.DevInboundResultDto = DevInboundResultDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], DevInboundResultDto.prototype, "inboundId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [DevMessageDto], description: 'Messages the platform sent in reaction to this inbound message' }),
    __metadata("design:type", Array)
], DevInboundResultDto.prototype, "replies", void 0);
class DevClearResultDto {
    deleted;
}
exports.DevClearResultDto = DevClearResultDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], DevClearResultDto.prototype, "deleted", void 0);
//# sourceMappingURL=messaging.dto.js.map