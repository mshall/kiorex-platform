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
exports.AssistantCostService = void 0;
const common_1 = require("@nestjs/common");
const market_time_1 = require("../../common/market-time");
const prisma_service_1 = require("../../prisma/prisma.service");
const assistant_audit_1 = require("./assistant.audit");
const assistant_lexicon_1 = require("./assistant.lexicon");
let AssistantCostService = class AssistantCostService {
    prisma;
    audit;
    log = new common_1.Logger('assistant-cost');
    constructor(prisma, audit) {
        this.prisma = prisma;
        this.audit = audit;
    }
    dayKey(now = new Date()) { return new Date(`${(0, assistant_lexicon_1.marketDate)(now)}T00:00:00Z`); }
    startOfMarketDay(now = new Date()) { return new Date(this.dayKey(now).getTime() - (0, market_time_1.marketOffsetMinutes)(now) * 60_000); }
    async breakerTripped(market, now = new Date()) {
        const row = await this.prisma.assistantUsageDaily.findUnique({ where: { day_market: { day: this.dayKey(now), market } } });
        return !!row?.breakerTripped;
    }
    async check(o) {
        const now = o.now ?? new Date();
        const b = o.policy.budgets;
        if (await this.breakerTripped(o.market, now))
            return { ok: false, reason: 'MARKET_BREAKER' };
        if (o.session.turns >= b.turnsPerConversation)
            return { ok: false, reason: 'CONVERSATION_TURNS' };
        if (o.session.tokenBudgetUsed >= b.tokensPerConversation)
            return { ok: false, reason: 'CONVERSATION_TOKENS' };
        if (o.sub) {
            const a = await this.prisma.assistantTurn.aggregate({ _sum: { tokensIn: true, tokensOut: true }, where: { session: { sub: o.sub }, createdAt: { gte: this.startOfMarketDay(now) } } });
            if ((a._sum.tokensIn ?? 0) + (a._sum.tokensOut ?? 0) >= b.tokensPerSubjectDay)
                return { ok: false, reason: 'SUBJECT_DAY' };
        }
        return { ok: true };
    }
    async record(o) {
        const now = o.now ?? new Date();
        const day = this.dayKey(now);
        await this.prisma.assistantSession.update({ where: { id: o.sessionId }, data: { tokenBudgetUsed: { increment: o.tokens }, costMinorUsed: { increment: o.costMinor } } });
        const row = await this.prisma.assistantUsageDaily.upsert({
            where: { day_market: { day, market: o.market } },
            create: { day, market: o.market, tokens: o.tokens, costMinor: o.costMinor, conversations: o.newConversation ? 1 : 0 },
            update: { tokens: { increment: o.tokens }, costMinor: { increment: o.costMinor }, ...(o.newConversation ? { conversations: { increment: 1 } } : {}) },
        });
        const cap = o.policy.budgets.costPerMarketDayMinor;
        if (!row.breakerTripped && cap > 0 && row.costMinor >= cap && row.costMinor - o.costMinor < cap) {
            await this.prisma.assistantUsageDaily.update({ where: { day_market: { day, market: o.market } }, data: { breakerTripped: true } });
            await this.audit.record('budget_breaker_tripped', null, { kind: 'AssistantBudgetBreakerTripped', market: o.market, costMinor: row.costMinor, breaker: true });
            this.log.warn(`AssistantBudgetBreakerTripped market=${o.market} cost=${row.costMinor}/${cap}`);
            return { tripped: true };
        }
        return { tripped: false };
    }
    async reset(market, actor, now = new Date()) {
        await this.prisma.assistantUsageDaily.updateMany({ where: { day: this.dayKey(now), market }, data: { breakerTripped: false } });
        await this.audit.record('budget_breaker_reset', null, { market, actor, breaker: false }, actor);
    }
};
exports.AssistantCostService = AssistantCostService;
exports.AssistantCostService = AssistantCostService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, assistant_audit_1.AssistantAudit])
], AssistantCostService);
//# sourceMappingURL=assistant.cost.service.js.map