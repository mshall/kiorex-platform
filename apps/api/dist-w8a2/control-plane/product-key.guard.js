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
exports.ProductKeyGuard = void 0;
const common_1 = require("@nestjs/common");
const errors_1 = require("../common/errors");
const hmac_1 = require("../common/hmac");
const flags_service_1 = require("./flags.service");
const nonces = new Map();
let ProductKeyGuard = class ProductKeyGuard {
    flags;
    constructor(flags) {
        this.flags = flags;
    }
    async canActivate(ctx) {
        const req = ctx.switchToHttp().getRequest();
        const keyId = String(req.headers['x-kiorex-product-key'] ?? '');
        if (!keyId)
            throw new errors_1.ApiError(401, 'PRODUCT_KEY_REQUIRED', 'X-Kiorex-Product-Key required');
        const reg = await this.flags.productSecret(keyId);
        if (!reg)
            throw new errors_1.ApiError(401, 'UNKNOWN_PRODUCT_KEY', 'Unknown product key');
        const r = (0, hmac_1.verifyControlPlaneRequest)({ headers: req.headers, method: req.method, path: req.originalUrl.split('?')[0], body: req.rawBody ?? Buffer.alloc(0), secret: reg.secret });
        if (!r.ok)
            throw new errors_1.ApiError(401, `HMAC_${r.reason.toUpperCase()}`, 'Request signature rejected');
        const nonce = String(req.headers['x-kiorly-nonce'] ?? '');
        const now = Date.now();
        for (const [k, t] of nonces)
            if (now - t > 5 * 60_000)
                nonces.delete(k);
        const nk = `${keyId}:${nonce}`;
        if (nonces.has(nk))
            throw new errors_1.ApiError(401, 'NONCE_REUSED', 'Nonce already used');
        nonces.set(nk, now);
        req.product = reg.product;
        return true;
    }
};
exports.ProductKeyGuard = ProductKeyGuard;
exports.ProductKeyGuard = ProductKeyGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [flags_service_1.FlagsService])
], ProductKeyGuard);
//# sourceMappingURL=product-key.guard.js.map