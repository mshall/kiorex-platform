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
exports.ReferralController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const auth_1 = require("../../common/auth");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const growth_flags_1 = require("../growth-flags");
const referral_claim_service_1 = require("./referral-claim.service");
const referral_service_1 = require("./referral.service");
const OBJ = { schema: { type: 'object', additionalProperties: true } };
const VISITOR_KEY = /^kxv_[A-Za-z0-9_-]{16,64}$/;
class InviteBody {
    channel;
    locale;
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['LINK', 'WHATSAPP_SHARE', 'SMS', 'COPY']),
    __metadata("design:type", String)
], InviteBody.prototype, "channel", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['ar', 'en']),
    __metadata("design:type", String)
], InviteBody.prototype, "locale", void 0);
class ClaimBody {
    code;
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(40),
    __metadata("design:type", String)
], ClaimBody.prototype, "code", void 0);
let ReferralController = class ReferralController {
    svc;
    claims;
    constructor(svc, claims) {
        this.svc = svc;
        this.claims = claims;
    }
    me(u) { return this.svc.me(u); }
    invites(u, b) { return this.svc.createInvite(u, b); }
    claim(u, b, req) {
        const h = (n) => { const v = req.headers[n]; return Array.isArray(v) ? v[0] : v; };
        const cookie = /(?:^|;\s*)kxv=([^;]+)/.exec(h('cookie') ?? '')?.[1];
        const raw = h('x-kx-visitor') ?? cookie;
        return this.claims.claim(u, b.code, { visitorKey: raw && VISITOR_KEY.test(raw) ? raw : null, ip: req.ip });
    }
};
exports.ReferralController = ReferralController;
__decorate([
    (0, common_1.Get)('me'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-B1 my referral code, invite link, counts and caps remaining' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], ReferralController.prototype, "me", null);
__decorate([
    (0, common_1.Post)('invites'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-B1 record a share of my invite and get the link and share text (counts only, no recipient)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, InviteBody]),
    __metadata("design:returntype", void 0)
], ReferralController.prototype, "invites", null);
__decorate([
    (0, common_1.Post)('claim'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-B1 claim a referral code as the invited person (first claim wins; every refusal has the same shape)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, ClaimBody, Object]),
    __metadata("design:returntype", void 0)
], ReferralController.prototype, "claim", null);
exports.ReferralController = ReferralController = __decorate([
    (0, swagger_1.ApiTags)('growth-referral'),
    (0, common_1.Controller)('growth/v1/referral'),
    (0, control_plane_public_1.RequiresFlag)(growth_flags_1.GROWTH_FLAG.PATIENT_REFERRAL),
    __metadata("design:paramtypes", [referral_service_1.ReferralService, referral_claim_service_1.ReferralClaimService])
], ReferralController);
//# sourceMappingURL=referral.controller.js.map