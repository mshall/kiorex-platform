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
exports.AssistantSessionService = exports.phoneHashOf = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const privacy_hash_1 = require("../../common/privacy-hash");
const prisma_service_1 = require("../../prisma/prisma.service");
const assistant_policy_1 = require("./assistant.policy");
const assistant_types_1 = require("./assistant.types");
const phoneHashOf = (phone) => (0, node_crypto_1.createHmac)('sha256', (0, privacy_hash_1.growthKey)('assistant-phone')).update(phone).digest('base64url').slice(0, 40);
exports.phoneHashOf = phoneHashOf;
let AssistantSessionService = class AssistantSessionService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async load(o) {
        const now = o.now ?? new Date();
        const expiresAt = new Date(now.getTime() + assistant_policy_1.LIMITS.sessionHours * 3_600_000);
        let s = await this.prisma.assistantSession.findUnique({ where: { channelConversationId: o.conversationId } });
        let expiredPrevious = null;
        if (s && (s.expiresAt <= now || s.closedAt)) {
            expiredPrevious = this.ctxOf(s);
            await this.prisma.assistantSession.update({ where: { id: s.id }, data: { channelConversationId: `${o.conversationId}:old:${s.id}`, closedAt: s.closedAt ?? now, state: 'CLOSED' } });
            s = null;
        }
        if (!s) {
            s = await this.prisma.assistantSession.create({ data: { channelConversationId: o.conversationId, market: o.market, sub: o.sub, phoneHash: (0, exports.phoneHashOf)(o.phone), state: 'GREETING', language: o.language, expiresAt, context: (0, assistant_types_1.emptyContext)() } });
            return { session: s, ctx: (0, assistant_types_1.emptyContext)(), created: true, expiredPrevious };
        }
        if (s.sub !== o.sub)
            s = await this.prisma.assistantSession.update({ where: { id: s.id }, data: { sub: o.sub } });
        return { session: s, ctx: this.ctxOf(s), created: false, expiredPrevious };
    }
    ctxOf(s) {
        const c = (s.context ?? {});
        const base = (0, assistant_types_1.emptyContext)();
        return { ...base, ...c, shown: { ...base.shown, ...(c.shown ?? {}) }, idsSeen: Array.isArray(c.idsSeen) ? c.idsSeen.slice(-200) : [] };
    }
    async save(id, patch, now = new Date()) {
        return this.prisma.assistantSession.update({
            where: { id },
            data: {
                ...(patch.state ? { state: patch.state } : {}), ...(patch.ctx ? { context: patch.ctx } : {}), ...(patch.language ? { language: patch.language } : {}),
                ...(patch.touch !== false ? { expiresAt: new Date(now.getTime() + assistant_policy_1.LIMITS.sessionHours * 3_600_000) } : {}),
                ...(patch.escalatedAt !== undefined ? { escalatedAt: patch.escalatedAt } : {}), ...(patch.closedAt !== undefined ? { closedAt: patch.closedAt } : {}),
                ...(patch.turnsIncrement ? { turns: { increment: 1 } } : {}), ...(patch.lastToolAt ? { lastToolAt: patch.lastToolAt } : {}),
            },
        });
    }
    async addTurn(o) {
        return this.prisma.assistantTurn.upsert({
            where: { sessionId_seq_direction: { sessionId: o.sessionId, seq: o.seq, direction: o.direction } },
            create: { sessionId: o.sessionId, seq: o.seq, direction: o.direction, redactedText: o.redactedText ?? '', intent: o.intent, toolName: o.toolName, modelMode: o.modelMode ?? 'mock', tokensIn: o.tokensIn ?? 0, tokensOut: o.tokensOut ?? 0, costMinor: o.costMinor ?? 0, latencyMs: o.latencyMs ?? 0, outcome: o.outcome ?? 'OK', purgeAfter: new Date(Date.now() + o.retentionDays * 86_400_000) },
            update: { ...(o.intent !== undefined ? { intent: o.intent } : {}), ...(o.toolName !== undefined ? { toolName: o.toolName } : {}), ...(o.tokensIn !== undefined ? { tokensIn: o.tokensIn } : {}), ...(o.tokensOut !== undefined ? { tokensOut: o.tokensOut } : {}), ...(o.costMinor !== undefined ? { costMinor: o.costMinor } : {}), ...(o.latencyMs !== undefined ? { latencyMs: o.latencyMs } : {}), ...(o.outcome !== undefined ? { outcome: o.outcome } : {}), ...(o.modelMode ? { modelMode: o.modelMode } : {}) },
        });
    }
    async addToolCall(o) {
        return this.prisma.assistantToolCall.create({ data: { turnId: o.turnId, tool: o.tool, argsRedacted: o.argsRedacted, resultKind: o.resultKind, resultRef: o.resultRef?.slice(0, 80), confirmNonceHash: o.confirmNonceHash } });
    }
    async transcript(sessionId) {
        const rows = await this.prisma.assistantTurn.findMany({ where: { sessionId }, orderBy: [{ seq: 'asc' }, { direction: 'asc' }], take: 120 });
        return rows.map((t) => ({ seq: t.seq, direction: t.direction, text: t.direction === 'IN' ? t.redactedText : '', template: t.direction === 'OUT' ? t.intent : t.intent, outcome: t.outcome, at: t.createdAt }));
    }
};
exports.AssistantSessionService = AssistantSessionService;
exports.AssistantSessionService = AssistantSessionService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AssistantSessionService);
//# sourceMappingURL=assistant.session.service.js.map