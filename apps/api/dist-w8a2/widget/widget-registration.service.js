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
exports.WidgetRegistrationService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const widget_audit_service_1 = require("./widget-audit.service");
const widget_origins_1 = require("./widget-origins");
const SLUG = /^[a-z0-9-]{3,60}$/;
let WidgetRegistrationService = class WidgetRegistrationService {
    prisma;
    audit;
    log = new common_1.Logger('widget');
    constructor(prisma, audit) {
        this.prisma = prisma;
        this.audit = audit;
    }
    async upsertFromProfile(data) {
        const orgRef = typeof data.clinicId === 'string' && data.clinicId.length > 0 && data.clinicId.length <= 80 ? data.clinicId : null;
        if (!orgRef)
            return 'IGNORED';
        const origins = (0, widget_origins_1.sanitizeRegisteredOrigins)(data.widgetOrigins);
        const rawSlug = data.clinic?.bookingSlug ?? data.clinic?.slug ?? data.bookingSlug;
        const slug = typeof rawSlug === 'string' && SLUG.test(rawSlug) ? rawSlug : null;
        const prev = await this.prisma.widgetRegistration.findUnique({ where: { orgRef } });
        const same = prev && prev.origins.length === origins.length && prev.origins.every((o, i) => o === origins[i]) && (!slug || prev.orgSlug === slug);
        if (same) {
            await this.prisma.widgetRegistration.update({ where: { orgRef }, data: { syncedAt: new Date() } });
            return 'APPLIED';
        }
        await this.prisma.widgetRegistration.upsert({
            where: { orgRef },
            create: { orgRef, orgSlug: slug, origins, status: 'ACTIVE' },
            update: { origins, ...(slug ? { orgSlug: slug } : {}), syncedAt: new Date() },
        });
        await this.audit.registrationSynced(orgRef, prev?.origins ?? [], origins);
        return 'APPLIED';
    }
    async resolve(slugOrRef) {
        const key = slugOrRef.trim();
        if (!key || key.length > 80)
            return null;
        const direct = await this.prisma.widgetRegistration.findFirst({ where: { OR: [{ orgSlug: key }, { orgRef: key }] } });
        if (direct)
            return direct;
        const gs = await this.prisma.growthSlug.findFirst({ where: { entityType: 'CLINIC', slug: key }, select: { entityId: true } });
        return gs ? this.prisma.widgetRegistration.findUnique({ where: { orgRef: gs.entityId } }) : null;
    }
    byOrg(orgRef) { return this.prisma.widgetRegistration.findUnique({ where: { orgRef } }); }
    effectiveOrigins(reg) { return reg.status === 'ACTIVE' ? (0, widget_origins_1.allowedOrigins)(reg.origins) : []; }
    list(take = 100) { return this.prisma.widgetRegistration.findMany({ orderBy: { updatedAt: 'desc' }, take }); }
};
exports.WidgetRegistrationService = WidgetRegistrationService;
exports.WidgetRegistrationService = WidgetRegistrationService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, widget_audit_service_1.WidgetAuditService])
], WidgetRegistrationService);
//# sourceMappingURL=widget-registration.service.js.map