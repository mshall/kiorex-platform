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
exports.WidgetAuditService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const widget_limiter_1 = require("./widget-limiter");
let WidgetAuditService = class WidgetAuditService {
    prisma;
    limiter;
    constructor(prisma, limiter) {
        this.prisma = prisma;
        this.limiter = limiter;
    }
    safe(v) { return (v ?? '').replace(/[^\x21-\x7e]/g, '').slice(0, 120); }
    async denied(orgRef, claimedOrigin, reason, surface) {
        const origin = this.safe(claimedOrigin);
        const r = await this.limiter.limiter.hit(`widget-audit:${orgRef ?? '-'}:${origin}:${reason}`, 1, 3_600_000);
        if (!r.ok)
            return;
        await this.prisma.auditLog.create({ data: { actor: 'widget', action: 'widget.origin_denied', resource: 'WidgetRegistration', resourceId: orgRef ?? undefined, metadata: { reason, origin, surface } } }).catch(() => undefined);
    }
    async registrationSynced(orgRef, before, after) {
        await this.prisma.auditLog.create({ data: { actor: 'kiorly', action: 'widget.registration_synced', resource: 'WidgetRegistration', resourceId: orgRef, metadata: { before, after } } });
    }
    async list(o = {}) {
        return this.prisma.auditLog.findMany({
            where: { resource: 'WidgetRegistration', ...(o.orgRef ? { resourceId: o.orgRef } : {}) },
            orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(o.limit ?? 100, 1), 500),
        });
    }
};
exports.WidgetAuditService = WidgetAuditService;
exports.WidgetAuditService = WidgetAuditService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, widget_limiter_1.WidgetLimiter])
], WidgetAuditService);
//# sourceMappingURL=widget-audit.service.js.map