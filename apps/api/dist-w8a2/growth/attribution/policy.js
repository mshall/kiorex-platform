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
exports.AttributionPolicyResolver = void 0;
exports.toDecisionPolicy = toDecisionPolicy;
const common_1 = require("@nestjs/common");
const growth_config_service_1 = require("../config/growth-config.service");
const growth_defaults_1 = require("../config/growth-defaults");
function toDecisionPolicy(versionId, p) {
    const precedence = p.precedence === 'FIRST_TOUCH' ? 'PROVIDER_FIRST' : p.precedence;
    return { versionId, providerTouchWindowDays: p.providerTouchWindowDays, patientReferralWindowDays: p.patientReferralWindowDays, campaignClickWindowDays: p.campaignClickWindowDays, minDwellMsForProviderTouch: p.minDwellMsForProviderTouch, precedence, allowOfflineEvidence: p.allowOfflineEvidence };
}
let AttributionPolicyResolver = class AttributionPolicyResolver {
    config;
    constructor(config) {
        this.config = config;
    }
    async get(market, at) {
        return (await this.config.resolve('ATTRIBUTION_POLICY', { market, at })).payload ?? growth_defaults_1.GROWTH_DEFAULT_PAYLOADS.ATTRIBUTION_POLICY;
    }
    async decisionPolicy(market, at) {
        const r = await this.config.resolve('ATTRIBUTION_POLICY', { market, at });
        return { policy: toDecisionPolicy(r.versionId, r.payload), versionId: r.versionId, version: r.version, source: r.source, payload: r.payload };
    }
};
exports.AttributionPolicyResolver = AttributionPolicyResolver;
exports.AttributionPolicyResolver = AttributionPolicyResolver = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [growth_config_service_1.GrowthConfigService])
], AttributionPolicyResolver);
//# sourceMappingURL=policy.js.map