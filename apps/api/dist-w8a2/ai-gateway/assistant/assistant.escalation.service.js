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
exports.AssistantEscalationService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const assistant_audit_1 = require("./assistant.audit");
const assistant_session_service_1 = require("./assistant.session.service");
let AssistantEscalationService = class AssistantEscalationService {
    prisma;
    sessions;
    audit;
    constructor(prisma, sessions, audit) {
        this.prisma = prisma;
        this.sessions = sessions;
        this.audit = audit;
    }
    async open(o) {
        const open = await this.prisma.assistantEscalation.findFirst({ where: { sessionId: o.sessionId, status: { in: ['OPEN', 'ACKED'] } } });
        if (open)
            return open;
        const now = o.now ?? new Date();
        const transcript = await this.sessions.transcript(o.sessionId);
        const e = await this.prisma.assistantEscalation.create({ data: { sessionId: o.sessionId, reason: o.reason.slice(0, 40), slaDueAt: new Date(now.getTime() + o.slaMinutes * 60_000), transcript: transcript } });
        await this.audit.record('escalation_created', o.sessionId, { reason: o.reason, escalationId: e.id });
        return e;
    }
    async isOpen(sessionId) { return !!(await this.prisma.assistantEscalation.findFirst({ where: { sessionId, status: { in: ['OPEN', 'ACKED'] } }, select: { id: true } })); }
    async ack(id, by) {
        const r = await this.prisma.assistantEscalation.updateMany({ where: { id, status: 'OPEN' }, data: { status: 'ACKED', ackBy: by } });
        if (r.count)
            await this.audit.record('escalation_acked', null, { escalationId: id, actor: by }, by);
        return r.count === 1;
    }
    async close(id, by) {
        const e = await this.prisma.assistantEscalation.findUnique({ where: { id } });
        if (!e || e.status === 'CLOSED')
            return false;
        await this.prisma.assistantEscalation.update({ where: { id }, data: { status: 'CLOSED', closedAt: new Date(), closedBy: by } });
        await this.sessions.save(e.sessionId, { state: 'UNDERSTAND', escalatedAt: null });
        await this.audit.record('escalation_closed', e.sessionId, { escalationId: id, actor: by }, by);
        return true;
    }
};
exports.AssistantEscalationService = AssistantEscalationService;
exports.AssistantEscalationService = AssistantEscalationService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, assistant_session_service_1.AssistantSessionService, assistant_audit_1.AssistantAudit])
], AssistantEscalationService);
//# sourceMappingURL=assistant.escalation.service.js.map