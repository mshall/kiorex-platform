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
exports.ConfirmationStore = exports.BUTTON_RE = void 0;
exports.parseButton = parseButton;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const prisma_service_1 = require("../../prisma/prisma.service");
const assistant_audit_1 = require("./assistant.audit");
const assistant_policy_1 = require("./assistant.policy");
exports.BUTTON_RE = /^(CONFIRM|DECLINE):([A-Za-z0-9_-]{6,64}):([A-Za-z0-9_-]{16,48})$/;
function parseButton(payload) {
    if (!payload)
        return null;
    const m = exports.BUTTON_RE.exec(payload.trim());
    return m ? { decision: m[1], targetRef: m[2], nonce: m[3] } : null;
}
let ConfirmationStore = class ConfirmationStore {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async issue(o) {
        const nonce = (0, node_crypto_1.randomBytes)(18).toString('base64url');
        await this.prisma.assistantConfirmation.create({ data: { sessionId: o.sessionId, sub: o.sub, kind: o.kind, targetRef: o.targetRef, payload: (o.payload ?? {}), nonceHash: (0, assistant_audit_1.sha)(nonce), expiresAt: new Date(Date.now() + (o.ttlMinutes ?? assistant_policy_1.LIMITS.confirmTtlMinutes) * 60_000) } });
        return { confirmId: `CONFIRM:${o.targetRef}:${nonce}`, declineId: `DECLINE:${o.targetRef}:${nonce}`, nonceHash: (0, assistant_audit_1.sha)(nonce) };
    }
    async consume(b, who, now = new Date()) {
        const row = await this.prisma.assistantConfirmation.findUnique({ where: { nonceHash: (0, assistant_audit_1.sha)(b.nonce) } });
        if (!row || row.targetRef !== b.targetRef)
            return { ok: false, code: 'INVALID' };
        if (row.sub !== who.sub || row.sessionId !== who.sessionId)
            return { ok: false, code: 'FOREIGN' };
        if (row.usedAt)
            return { ok: false, code: 'USED', kind: row.kind, resultRef: row.resultRef, outcome: row.outcome };
        if (row.expiresAt <= now)
            return { ok: false, code: 'EXPIRED', kind: row.kind };
        const claimed = await this.prisma.assistantConfirmation.updateMany({ where: { id: row.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now, outcome: b.decision === 'CONFIRM' ? 'CONFIRMED' : 'DECLINED' } });
        if (claimed.count !== 1)
            return { ok: false, code: 'USED', kind: row.kind, resultRef: row.resultRef };
        return { ok: true, id: row.id, kind: row.kind, targetRef: row.targetRef, payload: (row.payload ?? {}) };
    }
    async setResult(id, resultRef) { await this.prisma.assistantConfirmation.update({ where: { id }, data: { resultRef: resultRef.slice(0, 80) } }).catch(() => undefined); }
    async revokeFor(sessionId, targetRef) { await this.prisma.assistantConfirmation.updateMany({ where: { sessionId, targetRef, usedAt: null }, data: { usedAt: new Date(), outcome: 'DECLINED' } }); }
    async revokeAllPending(sessionId) { await this.prisma.assistantConfirmation.updateMany({ where: { sessionId, usedAt: null }, data: { usedAt: new Date(), outcome: 'DECLINED' } }); }
};
exports.ConfirmationStore = ConfirmationStore;
exports.ConfirmationStore = ConfirmationStore = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ConfirmationStore);
//# sourceMappingURL=assistant.confirm.js.map