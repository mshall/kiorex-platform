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
exports.AssistantLinkService = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const config_1 = require("../../common/config");
const assistant_growth_bridge_1 = require("./assistant.growth-bridge");
const prisma_service_1 = require("../../prisma/prisma.service");
const assistant_audit_1 = require("./assistant.audit");
const assistant_policy_1 = require("./assistant.policy");
let AssistantLinkService = class AssistantLinkService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async sign(exp, rand) {
        const k = (await (0, assistant_growth_bridge_1.growthPublic)()).linkTokenKey();
        if (!k)
            return null;
        return (0, node_crypto_1.createHmac)('sha256', k).update(`kxa1.${exp}.${rand}`).digest('base64url').slice(0, 32);
    }
    async create(o) {
        const now = o.now ?? new Date();
        const expiresAt = new Date(now.getTime() + assistant_policy_1.LIMITS.linkTtlMinutes * 60_000);
        const exp = Math.floor(expiresAt.getTime() / 1000).toString(36);
        const rand = (0, node_crypto_1.randomBytes)(18).toString('base64url');
        const sig = await this.sign(exp, rand);
        if (!sig)
            return null;
        const token = `kxa1.${exp}.${rand}.${sig}`;
        await this.prisma.assistantLink.create({ data: { tokenHash: (0, assistant_audit_1.sha)(token), phoneHash: o.phoneHash, intent: o.intent, payload: (o.payload ?? {}), expiresAt } });
        return { url: `${(0, config_1.cfg)().appLinkBase.replace(/\/$/, '')}/assistant?al=${token}`, expiresAt };
    }
    async verify(token, now = new Date()) {
        const parts = token.split('.');
        if (parts.length !== 4 || parts[0] !== 'kxa1' || token.length > 200)
            return { ok: false, code: 'INVALID' };
        const [, exp, rand, sig] = parts;
        const want = await this.sign(exp, rand);
        if (!want || want.length !== sig.length || !(0, node_crypto_1.timingSafeEqual)(Buffer.from(want), Buffer.from(sig)))
            return { ok: false, code: 'INVALID' };
        if (parseInt(exp, 36) * 1000 <= now.getTime())
            return { ok: false, code: 'EXPIRED' };
        const row = await this.prisma.assistantLink.findUnique({ where: { tokenHash: (0, assistant_audit_1.sha)(token) } });
        if (!row)
            return { ok: false, code: 'INVALID' };
        if (row.usedAt)
            return { ok: false, code: 'USED' };
        const claimed = await this.prisma.assistantLink.updateMany({ where: { id: row.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
        if (claimed.count !== 1)
            return { ok: false, code: 'USED' };
        return { ok: true, intent: row.intent, payload: (row.payload ?? {}), phoneHash: row.phoneHash };
    }
};
exports.AssistantLinkService = AssistantLinkService;
exports.AssistantLinkService = AssistantLinkService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AssistantLinkService);
//# sourceMappingURL=assistant.link.service.js.map