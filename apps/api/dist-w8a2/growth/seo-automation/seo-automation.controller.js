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
exports.SeoAutomationController = void 0;
const market_core_public_1 = require("../../market/market-core-public");
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const auth_1 = require("../../common/auth");
const growth_access_1 = require("../admin/growth-access");
const indexation_service_1 = require("./indexation.service");
const seo_automation_service_1 = require("./seo-automation.service");
const vitals_service_1 = require("./vitals.service");
const OBJ = { schema: { type: 'object', additionalProperties: true } };
let SeoAutomationController = class SeoAutomationController {
    seo;
    vitals;
    indexation;
    constructor(seo, vitals, indexation) {
        this.seo = seo;
        this.vitals = vitals;
        this.indexation = indexation;
    }
    overview() { return this.seo.overview(); }
    async reports(templateKind, locale, failed) {
        const rows = (await this.seo.latestReports(market_core_public_1.DEFAULT_MARKET)).filter((r) => (!templateKind || r.templateKind === templateKind) && (!locale || r.locale === locale) && (failed !== 'true' || r.failedChecks.some((c) => !c.startsWith('~'))));
        return { rows: rows.slice(0, 500).map((r) => ({ pageKey: r.pageKey, templateKind: r.templateKind, locale: r.locale, score: r.score, failedChecks: r.failedChecks.filter((c) => !c.startsWith('~')), noindex: r.failedChecks.includes('~noindex'), checkedAt: r.checkedAt })) };
    }
    async config() { const c = await this.seo.config(); return { config: c, editable: false, source: c.version === null ? 'PROPOSED_DEFAULT' : 'ACTIVE' }; }
    async links(from) {
        if (!from)
            return { totals: (await this.seo.overview()).links };
        return { from, groups: await this.seo.computedLinks(market_core_public_1.DEFAULT_MARKET, from, 'en') };
    }
    vitalsOverview() { return this.vitals.overview(); }
    indexationOverview() { return this.indexation.overview(); }
    async run() { const r = await this.seo.run({}); await this.indexation.snapshot(); return r; }
    async ingest(body) {
        const lab = await this.vitals.ingestLab(body?.summary);
        const field = await this.vitals.ingestField();
        return { lab, field, check: await this.vitals.check() };
    }
};
exports.SeoAutomationController = SeoAutomationController;
__decorate([
    (0, common_1.Get)('overview'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-F quality overview by template, worst pages, link counts, orphans' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], SeoAutomationController.prototype, "overview", null);
__decorate([
    (0, common_1.Get)('reports'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-F latest quality reports' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)('templateKind')),
    __param(1, (0, common_1.Query)('locale')),
    __param(2, (0, common_1.Query)('failed')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", Promise)
], SeoAutomationController.prototype, "reports", null);
__decorate([
    (0, common_1.Get)('config'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-F effective SEO_AUTOMATION configuration (read-only)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SeoAutomationController.prototype, "config", null);
__decorate([
    (0, common_1.Get)('links'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-F computed internal links of one page, or the totals' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Query)('from')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], SeoAutomationController.prototype, "links", null);
__decorate([
    (0, common_1.Get)('vitals'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-F lab and field Core Web Vitals by template with budgets (not measured is said plainly)' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], SeoAutomationController.prototype, "vitalsOverview", null);
__decorate([
    (0, common_1.Get)('indexation'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-F submitted, excluded and indexed per template group' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], SeoAutomationController.prototype, "indexationOverview", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manage')),
    (0, common_1.Post)('run'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-F run the quality gate and the link builder now' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SeoAutomationController.prototype, "run", null);
__decorate([
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('manage')),
    (0, common_1.Post)('vitals/ingest'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P3-F ingest the Lighthouse summary (body or file) and the CrUX field rows, then check budgets' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SeoAutomationController.prototype, "ingest", null);
exports.SeoAutomationController = SeoAutomationController = __decorate([
    (0, swagger_1.ApiTags)('growth-seo-automation'),
    (0, auth_1.Roles)(...(0, growth_access_1.rolesFor)('read')),
    (0, common_1.Controller)('admin/growth/seo-automation'),
    __metadata("design:paramtypes", [seo_automation_service_1.SeoAutomationService, vitals_service_1.SeoVitalsService, indexation_service_1.SeoIndexationService])
], SeoAutomationController);
//# sourceMappingURL=seo-automation.controller.js.map