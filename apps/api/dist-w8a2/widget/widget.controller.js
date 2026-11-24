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
exports.WidgetController = void 0;
const market_core_public_1 = require("../market/market-core-public");
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const contracts_1 = require("@kiorex/contracts");
const auth_1 = require("../common/auth");
const errors_1 = require("../common/errors");
const privacy_hash_1 = require("../common/privacy-hash");
const catalog_public_1 = require("../catalog/catalog-public");
const control_plane_public_1 = require("../control-plane/control-plane-public");
const prisma_service_1 = require("../prisma/prisma.service");
const widget_audit_service_1 = require("./widget-audit.service");
const widget_limiter_1 = require("./widget-limiter");
const widget_origins_1 = require("./widget-origins");
const widget_policy_service_1 = require("./widget-policy.service");
const widget_registration_service_1 = require("./widget-registration.service");
const widget_token_1 = require("./widget-token");
const widget_config_1 = require("./widget.config");
const OBJ = { schema: { type: 'object', additionalProperties: true } };
class SessionBody {
    org;
    parentOrigin;
    sandbox;
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(80),
    __metadata("design:type", String)
], SessionBody.prototype, "org", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(255),
    __metadata("design:type", String)
], SessionBody.prototype, "parentOrigin", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], SessionBody.prototype, "sandbox", void 0);
let WidgetController = class WidgetController {
    flags;
    regs;
    audit;
    limiter;
    policy;
    prisma;
    catalog;
    constructor(flags, regs, audit, limiter, policy, prisma, catalog) {
        this.flags = flags;
        this.regs = regs;
        this.audit = audit;
        this.limiter = limiter;
        this.policy = policy;
        this.prisma = prisma;
        this.catalog = catalog;
    }
    async session(req, b) {
        await this.flags.assertEnabled('growth.widgets', { market: market_core_public_1.DEFAULT_MARKET });
        const self = (0, widget_origins_1.widgetSelfOrigin)(req.protocol, req.headers?.host);
        const seen = (0, widget_origins_1.originOfUrl)(req.headers?.origin);
        if (!seen || seen !== self) {
            await this.audit.denied(null, req.headers?.origin ?? '', 'ORIGIN_MISMATCH', 'session');
            throw (0, errors_1.forbidden)('WIDGET_ORIGIN_MISMATCH', 'Sessions are issued to the widget app only');
        }
        await this.limiter.take('session-ip', (0, privacy_hash_1.ipHashOf)(req.ip), (0, widget_limiter_1.widgetLimits)().sessionPerMin);
        const reg = await this.regs.resolve(b.org);
        if (!reg)
            throw (0, errors_1.notFound)('WIDGET_NOT_FOUND', 'Unknown organisation');
        const parent = (0, widget_origins_1.originOfUrl)(b.parentOrigin);
        if (!parent) {
            await this.audit.denied(reg.orgRef, b.parentOrigin, 'NO_PARENT', 'session');
            throw (0, errors_1.badRequest)('WIDGET_PARENT_ORIGIN_REQUIRED', 'The embedding page origin could not be determined');
        }
        const sandbox = b.sandbox === true && (0, widget_config_1.widgetCfg)().sandbox && parent === self;
        if (!sandbox && !this.regs.effectiveOrigins(reg).includes(parent)) {
            await this.audit.denied(reg.orgRef, parent, 'ORIGIN_NOT_ALLOWED', 'session');
            throw new errors_1.ApiError(contracts_1.GROWTH_ERROR_STATUS.GROWTH_WIDGET_ORIGIN_NOT_ALLOWED, 'GROWTH_WIDGET_ORIGIN_NOT_ALLOWED', 'This site is not allowed to embed the booking widget');
        }
        const ttl = (await this.policy.get()).sessionTokenTtlSeconds;
        return { ...(0, widget_token_1.issueWidgetToken)({ org: reg.orgRef, origin: parent, sandbox }, ttl), org: reg.orgRef, slug: reg.orgSlug ?? reg.orgRef };
    }
    async config(req, doctor, specialty) {
        const w = req.widget;
        if (!w)
            throw new errors_1.ApiError(401, 'WIDGET_TOKEN_INVALID', 'Widget session is required');
        const providers = await this.prisma.provider.findMany({ where: { clinicId: w.org, status: 'LIVE' }, orderBy: [{ nameEn: 'asc' }], take: 60 });
        let doctorId;
        if (doctor) {
            doctorId = providers.find((p) => p.id === doctor)?.id;
            if (!doctorId) {
                const s = await this.prisma.growthSlug.findFirst({ where: { entityType: 'DOCTOR', slug: String(doctor).slice(0, 80) }, select: { entityId: true } });
                doctorId = providers.find((p) => p.id === s?.entityId)?.id;
            }
            if (!doctorId)
                throw (0, errors_1.notFound)('WIDGET_DOCTOR_NOT_FOUND', 'This doctor is not available in this widget');
        }
        const picked = providers.filter((p) => (!doctorId || p.id === doctorId) && (!specialty || p.specialty === specialty));
        const raw = providers[0]?.raw ?? {};
        const specs = await this.catalog.specialties();
        return {
            org: { id: w.org, slug: req.widget.orgSlug, nameEn: providers[0]?.clinicNameEn ?? raw.clinic?.nameEn ?? null, nameAr: providers[0]?.clinicNameAr ?? raw.clinic?.nameAr ?? null, logoUrl: typeof raw.clinic?.logoUrl === 'string' && /^https:\/\//.test(raw.clinic.logoUrl) ? raw.clinic.logoUrl : null },
            providers: picked.map((p) => {
                const prov = p.raw?.provider ?? {};
                const fees = (prov.fees ?? []).filter((f) => this.catalog.feeLocation(p, f) !== 'HOME').map((f) => ({ typeId: f.appointmentTypeId, nameEn: f.nameEn ?? null, nameAr: f.nameAr ?? null, amountMinor: Math.round(Number(f.amount) * 100), currency: f.currency ?? p.currency }));
                return { id: p.id, nameEn: p.nameEn, nameAr: p.nameAr, specialty: p.specialty, titleEn: prov.titleEn ?? null, titleAr: prov.titleAr ?? null, photoUrl: typeof (prov.photoUrl ?? null) === 'string' && /^https:\/\//.test(prov.photoUrl) ? prov.photoUrl : null, rating: { average: p.ratingAvg, count: p.ratingCount }, acceptsDeposit: p.acceptsDeposit, fees };
            }).filter((p) => p.fees.length > 0),
            specialties: specs.filter((s) => picked.some((p) => p.specialty === s.code)),
            patientUrl: (0, widget_config_1.widgetCfg)().patientUrl,
            scope: { doctor: doctorId ?? null, specialty: specialty ?? null },
        };
    }
    opsAudit(org, limit) { return this.audit.list({ orgRef: org, limit: limit ? Number(limit) : undefined }); }
    async opsRegistrations() { return (await this.regs.list()).map((r) => ({ orgRef: r.orgRef, orgSlug: r.orgSlug, origins: r.origins, status: r.status, syncedAt: r.syncedAt })); }
};
exports.WidgetController = WidgetController;
__decorate([
    (0, auth_1.Public)(),
    (0, common_1.Post)('session'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-G short-lived widget session token bound to the embedding origin (HMAC, no personal data). 403 GROWTH_WIDGET_ORIGIN_NOT_ALLOWED for an origin that is not in the organisation allow-list; 403 FEATURE_DISABLED when growth.widgets is OFF' }),
    (0, swagger_1.ApiOkResponse)({ description: '{ token, expiresAt, org, slug }', ...OBJ }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, SessionBody]),
    __metadata("design:returntype", Promise)
], WidgetController.prototype, "session", null);
__decorate([
    (0, auth_1.Public)(),
    (0, common_1.Get)('config'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-G widget data: clinic, bookable doctors with visit types and fees (IN_CLINIC only), specialties. Needs X-KX-Widget' }),
    (0, swagger_1.ApiOkResponse)({ description: 'Widget configuration', ...OBJ }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('doctor')),
    __param(2, (0, common_1.Query)('specialty')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], WidgetController.prototype, "config", null);
__decorate([
    (0, auth_1.OpsOnly)(),
    (0, common_1.Get)('ops/audit'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-G ops-visible audit: refused origins, invalid tokens and allow-list changes (AuditLog resource WidgetRegistration)' }),
    (0, swagger_1.ApiOkResponse)({ description: 'Audit rows, newest first', ...OBJ }),
    __param(0, (0, common_1.Query)('org')),
    __param(1, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], WidgetController.prototype, "opsAudit", null);
__decorate([
    (0, auth_1.OpsOnly)(),
    (0, common_1.Get)('ops/registrations'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-G widget registrations (verified origins per clinic, synced from PROVIDER_PROFILE_UPDATED)' }),
    (0, swagger_1.ApiOkResponse)({ description: 'Registrations', ...OBJ }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], WidgetController.prototype, "opsRegistrations", null);
exports.WidgetController = WidgetController = __decorate([
    (0, swagger_1.ApiTags)('widget'),
    (0, common_1.Controller)('widget/v1'),
    __metadata("design:paramtypes", [control_plane_public_1.FlagsService, widget_registration_service_1.WidgetRegistrationService, widget_audit_service_1.WidgetAuditService, widget_limiter_1.WidgetLimiter,
        widget_policy_service_1.WidgetPolicyService, prisma_service_1.PrismaService, catalog_public_1.CatalogService])
], WidgetController);
//# sourceMappingURL=widget.controller.js.map