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
exports.AuthController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const auth_1 = require("../common/auth");
const errors_1 = require("../common/errors");
const outbox_public_1 = require("../outbox/outbox-public");
const auth_session_service_1 = require("./auth-session.service");
const prisma_service_1 = require("../prisma/prisma.service");
const token_verifier_1 = require("./token-verifier");
const auth_dto_1 = require("./auth.dto");
class LogoutBody {
    logout_token;
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], LogoutBody.prototype, "logout_token", void 0);
const BCL_EVENT = 'http://schemas.openid.net/event/backchannel-logout';
const KX_SUBJECT_DELETED = 'https://schemas.kiorex.com/event/subject.deleted';
let AuthController = class AuthController {
    verifier;
    sessions;
    outbox;
    prisma;
    constructor(verifier, sessions, outbox, prisma) {
        this.verifier = verifier;
        this.sessions = sessions;
        this.outbox = outbox;
        this.prisma = prisma;
    }
    me(u) {
        return { sub: u.sub, roles: u.roles, phone: u.phone, name: u.name, locale: u.locale };
    }
    async backchannelLogout(body) {
        if (!body?.logout_token)
            throw (0, errors_1.badRequest)('LOGOUT_TOKEN_REQUIRED', 'logout_token is required');
        let p;
        try {
            p = await this.verifier.verifyLogout(body.logout_token);
        }
        catch {
            throw new errors_1.ApiError(400, 'INVALID_LOGOUT_TOKEN', 'logout_token failed verification');
        }
        const events = (p.events ?? {});
        const kind = p.event ?? (events[KX_SUBJECT_DELETED] || events['subject.deleted'] ? 'subject.deleted' : undefined) ?? (events[BCL_EVENT] ? 'session.revoked' : undefined) ?? (events['session.revoked'] ? 'session.revoked' : undefined);
        if (!kind)
            throw (0, errors_1.badRequest)('NOT_A_LOGOUT_TOKEN', 'No logout event in token');
        const sub = p.sub;
        const sid = p.sid;
        if (kind === 'subject.deleted') {
            if (!sub)
                throw (0, errors_1.badRequest)('SUB_REQUIRED', 'sub required');
            await this.sessions.revokeAllForSub(sub);
            await this.outbox.enqueue(this.prisma, { type: 'subject.deleted', aggregateType: 'Subject', aggregateId: sub, payload: { sub }, dedupeKey: `subject.deleted:${sub}` });
        }
        else if (sid)
            await this.sessions.revokeBySid(sid);
        else if (sub)
            await this.sessions.revokeAllForSub(sub);
        else
            throw (0, errors_1.badRequest)('SID_OR_SUB_REQUIRED', 'sid or sub required');
        return { ok: true };
    }
};
exports.AuthController = AuthController;
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: auth_dto_1.MeDto }),
    (0, common_1.Get)('me'),
    (0, swagger_1.ApiOkResponse)({ description: 'Claims of the authenticated Kiorex Passport subject' }),
    __param(0, (0, auth_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "me", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: auth_dto_1.LogoutResultDto }),
    (0, auth_1.Public)(),
    (0, common_1.Post)('backchannel-logout'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [LogoutBody]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "backchannelLogout", null);
exports.AuthController = AuthController = __decorate([
    (0, swagger_1.ApiTags)('auth'),
    (0, common_1.Controller)('auth'),
    __param(0, (0, common_1.Inject)(token_verifier_1.TOKEN_VERIFIER)),
    __metadata("design:paramtypes", [Object, auth_session_service_1.AuthSessionService,
        outbox_public_1.OutboxService,
        prisma_service_1.PrismaService])
], AuthController);
//# sourceMappingURL=auth.controller.js.map