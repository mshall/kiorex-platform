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
exports.ControlPlaneController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const auth_1 = require("../common/auth");
const errors_1 = require("../common/errors");
const flag_catalogue_1 = require("./flag-catalogue");
const flags_service_1 = require("./flags.service");
const product_key_guard_1 = require("./product-key.guard");
const control_plane_dto_1 = require("./control-plane.dto");
class SetFlagBody {
    scope;
    scopeId;
    value;
    reason;
    ticket;
    expiresAt;
    startsAt;
    emergency;
}
__decorate([
    (0, class_validator_1.IsIn)(['GLOBAL', 'MARKET', 'ORG']),
    __metadata("design:type", String)
], SetFlagBody.prototype, "scope", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SetFlagBody.prototype, "scopeId", void 0);
__decorate([
    (0, class_validator_1.IsIn)(['ON', 'OFF']),
    __metadata("design:type", String)
], SetFlagBody.prototype, "value", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], SetFlagBody.prototype, "reason", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], SetFlagBody.prototype, "ticket", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], SetFlagBody.prototype, "expiresAt", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], SetFlagBody.prototype, "startsAt", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], SetFlagBody.prototype, "emergency", void 0);
class GateBody {
    gateId;
    approver;
    approvedOn;
    documentUrl;
}
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], GateBody.prototype, "gateId", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], GateBody.prototype, "approver", void 0);
__decorate([
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], GateBody.prototype, "approvedOn", void 0);
__decorate([
    (0, class_validator_1.IsUrl)({ require_tld: false }),
    __metadata("design:type", String)
], GateBody.prototype, "documentUrl", void 0);
class DefinitionBody {
    key;
    product;
    class;
    scopes;
    dependsOn;
    description;
    whenOff;
    moneyPath;
}
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], DefinitionBody.prototype, "key", void 0);
__decorate([
    (0, class_validator_1.IsIn)(['kiorly-clinic', 'kiorly-nurse', 'kiorex', 'kiorex-account', 'kiorly-pharmacy', 'kiorly-lab', 'all']),
    __metadata("design:type", Object)
], DefinitionBody.prototype, "product", void 0);
__decorate([
    (0, class_validator_1.IsIn)(['MODULE', 'COMMERCIAL', 'INTEGRATION', 'AI', 'LAUNCH_LOCKED']),
    __metadata("design:type", Object)
], DefinitionBody.prototype, "class", void 0);
__decorate([
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], DefinitionBody.prototype, "scopes", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], DefinitionBody.prototype, "dependsOn", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], DefinitionBody.prototype, "description", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], DefinitionBody.prototype, "whenOff", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], DefinitionBody.prototype, "moneyPath", void 0);
class ReasonBody {
    reason;
    gateId;
}
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ReasonBody.prototype, "reason", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ReasonBody.prototype, "gateId", void 0);
class GateAllBody {
    approver;
    approvedOn;
    documentUrl;
}
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], GateAllBody.prototype, "approver", void 0);
__decorate([
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], GateAllBody.prototype, "approvedOn", void 0);
__decorate([
    (0, class_validator_1.IsUrl)({ require_tld: false }),
    __metadata("design:type", String)
], GateAllBody.prototype, "documentUrl", void 0);
class ProductBody {
    webhookUrl;
    active;
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUrl)({ require_tld: false }),
    __metadata("design:type", String)
], ProductBody.prototype, "webhookUrl", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], ProductBody.prototype, "active", void 0);
let ControlPlaneController = class ControlPlaneController {
    flags;
    constructor(flags) {
        this.flags = flags;
    }
    async snapshot(product, req, inm, res) {
        if (!product)
            throw (0, errors_1.badRequest)('PRODUCT_REQUIRED', 'product query param required');
        if (req.product !== product)
            throw (0, errors_1.forbidden)('PRODUCT_KEY_MISMATCH', 'Key does not belong to that product');
        const snap = await this.flags.snapshot(product, { touch: true });
        res.setHeader('ETag', snap.etag);
        res.setHeader('Cache-Control', 'no-cache');
        if (inm && inm === snap.etag) {
            res.status(304);
            return;
        }
        return snap.body;
    }
    async effective(market = 'EG') {
        const out = {};
        for (const f of flag_catalogue_1.FLAG_CATALOGUE.filter((x) => x.product === 'kiorex')) {
            const r = await this.flags.evaluate(f.key, { market });
            out[f.key] = { enabled: r.effective, reason: r.reason, scope: r.scope };
        }
        return { market: market.toUpperCase(), version: await this.flags.currentVersion(), flags: out };
    }
    list(market, product) {
        return this.flags.listAdmin({ market, product });
    }
    set(u, key, b) {
        return this.flags.setValue(u.sub, { key, scope: b.scope, scopeId: b.scopeId, value: b.value, reason: b.reason, ticket: b.ticket, expiresAt: b.expiresAt ? new Date(b.expiresAt) : null, startsAt: b.startsAt ? new Date(b.startsAt) : null, emergency: b.emergency });
    }
    gate(u, key, b) {
        return this.flags.recordGate(u.sub, key, { ...b, approvedOn: new Date(b.approvedOn) });
    }
    gates() {
        return this.flags.gateBoard();
    }
    gateAll(u, gateId, b) {
        return this.flags.recordGateForAll(u.sub, gateId, { ...b, approvedOn: new Date(b.approvedOn) });
    }
    revokeGate(u, key, b) {
        return this.flags.revokeGate(u.sub, key, b.reason, b.gateId);
    }
    define(u, b) {
        return this.flags.registerDefinition(u.sub, { ...b, dependsOn: b.dependsOn ?? [], whenOff: b.whenOff ?? '', launchLocked: b.class === 'LAUNCH_LOCKED' });
    }
    requests(status) {
        return this.flags.listRequests(status);
    }
    approve(u, id) {
        return this.flags.approveRequest(u.sub, id);
    }
    reject(u, id) {
        return this.flags.rejectRequest(u.sub, id);
    }
    review(u, id) {
        return this.flags.reviewEmergency(u.sub, id);
    }
    overdue() {
        return this.flags.overdueEmergencyReviews();
    }
    async audit(flagKey, from, to, format, res) {
        const rows = await this.flags.auditQuery({ flagKey, from: from ? new Date(from) : undefined, to: to ? new Date(to) : undefined });
        if (format === 'csv') {
            res.setHeader('content-type', 'text/csv; charset=utf-8');
            res.setHeader('content-disposition', 'attachment; filename="flag-audit.csv"');
            return this.flags.toCsv(rows);
        }
        return rows;
    }
    propagation() {
        return this.flags.propagation();
    }
    async product(product, b) {
        const data = {};
        if (b.webhookUrl !== undefined)
            data.webhookUrl = b.webhookUrl;
        if (b.active !== undefined)
            data.active = b.active;
        return this.flags['prisma'].productRegistration.update({ where: { product }, data, select: { product: true, webhookUrl: true, active: true } });
    }
    sweep() {
        return this.flags.sweep();
    }
};
exports.ControlPlaneController = ControlPlaneController;
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: control_plane_dto_1.FlagSnapshotDto }),
    (0, auth_1.Public)(),
    (0, common_1.UseGuards)(product_key_guard_1.ProductKeyGuard),
    (0, common_1.Get)('control/v1/flags/snapshot'),
    (0, swagger_1.ApiOperation)({ summary: 'Signed flag snapshot per product (ETag, poll every 30 s)' }),
    (0, swagger_1.ApiQuery)({ name: 'product', required: true }),
    (0, swagger_1.ApiHeader)({ name: 'X-Kiorex-Product-Key', required: true }),
    (0, swagger_1.ApiHeader)({ name: 'If-None-Match', required: false }),
    __param(0, (0, common_1.Query)('product')),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Headers)('if-none-match')),
    __param(3, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], ControlPlaneController.prototype, "snapshot", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: control_plane_dto_1.EffectiveFlagsDto }),
    (0, auth_1.Public)(),
    (0, common_1.Get)('flags/effective'),
    (0, swagger_1.ApiOperation)({ summary: 'Effective state of every Kiorex flag (for web/mobile to hide entry points)' }),
    __param(0, (0, common_1.Query)('market')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ControlPlaneController.prototype, "effective", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: control_plane_dto_1.AdminFlagDto, isArray: true }),
    (0, auth_1.OpsOnly)(),
    (0, common_1.Get)('admin/flags'),
    (0, swagger_1.ApiOperation)({ summary: 'Every flag of every product with effective value, source, class, deps, last change (OP-07)' }),
    __param(0, (0, common_1.Query)('market')),
    __param(1, (0, common_1.Query)('product')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], ControlPlaneController.prototype, "list", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: control_plane_dto_1.SetFlagResultDto }),
    (0, auth_1.SuperAdminOnly)(),
    (0, common_1.Put)('admin/flags/:key/values'),
    (0, swagger_1.ApiOperation)({ summary: 'Toggle OFF/ON at global/market/org scope; reason+ticket required; optional expiry/schedule; two-person rule for money-path (OP-08/10)' }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('key')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, SetFlagBody]),
    __metadata("design:returntype", void 0)
], ControlPlaneController.prototype, "set", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: control_plane_dto_1.VersionDto }),
    (0, auth_1.SuperAdminOnly)(),
    (0, common_1.Put)('admin/flags/:key/gate'),
    (0, swagger_1.ApiOperation)({ summary: 'Record launch gate evidence (OP-09). STOP flag: only a human may call this.' }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('key')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, GateBody]),
    __metadata("design:returntype", void 0)
], ControlPlaneController.prototype, "gate", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: control_plane_dto_1.GateBoardDto }),
    (0, auth_1.OpsOnly)(),
    (0, common_1.Get)('admin/gates'),
    (0, swagger_1.ApiOperation)({ summary: 'Launch-gate board: every gate id (GHV1, GHV2, GPR1, GKN1, GKN2 ...), the flags it unlocks and the human-recorded evidence per flag' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ControlPlaneController.prototype, "gates", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: control_plane_dto_1.GateRecordedDto }),
    (0, auth_1.SuperAdminOnly)(),
    (0, common_1.Put)('admin/gates/:gateId'),
    (0, swagger_1.ApiOperation)({ summary: 'Record ONE gate for every launch-locked flag that lists it (e.g. GHV1 -> clinic.home_visits + kiorex.home_visits). STOP action: only a human calls this; one audited evidence row per flag.' }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('gateId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, GateAllBody]),
    __metadata("design:returntype", void 0)
], ControlPlaneController.prototype, "gateAll", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: control_plane_dto_1.VersionDto }),
    (0, auth_1.SuperAdminOnly)(),
    (0, common_1.Post)('admin/flags/:key/gate/revoke'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('key')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, ReasonBody]),
    __metadata("design:returntype", void 0)
], ControlPlaneController.prototype, "revokeGate", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: control_plane_dto_1.FlagDefinitionDto }),
    (0, auth_1.SuperAdminOnly)(),
    (0, common_1.Post)('admin/flags/definitions'),
    (0, swagger_1.ApiOperation)({ summary: 'Register a flag definition (e.g. market.<cc>.live). Safety controls are refused (ADR-025).' }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, DefinitionBody]),
    __metadata("design:returntype", void 0)
], ControlPlaneController.prototype, "define", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: control_plane_dto_1.FlagChangeRequestDto, isArray: true }),
    (0, auth_1.OpsOnly)(),
    (0, common_1.Get)('admin/flags/requests'),
    __param(0, (0, common_1.Query)('status')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ControlPlaneController.prototype, "requests", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: control_plane_dto_1.RequestDecisionDto }),
    (0, auth_1.SuperAdminOnly)(),
    (0, common_1.Post)('admin/flags/requests/:id/approve'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ControlPlaneController.prototype, "approve", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: control_plane_dto_1.RequestDecisionDto }),
    (0, auth_1.SuperAdminOnly)(),
    (0, common_1.Post)('admin/flags/requests/:id/reject'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ControlPlaneController.prototype, "reject", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: control_plane_dto_1.RequestDecisionDto }),
    (0, auth_1.SuperAdminOnly)(),
    (0, common_1.Post)('admin/flags/requests/:id/review'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ControlPlaneController.prototype, "review", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: control_plane_dto_1.FlagChangeRequestDto, isArray: true }),
    (0, auth_1.OpsOnly)(),
    (0, common_1.Get)('admin/flags/emergency-reviews/overdue'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ControlPlaneController.prototype, "overdue", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: control_plane_dto_1.FlagAuditDto, isArray: true }),
    (0, auth_1.OpsOnly)(),
    (0, common_1.Get)('admin/flags/audit'),
    (0, swagger_1.ApiOperation)({ summary: 'Flag audit trail; ?format=csv exports (OP-11)' }),
    __param(0, (0, common_1.Query)('flagKey')),
    __param(1, (0, common_1.Query)('from')),
    __param(2, (0, common_1.Query)('to')),
    __param(3, (0, common_1.Query)('format')),
    __param(4, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, Object]),
    __metadata("design:returntype", Promise)
], ControlPlaneController.prototype, "audit", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: control_plane_dto_1.PropagationDto }),
    (0, auth_1.OpsOnly)(),
    (0, common_1.Get)('admin/flags/propagation'),
    (0, swagger_1.ApiOperation)({ summary: 'Snapshot version and age per product (OP-11)' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ControlPlaneController.prototype, "propagation", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: control_plane_dto_1.ProductRegistrationDto }),
    (0, auth_1.SuperAdminOnly)(),
    (0, common_1.Put)('admin/flags/products/:product'),
    __param(0, (0, common_1.Param)('product')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, ProductBody]),
    __metadata("design:returntype", Promise)
], ControlPlaneController.prototype, "product", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: control_plane_dto_1.SweepResultDto }),
    (0, auth_1.SuperAdminOnly)(),
    (0, common_1.Post)('admin/flags/sweep'),
    (0, common_1.HttpCode)(200),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ControlPlaneController.prototype, "sweep", null);
exports.ControlPlaneController = ControlPlaneController = __decorate([
    (0, swagger_1.ApiTags)('control-plane'),
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [flags_service_1.FlagsService])
], ControlPlaneController);
//# sourceMappingURL=control-plane.controller.js.map