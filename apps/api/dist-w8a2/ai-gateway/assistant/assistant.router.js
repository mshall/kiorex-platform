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
exports.AssistantRouter = void 0;
const market_core_public_1 = require("../../market/market-core-public");
const common_1 = require("@nestjs/common");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const assistant_growth_bridge_1 = require("./assistant.growth-bridge");
const patient_public_1 = require("../../patient/patient-public");
const prisma_service_1 = require("../../prisma/prisma.service");
const assistant_audit_1 = require("./assistant.audit");
const assistant_config_1 = require("./assistant.config");
const assistant_cost_service_1 = require("./assistant.cost.service");
const assistant_model_factory_1 = require("./assistant.model.factory");
const assistant_orchestrator_1 = require("./assistant.orchestrator");
const assistant_rate_limit_1 = require("./assistant.rate-limit");
const assistant_render_1 = require("./assistant.render");
const assistant_safety_1 = require("./assistant.safety");
const assistant_session_service_1 = require("./assistant.session.service");
const assistant_lexicon_1 = require("./assistant.lexicon");
const messaging_public_1 = require("../../messaging/messaging-public");
let AssistantRouter = class AssistantRouter {
    flags;
    patients;
    prisma;
    orchestrator;
    cost;
    policies;
    models;
    rate;
    audit;
    sessions;
    hub;
    log = new common_1.Logger('assistant-router');
    gate = new assistant_rate_limit_1.ConcurrencyGate();
    constructor(flags, patients, prisma, orchestrator, cost, policies, models, rate, audit, sessions, hub) {
        this.flags = flags;
        this.patients = patients;
        this.prisma = prisma;
        this.orchestrator = orchestrator;
        this.cost = cost;
        this.policies = policies;
        this.models = models;
        this.rate = rate;
        this.audit = audit;
        this.sessions = sessions;
        this.hub = hub;
    }
    async route(inbound, conv, profile) {
        const market = profile?.market ?? market_core_public_1.DEFAULT_MARKET;
        try {
            if ((0, assistant_safety_1.isOptOut)(inbound.text))
                return 'DETERMINISTIC';
            if (!(await this.flags.evaluate(assistant_growth_bridge_1.ASSISTANT_FLAG.ASSISTANT, { market })).effective)
                return 'DETERMINISTIC';
            const now = new Date();
            const live = await this.prisma.assistantSession.findFirst({ where: { channelConversationId: conv.id, closedAt: null, expiresAt: { gt: now } } });
            if (conv.state !== 'IDLE' && !live)
                return 'DETERMINISTIC';
            const policy = await this.policies.get(market);
            const model = await this.models.get(policy, market);
            if (profile) {
                if (!(await this.patients.hasConsent(profile.sub, 'AI_PROCESSING'))) {
                    await this.audit.record('consent_missing', live?.id ?? null, { outcome: 'DETERMINISTIC', reason: 'NO_AI_CONSENT' });
                    return 'DETERMINISTIC';
                }
            }
            else if (model.mode === 'real')
                return 'DETERMINISTIC';
            const sessionRef = live ?? { turns: 0, tokenBudgetUsed: 0 };
            const verdict = await this.cost.check({ market, sub: profile?.sub ?? null, session: sessionRef, policy, now });
            if (!verdict.ok) {
                await this.audit.record('budget_stop', live?.id ?? null, { outcome: 'DETERMINISTIC', reason: verdict.reason });
                return 'DETERMINISTIC';
            }
            const rl = await this.rate.perNumber((0, assistant_session_service_1.phoneHashOf)(conv.phone), policy.rateLimits.messagesPerNumberPerHour);
            if (!rl.ok) {
                await this.audit.record('rate_limited', live?.id ?? null, { outcome: 'RATE_LIMITED' });
                if (rl.notify) {
                    const d = (0, assistant_lexicon_1.detectLang)(inbound.text ?? '', conv.locale === 'en' ? 'en' : 'ar') === 'en' ? 'en' : (0, assistant_lexicon_1.detectDialect)(inbound.text ?? '', 'ar');
                    await this.hub.send({ channel: 'WHATSAPP', sub: profile?.sub, to: conv.phone, templateId: (0, assistant_orchestrator_1.templateId)('rate_limited'), locale: d === 'en' ? 'en' : 'ar', body: assistant_render_1.R.rateLimited(d).body });
                }
                return 'HANDLED';
            }
            if (!this.gate.tryEnter(policy.rateLimits.globalConcurrency)) {
                await this.audit.record('concurrency', null, { outcome: 'DETERMINISTIC' });
                return 'DETERMINISTIC';
            }
            try {
                return await this.orchestrator.turn({ inbound, conversation: { id: conv.id, phone: conv.phone, locale: conv.locale }, profile, now });
            }
            finally {
                this.gate.leave();
            }
        }
        catch (e) {
            this.log.warn(`assistant turn failed, deterministic machine answers: ${e.constructor.name}`);
            await this.audit.record('router_error', null, { outcome: 'DETERMINISTIC', code: e.constructor.name });
            return 'DETERMINISTIC';
        }
    }
};
exports.AssistantRouter = AssistantRouter;
exports.AssistantRouter = AssistantRouter = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [control_plane_public_1.FlagsService, patient_public_1.PatientService, prisma_service_1.PrismaService, assistant_orchestrator_1.AssistantOrchestrator, assistant_cost_service_1.AssistantCostService,
        assistant_config_1.AssistantPolicyService, assistant_model_factory_1.AssistantModelFactory, assistant_rate_limit_1.AssistantRateLimit, assistant_audit_1.AssistantAudit, assistant_session_service_1.AssistantSessionService, messaging_public_1.MessagingHub])
], AssistantRouter);
//# sourceMappingURL=assistant.router.js.map