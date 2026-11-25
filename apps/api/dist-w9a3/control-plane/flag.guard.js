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
exports.FlagGuard = exports.RequiresFlag = exports.REQUIRES_FLAG = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const flags_service_1 = require("./flags.service");
exports.REQUIRES_FLAG = 'kx:requires-flag';
const RequiresFlag = (key) => (0, common_1.SetMetadata)(exports.REQUIRES_FLAG, key);
exports.RequiresFlag = RequiresFlag;
let FlagGuard = class FlagGuard {
    reflector;
    flags;
    constructor(reflector, flags) {
        this.reflector = reflector;
        this.flags = flags;
    }
    async canActivate(ctx) {
        const key = this.reflector.getAllAndOverride(exports.REQUIRES_FLAG, [ctx.getHandler(), ctx.getClass()]);
        if (!key)
            return true;
        const req = ctx.switchToHttp().getRequest();
        await this.flags.assertEnabled(key, { market: String(req.headers['x-kiorex-market'] ?? 'EG') });
        return true;
    }
};
exports.FlagGuard = FlagGuard;
exports.FlagGuard = FlagGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.Reflector, flags_service_1.FlagsService])
], FlagGuard);
//# sourceMappingURL=flag.guard.js.map