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
exports.RetentionJob = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("../../common/config");
const growth_maintenance_service_1 = require("../maintenance/growth-maintenance.service");
const policy_1 = require("../attribution/policy");
const growth_flags_1 = require("../growth-flags");
let RetentionJob = class RetentionJob {
    maintenance;
    policies;
    log = new common_1.Logger('growth-retention');
    timer;
    constructor(maintenance, policies) {
        this.maintenance = maintenance;
        this.policies = policies;
    }
    onModuleInit() {
        if (!(0, config_1.cfg)().jobsEnabled)
            return;
        this.timer = setInterval(() => void this.runOnce().catch((e) => this.log.warn(`retention failed: ${e.message}`)), 6 * 3600_000);
        this.timer.unref();
    }
    onModuleDestroy() { if (this.timer)
        clearInterval(this.timer); }
    async runOnce(now = new Date(), market = growth_flags_1.GROWTH_DEFAULT_MARKET) {
        const p = await this.policies.get(market, now);
        return this.maintenance.purgeExpired({ now, linkedMonths: p.touchEvidenceRetentionMonths, unlinkedMonths: p.unlinkedTouchRetentionMonths });
    }
};
exports.RetentionJob = RetentionJob;
exports.RetentionJob = RetentionJob = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [growth_maintenance_service_1.GrowthMaintenanceService, policy_1.AttributionPolicyResolver])
], RetentionJob);
//# sourceMappingURL=retention.job.js.map