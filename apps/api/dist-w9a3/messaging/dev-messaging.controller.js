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
exports.DevMessagingController = exports.DevWebhookSimulateBody = exports.DevInboundBody = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const messaging_dto_1 = require("./messaging.dto");
const class_validator_1 = require("class-validator");
const auth_1 = require("../common/auth");
const config_1 = require("../common/config");
const errors_1 = require("../common/errors");
const messaging_hub_1 = require("./messaging.hub");
const messaging_types_1 = require("./messaging.types");
const env_1 = require("../common/providers/env");
const real_adapters_1 = require("../common/providers/real-adapters");
const mapping_types_1 = require("../common/providers/mapping-types");
const webhook_1 = require("../common/providers/webhook");
const prisma_service_1 = require("../prisma/prisma.service");
class DevInboundBody {
    channel;
    from;
    text;
    buttonPayload;
}
exports.DevInboundBody = DevInboundBody;
__decorate([
    (0, class_validator_1.IsIn)([...messaging_types_1.MSG_CHANNELS]),
    __metadata("design:type", String)
], DevInboundBody.prototype, "channel", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(64),
    __metadata("design:type", String)
], DevInboundBody.prototype, "from", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(1000),
    __metadata("design:type", String)
], DevInboundBody.prototype, "text", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], DevInboundBody.prototype, "buttonPayload", void 0);
class DevWebhookSimulateBody {
    id;
    state;
}
exports.DevWebhookSimulateBody = DevWebhookSimulateBody;
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], DevWebhookSimulateBody.prototype, "id", void 0);
__decorate([
    (0, class_validator_1.IsIn)(['DELIVERED', 'READ', 'FAILED']),
    __metadata("design:type", String)
], DevWebhookSimulateBody.prototype, "state", void 0);
let DevMessagingController = class DevMessagingController {
    hub;
    prisma;
    constructor(hub, prisma) {
        this.hub = hub;
        this.prisma = prisma;
    }
    guard() { if (!(0, config_1.cfg)().devRoutesEnabled)
        throw (0, errors_1.notFound)('NOT_FOUND', 'Not found'); }
    async inbound(b) {
        this.guard();
        const row = await this.hub.receive({ channel: b.channel, from: b.from, text: b.text, buttonPayload: b.buttonPayload });
        const replies = await this.hub.list({ channel: b.channel, direction: 'OUT', to: b.from, since: row.createdAt, limit: 20 });
        return { inboundId: row.id, replies: replies.reverse() };
    }
    async outbox(channel, to, direction, limit) {
        this.guard();
        return { items: await this.hub.list({ channel, to, direction: direction ?? 'OUT', limit: limit ? Number(limit) : 50 }) };
    }
    async tick() { this.guard(); return this.hub.simulateDeliveries(); }
    async clear(channel) { this.guard(); return { deleted: (await this.hub.clear(channel)).count }; }
    async webhookSimulate(b) {
        this.guard();
        const row = await this.prisma.messageLog.findUnique({ where: { id: b.id } });
        const kind = row ? (0, real_adapters_1.messagingKindOf)(row.channel) : undefined;
        if (!row || !kind || row.mode !== 'mock' || row.direction !== 'OUT' || !row.providerRef)
            throw (0, errors_1.notFound)('MESSAGE_NOT_SIMULATABLE', 'Only mock outbound messages with a provider reference can be simulated');
        const raw = (0, mapping_types_1.genericStatusBody)(row.providerRef, b.state === 'FAILED' ? 'failed' : b.state === 'READ' ? 'read' : 'delivered', b.state === 'FAILED' ? 'SIMULATED_FAILURE' : undefined);
        await this.hub.handleStatusWebhook(row.channel, raw, (0, webhook_1.signedWebhookHeaders)((0, env_1.providerEnv)(kind).webhookSecret, raw));
        return this.prisma.messageLog.findUniqueOrThrow({ where: { id: b.id } });
    }
};
exports.DevMessagingController = DevMessagingController;
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: messaging_dto_1.DevInboundResultDto }),
    (0, common_1.Post)('inbound'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'DEV: simulate a patient reply on a channel (drives the WhatsApp booking state machine)' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [DevInboundBody]),
    __metadata("design:returntype", Promise)
], DevMessagingController.prototype, "inbound", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: messaging_dto_1.DevOutboxDto }),
    (0, common_1.Get)('outbox'),
    (0, swagger_1.ApiOperation)({ summary: 'DEV: messages the platform "sent" (all channels), newest first' }),
    __param(0, (0, common_1.Query)('channel')),
    __param(1, (0, common_1.Query)('to')),
    __param(2, (0, common_1.Query)('direction')),
    __param(3, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String]),
    __metadata("design:returntype", Promise)
], DevMessagingController.prototype, "outbox", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: messaging_dto_1.DeliveryTickDto }),
    (0, common_1.Post)('delivery-tick'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'DEV: advance SENT -> DELIVERED for all mock messages' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], DevMessagingController.prototype, "tick", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: messaging_dto_1.DevClearResultDto }),
    (0, common_1.Delete)('outbox'),
    (0, swagger_1.ApiOperation)({ summary: 'DEV: clear the dev inbox' }),
    __param(0, (0, common_1.Query)('channel')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], DevMessagingController.prototype, "clear", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: messaging_dto_1.DevMessageDto }),
    (0, common_1.Post)('webhook-simulate'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'DEV: deliver a SIGNED provider status webhook for a mock message (exercises the same verified path as the real provider)' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [DevWebhookSimulateBody]),
    __metadata("design:returntype", Promise)
], DevMessagingController.prototype, "webhookSimulate", null);
exports.DevMessagingController = DevMessagingController = __decorate([
    (0, swagger_1.ApiTags)('dev'),
    (0, auth_1.Public)(),
    (0, common_1.Controller)('dev/messaging'),
    __metadata("design:paramtypes", [messaging_hub_1.MessagingHub, prisma_service_1.PrismaService])
], DevMessagingController);
//# sourceMappingURL=dev-messaging.controller.js.map