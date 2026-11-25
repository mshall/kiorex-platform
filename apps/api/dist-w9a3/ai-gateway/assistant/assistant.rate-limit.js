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
exports.ConcurrencyGate = exports.AssistantRateLimit = void 0;
const common_1 = require("@nestjs/common");
const rate_limit_1 = require("../../common/rate-limit");
const prisma_service_1 = require("../../prisma/prisma.service");
let AssistantRateLimit = class AssistantRateLimit {
    limiter;
    constructor(prisma) { this.limiter = process.env.RATE_LIMIT_STORE === 'memory' ? new rate_limit_1.SlidingWindowLimiter() : new rate_limit_1.PgRateLimiter(prisma); }
    async perNumber(phoneHash, limitPerHour) {
        const r = await this.limiter.hit(`assistant:num:${phoneHash}`, limitPerHour, 3_600_000);
        if (r.ok)
            return { ok: true, notify: false, retryAfterSec: 0 };
        const n = await this.limiter.hit(`assistant:notice:${phoneHash}`, 1, 3_600_000);
        return { ok: false, notify: n.ok, retryAfterSec: r.retryAfterSec };
    }
};
exports.AssistantRateLimit = AssistantRateLimit;
exports.AssistantRateLimit = AssistantRateLimit = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AssistantRateLimit);
class ConcurrencyGate {
    inFlight = 0;
    tryEnter(max) { if (this.inFlight >= max)
        return false; this.inFlight++; return true; }
    leave() { this.inFlight = Math.max(0, this.inFlight - 1); }
    get current() { return this.inFlight; }
}
exports.ConcurrencyGate = ConcurrencyGate;
//# sourceMappingURL=assistant.rate-limit.js.map