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
exports.LifecyclePolicyService = void 0;
const market_core_public_1 = require("../../market/market-core-public");
const common_1 = require("@nestjs/common");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const growth_config_service_1 = require("../config/growth-config.service");
const growth_flags_1 = require("../growth-flags");
const journeys_1 = require("./journeys");
const frequency_cap_1 = require("./frequency-cap");
const quiet_hours_1 = require("./quiet-hours");
let LifecyclePolicyService = class LifecyclePolicyService {
    config;
    flags;
    constructor(config, flags) {
        this.config = config;
        this.flags = flags;
    }
    async resolve(market = market_core_public_1.DEFAULT_MARKET) {
        const r = await this.config.resolve('LIFECYCLE_POLICY', { market });
        const p = r.payload;
        const dq = (0, quiet_hours_1.defaultQuiet)(market);
        const q = r.source === 'PROPOSED_DEFAULT' ? {} : (p.quietHours ?? {});
        return {
            versionId: r.versionId, version: r.version, source: r.source,
            caps: { perDay: p.frequencyCaps?.marketingPerDay ?? 1, perWeek: p.frequencyCaps?.marketingPerWeek ?? 3 },
            quiet: { start: q.start ?? dq.start, end: q.end ?? dq.end, timezone: q.timezone ?? dq.timezone },
            holdoutBps: Math.max(0, Math.min(2000, p.holdoutBps ?? 0)),
            journeys: Object.fromEntries(Object.entries(p.journeys ?? {}).map(([k, v]) => [k, { enabled: v.enabled !== false, maxSteps: v.maxSteps }])),
        };
    }
    capsFor(policy, centre) { return (0, frequency_cap_1.stricterCaps)(policy.caps, centre); }
    journeyPolicy(policy, def) {
        const j = policy.journeys[def.key];
        return { enabled: j ? j.enabled : true, messageClass: def.steps[0].messageClass, maxSteps: j?.maxSteps };
    }
    journeysOn(market = market_core_public_1.DEFAULT_MARKET) { return this.flags.isEnabled(growth_flags_1.GROWTH_FLAG.LIFECYCLE_JOURNEYS, { market }).catch(() => false); }
    marketingOn(market = market_core_public_1.DEFAULT_MARKET) { return this.flags.isEnabled(growth_flags_1.GROWTH_FLAG.MARKETING_MESSAGING, { market }).catch(() => false); }
    catalogue() { return journeys_1.JOURNEYS; }
};
exports.LifecyclePolicyService = LifecyclePolicyService;
exports.LifecyclePolicyService = LifecyclePolicyService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [growth_config_service_1.GrowthConfigService, control_plane_public_1.FlagsService])
], LifecyclePolicyService);
//# sourceMappingURL=lifecycle-policy.service.js.map