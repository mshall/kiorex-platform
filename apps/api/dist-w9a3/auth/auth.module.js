"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthModule = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const auth_controller_1 = require("./auth.controller");
const auth_session_service_1 = require("./auth-session.service");
const jwt_auth_guard_1 = require("./jwt-auth.guard");
const token_verifier_1 = require("./token-verifier");
let AuthModule = class AuthModule {
};
exports.AuthModule = AuthModule;
exports.AuthModule = AuthModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        controllers: [auth_controller_1.AuthController],
        providers: [auth_session_service_1.AuthSessionService, { provide: token_verifier_1.TOKEN_VERIFIER, useFactory: () => new token_verifier_1.JoseTokenVerifier() }, { provide: core_1.APP_GUARD, useClass: jwt_auth_guard_1.JwtAuthGuard }],
        exports: [auth_session_service_1.AuthSessionService, token_verifier_1.TOKEN_VERIFIER],
    })
], AuthModule);
//# sourceMappingURL=auth.module.js.map