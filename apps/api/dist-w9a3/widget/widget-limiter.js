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
exports.WidgetLimiter = exports.widgetLimits = void 0;
const common_1 = require("@nestjs/common");
const contracts_1 = require("@kiorex/contracts");
const config_1 = require("../common/config");
const errors_1 = require("../common/errors");
const rate_limit_1 = require("../common/rate-limit");
const prisma_service_1 = require("../prisma/prisma.service");
const lim = (name, def) => { const n = Number(process.env[name]); return Number.isFinite(n) && n > 0 ? n : def; };
const widgetLimits = () => ({
    sessionPerMin: lim('WIDGET_RATE_SESSION_PER_MIN', 30),
    configPerMin: lim('WIDGET_RATE_CONFIG_PER_MIN', 60),
    slotsPerMinIp: lim('WIDGET_RATE_SLOTS_PER_MIN', 60),
    slotsPerMinOrg: lim('WIDGET_RATE_SLOTS_ORG_PER_MIN', 1200),
    bookingPerMinIp: lim('WIDGET_RATE_BOOKING_PER_MIN', 10),
    confirmPerMinIp: lim('WIDGET_RATE_CONFIRM_PER_MIN', 30),
});
exports.widgetLimits = widgetLimits;
let WidgetLimiter = class WidgetLimiter {
    timer;
    limiter;
    constructor(prisma) { this.limiter = process.env.RATE_LIMIT_STORE === 'memory' ? new rate_limit_1.SlidingWindowLimiter() : new rate_limit_1.PgRateLimiter(prisma); }
    onModuleInit() {
        if (!(0, config_1.cfg)().jobsEnabled || !(this.limiter instanceof rate_limit_1.PgRateLimiter))
            return;
        const pg = this.limiter;
        this.timer = setInterval(() => void pg.sweep().catch(() => undefined), 10 * 60_000);
        this.timer.unref();
    }
    onModuleDestroy() { if (this.timer)
        clearInterval(this.timer); }
    async take(bucket, subject, limit, windowMs = 60_000) {
        const r = await this.limiter.hit(`widget:${bucket}:${subject}`, limit, windowMs);
        if (!r.ok)
            throw new errors_1.ApiError(contracts_1.GROWTH_ERROR_STATUS.GROWTH_RATE_LIMITED, 'GROWTH_RATE_LIMITED', 'Too many requests, try again later', { retryAfterSec: r.retryAfterSec });
    }
};
exports.WidgetLimiter = WidgetLimiter;
exports.WidgetLimiter = WidgetLimiter = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], WidgetLimiter);
//# sourceMappingURL=widget-limiter.js.map