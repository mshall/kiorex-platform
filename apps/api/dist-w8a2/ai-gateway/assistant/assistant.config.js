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
exports.AssistantPolicyService = void 0;
const market_core_public_1 = require("../../market/market-core-public");
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const assistant_growth_bridge_1 = require("./assistant.growth-bridge");
const DEFAULTS = {
    languages: ['ar', 'en'], toolsByState: {},
    budgets: { tokensPerTurn: 1500, tokensPerConversation: 8000, turnsPerConversation: 40, tokensPerSubjectDay: 30_000, costPerMarketDayMinor: 200_000 },
    rateLimits: { messagesPerNumberPerHour: 30, globalConcurrency: 50 }, retentionDays: 30, escalationSlaMinutes: 30, model: { mode: 'mock', providerLabel: 'mock' },
};
const int = (n, d) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : d);
let AssistantPolicyService = class AssistantPolicyService {
    moduleRef;
    constructor(moduleRef) {
        this.moduleRef = moduleRef;
    }
    async get(market = market_core_public_1.DEFAULT_MARKET) {
        const { GrowthConfigService } = await (0, assistant_growth_bridge_1.growthPublic)();
        const r = await this.moduleRef.get(GrowthConfigService, { strict: false }).resolve('ASSISTANT_POLICY', { market });
        const p = r.payload ?? {};
        const b = p.budgets ?? {};
        const rl = p.rateLimits ?? {};
        const env = (n) => { const v = Number(process.env[n]); return Number.isFinite(v) && process.env[n] !== undefined && process.env[n] !== '' ? v : undefined; };
        const policy = {
            languages: Array.isArray(p.languages) ? p.languages : DEFAULTS.languages,
            toolsByState: p.toolsByState && typeof p.toolsByState === 'object' ? p.toolsByState : {},
            budgets: {
                tokensPerTurn: env('ASSISTANT_TEST_TOKENS_PER_TURN') ?? int(b.tokensPerTurn, DEFAULTS.budgets.tokensPerTurn),
                tokensPerConversation: env('ASSISTANT_TEST_TOKENS_PER_CONVERSATION') ?? int(b.tokensPerConversation, DEFAULTS.budgets.tokensPerConversation),
                turnsPerConversation: env('ASSISTANT_TEST_TURNS_PER_CONVERSATION') ?? int(b.turnsPerConversation, DEFAULTS.budgets.turnsPerConversation),
                tokensPerSubjectDay: env('ASSISTANT_TEST_TOKENS_PER_SUBJECT_DAY') ?? int(b.tokensPerSubjectDay, DEFAULTS.budgets.tokensPerSubjectDay),
                costPerMarketDayMinor: env('ASSISTANT_TEST_COST_PER_MARKET_DAY_MINOR') ?? int(b.costPerMarketDayMinor, DEFAULTS.budgets.costPerMarketDayMinor),
            },
            rateLimits: { messagesPerNumberPerHour: env('ASSISTANT_TEST_MESSAGES_PER_HOUR') ?? int(rl.messagesPerNumberPerHour, DEFAULTS.rateLimits.messagesPerNumberPerHour), globalConcurrency: env('ASSISTANT_TEST_CONCURRENCY') ?? int(rl.globalConcurrency, DEFAULTS.rateLimits.globalConcurrency) },
            retentionDays: int(p.retentionDays, DEFAULTS.retentionDays), escalationSlaMinutes: int(p.escalationSlaMinutes, DEFAULTS.escalationSlaMinutes),
            model: { mode: p.model?.mode === 'fixture' || p.model?.mode === 'real' ? p.model.mode : 'mock', providerLabel: String(p.model?.providerLabel ?? 'mock') },
            source: r.source, versionId: r.versionId,
        };
        return policy;
    }
};
exports.AssistantPolicyService = AssistantPolicyService;
exports.AssistantPolicyService = AssistantPolicyService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.ModuleRef])
], AssistantPolicyService);
//# sourceMappingURL=assistant.config.js.map