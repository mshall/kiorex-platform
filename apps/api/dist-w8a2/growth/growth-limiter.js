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
exports.GrowthLimiter = exports.growthLimits = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("../common/config");
const rate_limit_1 = require("../common/rate-limit");
const prisma_service_1 = require("../prisma/prisma.service");
const growth_errors_1 = require("./growth-errors");
const lim = (name, def) => { const n = Number(process.env[name]); return Number.isFinite(n) && n > 0 ? n : def; };
const growthLimits = () => ({
    touchPerMin: lim('GROWTH_RATE_TOUCH_PER_MIN', 60),
    eventsPerMin: lim('GROWTH_RATE_EVENTS_PER_MIN', 120),
    consentPerMin: lim('GROWTH_RATE_CONSENT_PER_MIN', 30),
    evidencePerMin: lim('GROWTH_RATE_EVIDENCE_PER_MIN', 120),
    burstPerMin: lim('GROWTH_FRAUD_BURST_PER_MIN', 20),
});
exports.growthLimits = growthLimits;
let GrowthLimiter = class GrowthLimiter {
    log = new common_1.Logger('growth-limiter');
    timer;
    limiter;
    constructor(prisma) { this.limiter = process.env.RATE_LIMIT_STORE === 'memory' ? new rate_limit_1.SlidingWindowLimiter() : new rate_limit_1.PgRateLimiter(prisma); }
    onModuleInit() {
        if (!(0, config_1.cfg)().jobsEnabled || !(this.limiter instanceof rate_limit_1.PgRateLimiter))
            return;
        const pg = this.limiter;
        this.timer = setInterval(() => void pg.sweep().catch((e) => this.log.warn(`sweep failed: ${e.message}`)), 10 * 60_000);
        this.timer.unref();
    }
    onModuleDestroy() { if (this.timer)
        clearInterval(this.timer); }
    async take(bucket, ipHash, limit, windowMs = 60_000) {
        const r = await this.limiter.hit(`growth:${bucket}:${ipHash}`, limit, windowMs);
        if (!r.ok)
            throw (0, growth_errors_1.growthError)('GROWTH_RATE_LIMITED', 'Too many requests, try again later', { retryAfterSec: r.retryAfterSec });
    }
};
exports.GrowthLimiter = GrowthLimiter;
exports.GrowthLimiter = GrowthLimiter = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], GrowthLimiter);
//# sourceMappingURL=growth-limiter.js.map