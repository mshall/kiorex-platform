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
exports.MessagingWebhookController = exports.MessagingWebhookAckDto = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const auth_1 = require("../common/auth");
const errors_1 = require("../common/errors");
const messaging_hub_1 = require("./messaging.hub");
const env_1 = require("../common/providers/env");
const real_adapters_1 = require("../common/providers/real-adapters");
class MessagingWebhookAckDto {
    applied;
    ignored;
}
exports.MessagingWebhookAckDto = MessagingWebhookAckDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], MessagingWebhookAckDto.prototype, "applied", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], MessagingWebhookAckDto.prototype, "ignored", void 0);
let MessagingWebhookController = class MessagingWebhookController {
    hub;
    constructor(hub) {
        this.hub = hub;
    }
    handshake(channel, q) {
        const kind = (0, real_adapters_1.messagingKindOf)(channel.toUpperCase());
        const challenge = kind && (0, env_1.providerEnv)(kind).mode === 'real' ? (0, real_adapters_1.messagingMapping)(kind).verifyChallenge?.(q, process.env.WHATSAPP_VERIFY_TOKEN ?? '') : null;
        if (challenge === null || challenge === undefined)
            throw new errors_1.ApiError(403, 'INVALID_VERIFY_TOKEN', 'Verification rejected');
        return challenge;
    }
    async status(channel, req) {
        if (!req.rawBody)
            throw new errors_1.ApiError(400, 'RAW_BODY_REQUIRED', 'raw body unavailable');
        return this.hub.handleStatusWebhook(channel, req.rawBody.toString('utf8'), req.headers);
    }
};
exports.MessagingWebhookController = MessagingWebhookController;
__decorate([
    (0, auth_1.Public)(),
    (0, common_1.Get)(':channel'),
    (0, swagger_1.ApiOperation)({ summary: 'Provider webhook verification handshake (Meta WhatsApp hub.challenge)' }),
    (0, swagger_1.ApiOkResponse)({ description: 'The hub.challenge echoed back as plain text (real mode only; otherwise 403 INVALID_VERIFY_TOKEN)', content: { 'text/plain': { schema: { type: 'string', example: '1158201444' } } } }),
    __param(0, (0, common_1.Param)('channel')),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], MessagingWebhookController.prototype, "handshake", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: MessagingWebhookAckDto }),
    (0, auth_1.Public)(),
    (0, common_1.Post)(':channel'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'Provider delivery-status webhook (HMAC verified, idempotent, forward-only status)' }),
    __param(0, (0, common_1.Param)('channel')),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], MessagingWebhookController.prototype, "status", null);
exports.MessagingWebhookController = MessagingWebhookController = __decorate([
    (0, swagger_1.ApiTags)('webhooks'),
    (0, common_1.Controller)('messaging/webhooks'),
    __metadata("design:paramtypes", [messaging_hub_1.MessagingHub])
], MessagingWebhookController);
//# sourceMappingURL=messaging-webhook.controller.js.map