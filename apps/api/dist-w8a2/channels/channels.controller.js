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
exports.ChannelsController = exports.ConversationDto = exports.WhatsappInboundResultDto = exports.WhatsappInboundBody = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const node_crypto_1 = require("node:crypto");
const class_validator_1 = require("class-validator");
const auth_1 = require("../common/auth");
const config_1 = require("../common/config");
const crypto_1 = require("../common/crypto");
const errors_1 = require("../common/errors");
const control_plane_public_1 = require("../control-plane/control-plane-public");
const messaging_public_1 = require("../messaging/messaging-public");
const whatsapp_booking_service_1 = require("./whatsapp-booking.service");
class WhatsappInboundBody {
    from;
    text;
    buttonPayload;
    providerMessageId;
}
exports.WhatsappInboundBody = WhatsappInboundBody;
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Sender E.164 phone, e.g. +201000000001' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(32),
    __metadata("design:type", String)
], WhatsappInboundBody.prototype, "from", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(1000),
    __metadata("design:type", String)
], WhatsappInboundBody.prototype, "text", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], WhatsappInboundBody.prototype, "buttonPayload", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], WhatsappInboundBody.prototype, "providerMessageId", void 0);
class WhatsappInboundResultDto {
    inboundId;
}
exports.WhatsappInboundResultDto = WhatsappInboundResultDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], WhatsappInboundResultDto.prototype, "inboundId", void 0);
class ConversationDto {
    phone;
    state;
    locale;
}
exports.ConversationDto = ConversationDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], ConversationDto.prototype, "phone", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: ['IDLE', 'CHOOSE_SPECIALTY', 'CHOOSE_DOCTOR', 'CHOOSE_SLOT', 'OFFER_WAITLIST', 'CONFIRM'] }),
    __metadata("design:type", String)
], ConversationDto.prototype, "state", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", String)
], ConversationDto.prototype, "locale", void 0);
let ChannelsController = class ChannelsController {
    hub;
    wa;
    constructor(hub, wa) {
        this.hub = hub;
        this.wa = wa;
    }
    async inbound(req, b, sig) {
        const raw = req.rawBody?.toString('utf8') ?? '';
        const expect = 'sha256=' + (0, node_crypto_1.createHmac)('sha256', (0, config_1.cfg)().whatsappWebhookSecret).update(raw).digest('hex');
        if (!sig || !(0, crypto_1.safeEqual)(sig, expect))
            throw new errors_1.ApiError(401, 'INVALID_SIGNATURE', 'Signature rejected');
        const row = await this.hub.receive({ channel: 'WHATSAPP', from: b.from, text: b.text, buttonPayload: b.buttonPayload, providerRef: b.providerMessageId });
        return { inboundId: row.id };
    }
    async conversation(phone) {
        if (!(0, config_1.cfg)().devRoutesEnabled)
            throw (0, errors_1.notFound)('NOT_FOUND', 'Not found');
        const c = await this.wa.conversation(phone);
        if (!c)
            throw (0, errors_1.notFound)('CONVERSATION_NOT_FOUND', 'No conversation');
        return { phone: c.phone, state: c.state, locale: c.locale };
    }
};
exports.ChannelsController = ChannelsController;
__decorate([
    (0, auth_1.Public)(),
    (0, common_1.Post)('channels/whatsapp/booking-intents'),
    (0, common_1.HttpCode)(200),
    (0, control_plane_public_1.RequiresFlag)('kiorex.whatsapp_booking'),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-BK-11 WhatsApp inbound (normalised, HMAC-signed). Server-to-server; the booking conversation runs from here' }),
    (0, swagger_1.ApiOkResponse)({ type: WhatsappInboundResultDto }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Headers)('x-kiorex-signature')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, WhatsappInboundBody, String]),
    __metadata("design:returntype", Promise)
], ChannelsController.prototype, "inbound", null);
__decorate([
    (0, auth_1.Public)(),
    (0, common_1.Get)('dev/channels/whatsapp/conversation'),
    (0, swagger_1.ApiOperation)({ summary: 'DEV: current WhatsApp conversation state for a phone' }),
    (0, swagger_1.ApiOkResponse)({ type: ConversationDto }),
    __param(0, (0, common_1.Query)('phone')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ChannelsController.prototype, "conversation", null);
exports.ChannelsController = ChannelsController = __decorate([
    (0, swagger_1.ApiTags)('channels'),
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [messaging_public_1.MessagingHub, whatsapp_booking_service_1.WhatsAppBookingService])
], ChannelsController);
//# sourceMappingURL=channels.controller.js.map