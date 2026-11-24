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
exports.AssistantLinkController = exports.AssistantLinkDto = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const auth_1 = require("../../common/auth");
const errors_1 = require("../../common/errors");
const privacy_hash_1 = require("../../common/privacy-hash");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const assistant_growth_bridge_1 = require("./assistant.growth-bridge");
const assistant_link_service_1 = require("./assistant.link.service");
const assistant_rate_limit_1 = require("./assistant.rate-limit");
class AssistantLinkDto {
    token;
}
exports.AssistantLinkDto = AssistantLinkDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(16),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], AssistantLinkDto.prototype, "token", void 0);
let AssistantLinkController = class AssistantLinkController {
    links;
    rate;
    constructor(links, rate) {
        this.links = links;
        this.rate = rate;
    }
    async verify(req, b) {
        const r = await this.rate.limiter.hit(`assistant:link:${(0, privacy_hash_1.ipHashOf)(req.ip)}`, 30, 60_000);
        if (!r.ok)
            throw new errors_1.ApiError(429, 'GROWTH_RATE_LIMITED', 'Too many requests, try again later', { retryAfterSec: r.retryAfterSec });
        const v = await this.links.verify(b.token);
        if (!v.ok) {
            if (v.code === 'EXPIRED')
                throw new errors_1.ApiError(410, 'ASSISTANT_LINK_EXPIRED', 'This link has expired');
            if (v.code === 'USED')
                throw new errors_1.ApiError(410, 'ASSISTANT_LINK_USED', 'This link was already used');
            throw new errors_1.ApiError(400, 'ASSISTANT_LINK_INVALID', 'This link is not valid');
        }
        const p = v.payload;
        const q = new URLSearchParams({ src: 'whatsapp' });
        if (p.providerId)
            q.set('provider', p.providerId);
        if (p.startsAt)
            q.set('slot', p.startsAt);
        const path = v.intent === 'PAY' && p.bookingId ? `/bookings/${encodeURIComponent(p.bookingId)}/pay` : v.intent === 'VERIFY' ? `/signin?next=${encodeURIComponent(`/book?${q.toString()}`)}` : `/book?${q.toString()}`;
        return { continuePath: path };
    }
};
exports.AssistantLinkController = AssistantLinkController;
__decorate([
    (0, auth_1.Public)(),
    (0, control_plane_public_1.RequiresFlag)(assistant_growth_bridge_1.ASSISTANT_FLAG.ASSISTANT),
    (0, common_1.HttpCode)(200),
    (0, common_1.Post)('link'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, AssistantLinkDto]),
    __metadata("design:returntype", Promise)
], AssistantLinkController.prototype, "verify", null);
exports.AssistantLinkController = AssistantLinkController = __decorate([
    (0, swagger_1.ApiExcludeController)(),
    (0, common_1.Controller)('growth/v1/assistant'),
    __metadata("design:paramtypes", [assistant_link_service_1.AssistantLinkService, assistant_rate_limit_1.AssistantRateLimit])
], AssistantLinkController);
//# sourceMappingURL=assistant-link.controller.js.map