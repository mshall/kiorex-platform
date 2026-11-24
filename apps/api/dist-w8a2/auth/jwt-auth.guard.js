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
exports.JwtAuthGuard = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const auth_1 = require("../common/auth");
const errors_1 = require("../common/errors");
const auth_session_service_1 = require("./auth-session.service");
const token_verifier_1 = require("./token-verifier");
let JwtAuthGuard = class JwtAuthGuard {
    reflector;
    verifier;
    sessions;
    constructor(reflector, verifier, sessions) {
        this.reflector = reflector;
        this.verifier = verifier;
        this.sessions = sessions;
    }
    async canActivate(ctx) {
        const targets = [ctx.getHandler(), ctx.getClass()];
        if (this.reflector.getAllAndOverride(auth_1.IS_PUBLIC, targets))
            return true;
        const req = ctx.switchToHttp().getRequest();
        const h = String(req.headers.authorization ?? '');
        if (!h.toLowerCase().startsWith('bearer '))
            throw new errors_1.ApiError(401, 'UNAUTHENTICATED', 'Bearer token required');
        let payload;
        try {
            payload = await this.verifier.verifyAccess(h.slice(7).trim());
        }
        catch {
            throw new errors_1.ApiError(401, 'INVALID_TOKEN', 'Invalid or expired token');
        }
        const roles = Array.isArray(payload.kx_roles) ? payload.kx_roles : [];
        const user = {
            sub: String(payload.sub),
            roles,
            phone: payload.phone_number,
            email: typeof payload.email === 'string' ? payload.email : undefined,
            name: payload.name,
            locale: payload.locale,
            sid: payload.sid ?? undefined,
            clientId: payload.azp ?? payload.client_id,
        };
        if (user.sid) {
            if (await this.sessions.isRevoked(user.sid))
                throw new errors_1.ApiError(401, 'SESSION_REVOKED', 'Session has been signed out');
            await this.sessions.touch(user.sub, user.sid, { clientId: user.clientId, device: String(req.headers['user-agent'] ?? '').slice(0, 200), ip: req.ip });
        }
        req.user = user;
        const need = this.reflector.getAllAndOverride(auth_1.ROLES_KEY, targets);
        if (need?.length && !need.some((r) => roles.includes(r)))
            throw (0, errors_1.forbidden)('FORBIDDEN_ROLE', 'Insufficient role', { required: need });
        return true;
    }
};
exports.JwtAuthGuard = JwtAuthGuard;
exports.JwtAuthGuard = JwtAuthGuard = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, common_1.Inject)(token_verifier_1.TOKEN_VERIFIER)),
    __metadata("design:paramtypes", [core_1.Reflector, Object, auth_session_service_1.AuthSessionService])
], JwtAuthGuard);
//# sourceMappingURL=jwt-auth.guard.js.map