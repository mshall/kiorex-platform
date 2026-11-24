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
exports.FraudSignalService = exports.FRAUD_RULES = void 0;
exports.clickWithoutRender = clickWithoutRender;
exports.burstPerIpHash = burstPerIpHash;
exports.providerLedShareJump = providerLedShareJump;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const growth_flags_1 = require("../growth-flags");
const growth_limiter_1 = require("../growth-limiter");
const growth_secrets_1 = require("../growth-secrets");
const fraud_public_1 = require("./fraud-public");
exports.FRAUD_RULES = { CLICK_WITHOUT_RENDER: 'CLICK_WITHOUT_RENDER', BURST_PER_IP_HASH: 'BURST_PER_IP_HASH', PROVIDER_LED_SHARE_JUMP: 'PROVIDER_LED_SHARE_JUMP' };
function clickWithoutRender(t, minDwellMs) {
    if (!t.providerOwned)
        return null;
    return t.dwellMs === undefined || t.dwellMs === null || t.dwellMs < minDwellMs ? { ruleId: exports.FRAUD_RULES.CLICK_WITHOUT_RENDER, score: 20 } : null;
}
function burstPerIpHash(countInMinute, limitPerMinute) {
    return countInMinute > limitPerMinute ? { ruleId: exports.FRAUD_RULES.BURST_PER_IP_HASH, score: 40 } : null;
}
function providerLedShareJump(s, o = { minRecent: 10, minBaseline: 30, jump: 0.35 }) {
    if (s.recentTotal < o.minRecent || s.baselineTotal < o.minBaseline)
        return null;
    const recent = s.recentLed / s.recentTotal;
    const base = s.baselineLed / s.baselineTotal;
    return recent - base >= o.jump ? { ruleId: exports.FRAUD_RULES.PROVIDER_LED_SHARE_JUMP, score: Math.min(100, Math.round(50 + (recent - base) * 50)) } : null;
}
let FraudSignalService = class FraudSignalService {
    prisma;
    limiter;
    scorer;
    constructor(prisma, limiter, scorer) {
        this.prisma = prisma;
        this.limiter = limiter;
        this.scorer = scorer;
    }
    async record(hit, subject, evidenceRef, market = growth_flags_1.GROWTH_DEFAULT_MARKET) {
        await this.prisma.growthFraudSignal.create({ data: { market, ruleId: hit.ruleId, subjectHash: (0, growth_secrets_1.sha256Hex)(`${hit.ruleId}|${subject}`).slice(0, 32), score: hit.score, evidenceRef } });
    }
    async onTouch(t) {
        try {
            const cwr = clickWithoutRender(t, t.minDwellMs);
            if (cwr)
                await this.record(cwr, t.ipHash, t.touchId);
            let burstRefused = false;
            const burst = await this.limiter.limiter.hit(`growth:burst:${t.ipHash}`, (0, growth_limiter_1.growthLimits)().burstPerMin, 60_000);
            if (!burst.ok) {
                const first = await this.limiter.limiter.hit(`growth:burst-signal:${t.ipHash}`, 1, 600_000);
                if (first.ok) {
                    const hit = burstPerIpHash((0, growth_limiter_1.growthLimits)().burstPerMin + 1, (0, growth_limiter_1.growthLimits)().burstPerMin);
                    if (hit)
                        await this.record(hit, t.ipHash);
                }
                burstRefused = true;
            }
            if (this.scorer && (cwr || burstRefused))
                await this.scorer.onTouch({ ipHash: t.ipHash, burst: burstRefused, burstLimit: (0, growth_limiter_1.growthLimits)().burstPerMin, clickWithoutRender: !!cwr });
        }
        catch { }
    }
    async onDecision(orgId, now = new Date()) {
        try {
            const rows = await this.prisma.$queryRaw `
        SELECT count(*) FILTER (WHERE d."origin" = 'PROVIDER_LED' AND d."createdAt" >= ${new Date(now.getTime() - 86_400_000)}) AS recent_led,
               count(*) FILTER (WHERE d."createdAt" >= ${new Date(now.getTime() - 86_400_000)}) AS recent_total,
               count(*) FILTER (WHERE d."origin" = 'PROVIDER_LED' AND d."createdAt" < ${new Date(now.getTime() - 86_400_000)}) AS base_led,
               count(*) FILTER (WHERE d."createdAt" < ${new Date(now.getTime() - 86_400_000)}) AS base_total
        FROM "GrowthAttributionDecision" d JOIN "BookingIntent" b ON b."id" = d."bookingId"
        WHERE b."tenantId" = ${orgId} AND d."supersedesId" IS NULL AND d."createdAt" >= ${new Date(now.getTime() - 30 * 86_400_000)}`;
            const r = rows[0];
            if (!r)
                return;
            const hit = providerLedShareJump({ recentLed: Number(r.recent_led), recentTotal: Number(r.recent_total), baselineLed: Number(r.base_led), baselineTotal: Number(r.base_total) });
            if (hit)
                await this.record(hit, orgId, `org:${orgId}`);
        }
        catch { }
    }
};
exports.FraudSignalService = FraudSignalService;
exports.FraudSignalService = FraudSignalService = __decorate([
    (0, common_1.Injectable)(),
    __param(2, (0, common_1.Optional)()),
    __param(2, (0, common_1.Inject)(fraud_public_1.FRAUD_SCORER)),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, growth_limiter_1.GrowthLimiter, Object])
], FraudSignalService);
//# sourceMappingURL=touch-rules.js.map