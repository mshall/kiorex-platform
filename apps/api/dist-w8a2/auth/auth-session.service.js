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
exports.AuthSessionService = void 0;
const common_1 = require("@nestjs/common");
const errors_1 = require("../common/errors");
const prisma_service_1 = require("../prisma/prisma.service");
let AuthSessionService = class AuthSessionService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async isRevoked(sid) {
        const s = await this.prisma.authSession.findUnique({ where: { sid }, select: { revokedAt: true } });
        return !!s?.revokedAt;
    }
    async touch(sub, sid, meta) {
        const existing = await this.prisma.authSession.findUnique({ where: { sid } });
        if (!existing) {
            try {
                await this.prisma.authSession.upsert({ where: { sid }, create: { sid, sub, ...meta }, update: {} });
            }
            catch (e) {
                if (e.code !== 'P2002')
                    throw e;
            }
        }
        else if (Date.now() - existing.lastSeenAt.getTime() > 60_000) {
            await this.prisma.authSession.update({ where: { sid }, data: { lastSeenAt: new Date() } });
        }
    }
    async list(sub, currentSid) {
        const rows = await this.prisma.authSession.findMany({ where: { sub, revokedAt: null }, orderBy: { lastSeenAt: 'desc' } });
        return rows.map((r) => ({ id: r.id, device: r.device, clientId: r.clientId, createdAt: r.createdAt, lastSeenAt: r.lastSeenAt, current: r.sid === currentSid }));
    }
    async revoke(sub, id) {
        const r = await this.prisma.authSession.updateMany({ where: { id, sub, revokedAt: null }, data: { revokedAt: new Date() } });
        if (!r.count)
            throw (0, errors_1.notFound)('SESSION_NOT_FOUND', 'Session not found');
        return { ok: true };
    }
    async revokeBySid(sid) {
        const r = await this.prisma.authSession.updateMany({ where: { sid, revokedAt: null }, data: { revokedAt: new Date() } });
        if (!r.count)
            await this.prisma.authSession.upsert({ where: { sid }, create: { sid, sub: 'unknown', revokedAt: new Date() }, update: { revokedAt: new Date() } });
    }
    async revokeAllForSub(sub) {
        return this.prisma.authSession.updateMany({ where: { sub, revokedAt: null }, data: { revokedAt: new Date() } });
    }
};
exports.AuthSessionService = AuthSessionService;
exports.AuthSessionService = AuthSessionService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AuthSessionService);
//# sourceMappingURL=auth-session.service.js.map