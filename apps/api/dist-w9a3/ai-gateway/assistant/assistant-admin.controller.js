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
exports.AssistantAdminController = void 0;
const market_core_public_1 = require("../../market/market-core-public");
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const auth_1 = require("../../common/auth");
const errors_1 = require("../../common/errors");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const assistant_growth_bridge_1 = require("./assistant.growth-bridge");
const prisma_service_1 = require("../../prisma/prisma.service");
const assistant_audit_1 = require("./assistant.audit");
const assistant_config_1 = require("./assistant.config");
const assistant_cost_service_1 = require("./assistant.cost.service");
const assistant_escalation_service_1 = require("./assistant.escalation.service");
const assistant_model_factory_1 = require("./assistant.model.factory");
const assistant_session_service_1 = require("./assistant.session.service");
const OBJ = { schema: { type: 'object', additionalProperties: true } };
const ARR = { schema: { type: 'array', items: { type: 'object', additionalProperties: true } } };
const READ = ['super_admin', 'ops_admin', 'finance', 'support'];
const HUMAN = ['super_admin', 'support'];
const K_MIN = 10;
const num = (v, d, max) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), max) : d; };
let AssistantAdminController = class AssistantAdminController {
    prisma;
    flags;
    policies;
    cost;
    escalations;
    sessions;
    audit;
    models;
    constructor(prisma, flags, policies, cost, escalations, sessions, audit, models) {
        this.prisma = prisma;
        this.flags = flags;
        this.policies = policies;
        this.cost = cost;
        this.escalations = escalations;
        this.sessions = sessions;
        this.audit = audit;
        this.models = models;
    }
    async status(market = market_core_public_1.DEFAULT_MARKET) {
        const policy = await this.policies.get(market);
        const chain = await this.models.get(policy, market);
        const [a, r] = await Promise.all([this.flags.evaluate(assistant_growth_bridge_1.ASSISTANT_FLAG.ASSISTANT, { market }), this.flags.evaluate(assistant_growth_bridge_1.ASSISTANT_FLAG.REAL_MODEL, { market })]);
        const day = this.cost.dayKey();
        const usage = await this.prisma.assistantUsageDaily.findUnique({ where: { day_market: { day, market } } });
        const open = await this.prisma.assistantEscalation.count({ where: { status: { in: ['OPEN', 'ACKED'] } } });
        const overdue = await this.prisma.assistantEscalation.count({ where: { status: { in: ['OPEN', 'ACKED'] }, slaDueAt: { lt: new Date() } } });
        return {
            market, mode: chain.mode, model: chain.name, policy: { source: policy.source, versionId: policy.versionId, retentionDays: policy.retentionDays, escalationSlaMinutes: policy.escalationSlaMinutes, model: policy.model },
            flags: { assistant: { key: assistant_growth_bridge_1.ASSISTANT_FLAG.ASSISTANT, effective: a.effective, reason: a.reason, blockedBy: a.blockedBy ?? null }, realModel: { key: assistant_growth_bridge_1.ASSISTANT_FLAG.REAL_MODEL, effective: r.effective, reason: r.reason } },
            realModelConfigured: !!(process.env.ASSISTANT_BASE_URL && process.env.ASSISTANT_MODEL && process.env.ASSISTANT_API_KEY),
            usageToday: { tokens: usage?.tokens ?? 0, costMinor: usage?.costMinor ?? 0, conversations: usage?.conversations ?? 0, breakerTripped: usage?.breakerTripped ?? false }, budgets: policy.budgets, rateLimits: policy.rateLimits,
            escalations: { open, overdue },
        };
    }
    async conversations(state, limit, market = market_core_public_1.DEFAULT_MARKET) {
        const rows = await this.prisma.assistantSession.findMany({ where: { market, ...(state ? { state } : {}) }, orderBy: { createdAt: 'desc' }, take: num(limit, 50, 200), include: { escalations: { select: { id: true, status: true } } } });
        return rows.map((s) => ({ id: s.id, createdAt: s.createdAt, state: s.state, language: s.language, turns: s.turns, tokens: s.tokenBudgetUsed, costMinor: s.costMinorUsed, verified: !!s.sub, escalated: s.escalations.length > 0, escalationStatus: s.escalations[0]?.status ?? null, expiresAt: s.expiresAt }));
    }
    async conversation(u, id) {
        const s = await this.prisma.assistantSession.findUnique({ where: { id } });
        if (!s)
            throw (0, errors_1.notFound)('ASSISTANT_SESSION_NOT_FOUND', 'Conversation not found');
        await this.audit.record('transcript_viewed', id, { actor: u.sub }, u.sub);
        const turns = await this.sessions.transcript(id);
        const calls = await this.prisma.assistantToolCall.findMany({ where: { turn: { sessionId: id } }, orderBy: { createdAt: 'asc' }, take: 100, select: { tool: true, argsRedacted: true, resultKind: true, createdAt: true } });
        return { id: s.id, state: s.state, language: s.language, verified: !!s.sub, createdAt: s.createdAt, turns, toolCalls: calls };
    }
    async escalationList(status) {
        const rows = await this.prisma.assistantEscalation.findMany({ where: status ? { status } : { status: { in: ['OPEN', 'ACKED'] } }, orderBy: { slaDueAt: 'asc' }, take: 100 });
        const now = Date.now();
        return rows.map((e) => ({ id: e.id, sessionId: e.sessionId, reason: e.reason, status: e.status, ackBy: e.ackBy, createdAt: e.createdAt, slaDueAt: e.slaDueAt, overdue: e.status !== 'CLOSED' && e.slaDueAt.getTime() < now, minutesLeft: Math.round((e.slaDueAt.getTime() - now) / 60_000), closedAt: e.closedAt }));
    }
    async escalation(u, id) {
        const e = await this.prisma.assistantEscalation.findUnique({ where: { id } });
        if (!e)
            throw (0, errors_1.notFound)('ASSISTANT_ESCALATION_NOT_FOUND', 'Escalation not found');
        await this.audit.record('transcript_viewed', e.sessionId, { actor: u.sub, escalationId: id }, u.sub);
        return { id: e.id, sessionId: e.sessionId, reason: e.reason, status: e.status, slaDueAt: e.slaDueAt, transcript: e.transcript };
    }
    async ack(u, id) { return { acked: await this.escalations.ack(id, u.sub) }; }
    async close(u, id) { if (!(await this.escalations.close(id, u.sub)))
        throw (0, errors_1.notFound)('ASSISTANT_ESCALATION_NOT_FOUND', 'Escalation not found or already closed'); return { closed: true }; }
    async budgets(market = market_core_public_1.DEFAULT_MARKET) {
        const policy = await this.policies.get(market);
        const days = await this.prisma.assistantUsageDaily.findMany({ where: { market }, orderBy: { day: 'desc' }, take: 14 });
        return { market, budgets: policy.budgets, rateLimits: policy.rateLimits, days: days.map((d) => ({ day: d.day.toISOString().slice(0, 10), tokens: d.tokens, costMinor: d.costMinor, conversations: d.conversations, breakerTripped: d.breakerTripped })) };
    }
    async reset(u, market = market_core_public_1.DEFAULT_MARKET) { await this.cost.reset(market, u.sub); return { reset: true }; }
    async metrics(days, market = market_core_public_1.DEFAULT_MARKET) {
        const since = new Date(Date.now() - num(days, 30, 365) * 86_400_000);
        const sessions = await this.prisma.assistantSession.count({ where: { market, createdAt: { gte: since } } });
        if (sessions < K_MIN)
            return { masked: true, k: K_MIN, sessions: null, containmentRate: null, handoffRate: null, bookingCompletionRate: null, costPerBookingMinor: null, p95LatencyMs: null };
        const handed = await this.prisma.assistantSession.count({ where: { market, createdAt: { gte: since }, escalations: { some: {} } } });
        const booked = await this.prisma.assistantSession.count({ where: { market, createdAt: { gte: since }, turnRows: { some: { toolCalls: { some: { tool: 'confirm_booking', resultKind: 'OK:BOOK' } } } } } });
        const agg = await this.prisma.assistantSession.aggregate({ _sum: { costMinorUsed: true }, where: { market, createdAt: { gte: since } } });
        const p = await this.prisma.$queryRaw `SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs") AS p95 FROM "AssistantTurn" t JOIN "AssistantSession" s ON s.id = t."sessionId" WHERE t.direction = 'OUT' AND s.market = ${market} AND t."createdAt" >= ${since}`;
        const r = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 1000 : null);
        return { masked: false, k: K_MIN, sessions, containmentRate: r(sessions - handed, sessions), handoffRate: r(handed, sessions), bookingCompletionRate: r(booked, sessions), costPerBookingMinor: booked >= K_MIN ? Math.round((agg._sum.costMinorUsed ?? 0) / booked) : null, p95LatencyMs: p[0]?.p95 != null ? Math.round(Number(p[0].p95)) : null };
    }
};
exports.AssistantAdminController = AssistantAdminController;
__decorate([
    (0, common_1.Get)('status'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-D assistant mode, gate status, budgets and breaker' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)('market')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AssistantAdminController.prototype, "status", null);
__decorate([
    (0, common_1.Get)('conversations'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-D assistant conversations (no phone, no subject)' }),
    (0, swagger_1.ApiOkResponse)(ARR),
    __param(0, (0, common_1.Query)('state')),
    __param(1, (0, common_1.Query)('limit')),
    __param(2, (0, common_1.Query)('market')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", Promise)
], AssistantAdminController.prototype, "conversations", null);
__decorate([
    (0, auth_1.Roles)(...HUMAN),
    (0, common_1.Get)('conversations/:id'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-D redacted transcript of one conversation (view is audited)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], AssistantAdminController.prototype, "conversation", null);
__decorate([
    (0, common_1.Get)('escalations'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-D escalation queue with SLA timers' }),
    (0, swagger_1.ApiOkResponse)(ARR),
    __param(0, (0, common_1.Query)('status')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AssistantAdminController.prototype, "escalationList", null);
__decorate([
    (0, auth_1.Roles)(...HUMAN),
    (0, common_1.Get)('escalations/:id'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-D escalation with its redacted transcript (view is audited)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], AssistantAdminController.prototype, "escalation", null);
__decorate([
    (0, auth_1.Roles)(...HUMAN),
    (0, common_1.Post)('escalations/:id/ack'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-D acknowledge an escalation' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], AssistantAdminController.prototype, "ack", null);
__decorate([
    (0, auth_1.Roles)(...HUMAN),
    (0, common_1.Post)('escalations/:id/close'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-D close an escalation; the assistant answers the next message again' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], AssistantAdminController.prototype, "close", null);
__decorate([
    (0, common_1.Get)('budgets'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-D budgets, today usage and the last 14 days' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)('market')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AssistantAdminController.prototype, "budgets", null);
__decorate([
    (0, auth_1.Roles)('super_admin'),
    (0, common_1.Post)('budgets/reset-breaker'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-D reset the daily cost breaker (super admin, audited)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Query)('market')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AssistantAdminController.prototype, "reset", null);
__decorate([
    (0, common_1.Get)('metrics'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-D containment, handoff, completion, cost per booking, p95 latency; masked below k = 10 conversations' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)('days')),
    __param(1, (0, common_1.Query)('market')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AssistantAdminController.prototype, "metrics", null);
exports.AssistantAdminController = AssistantAdminController = __decorate([
    (0, swagger_1.ApiTags)('growth-assistant'),
    (0, auth_1.Roles)(...READ),
    (0, common_1.Controller)('admin/growth/assistant'),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, control_plane_public_1.FlagsService, assistant_config_1.AssistantPolicyService, assistant_cost_service_1.AssistantCostService, assistant_escalation_service_1.AssistantEscalationService,
        assistant_session_service_1.AssistantSessionService, assistant_audit_1.AssistantAudit, assistant_model_factory_1.AssistantModelFactory])
], AssistantAdminController);
//# sourceMappingURL=assistant-admin.controller.js.map