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
exports.AssistantAudit = exports.sha = void 0;
exports.safeMeta = safeMeta;
exports.redactToolArgs = redactToolArgs;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const prisma_service_1 = require("../../prisma/prisma.service");
const SAFE_KEYS = new Set(['tool', 'outcome', 'mode', 'model', 'tokensIn', 'tokensOut', 'costMinor', 'kind', 'reason', 'nonceHash', 'code', 'actor', 'market', 'count', 'state', 'step', 'signals', 'targetHash', 'status', 'escalationId', 'breaker', 'turn', 'latencyMs']);
const sha = (s) => (0, node_crypto_1.createHash)('sha256').update(s, 'utf8').digest('hex');
exports.sha = sha;
function safeMeta(m) {
    const out = {};
    for (const [k, v] of Object.entries(m)) {
        if (!SAFE_KEYS.has(k))
            continue;
        if (typeof v === 'string')
            out[k] = v.slice(0, 80);
        else if (typeof v === 'number' || typeof v === 'boolean' || v === null)
            out[k] = v;
        else if (Array.isArray(v))
            out[k] = v.filter((x) => typeof x === 'string' || typeof x === 'number').slice(0, 20).map((x) => (typeof x === 'string' ? x.slice(0, 40) : x));
    }
    return out;
}
function redactToolArgs(args) {
    const out = {};
    for (const [k, v] of Object.entries(args)) {
        if (['providerId', 'holdId', 'bookingId'].includes(k) && typeof v === 'string')
            out[k] = v.slice(0, 40);
        else if (k === 'startsAt' && typeof v === 'string')
            out[k] = v.slice(0, 16);
        else if (typeof v === 'boolean' || typeof v === 'number')
            out[k] = typeof v === 'number' ? '[number]' : v;
        else
            out[k] = '[set]';
    }
    return out;
}
let AssistantAudit = class AssistantAudit {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async record(action, sessionId, meta, actor = 'system:assistant') {
        await this.prisma.auditLog.create({ data: { actor, action: `assistant.${action}`, resource: 'AssistantSession', resourceId: sessionId, metadata: safeMeta(meta) } }).catch(() => undefined);
    }
};
exports.AssistantAudit = AssistantAudit;
exports.AssistantAudit = AssistantAudit = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AssistantAudit);
//# sourceMappingURL=assistant.audit.js.map