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
exports.ProductDecisionRepairJob = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("../../common/config");
const product_decision_service_1 = require("./product-decision.service");
let ProductDecisionRepairJob = class ProductDecisionRepairJob {
    decisions;
    log = new common_1.Logger('product-decision-repair');
    timer;
    constructor(decisions) {
        this.decisions = decisions;
    }
    onModuleInit() {
        if (!(0, config_1.cfg)().jobsEnabled)
            return;
        this.timer = setInterval(() => void this.runOnce().catch((e) => this.log.warn(`product decision repair failed: ${e.message}`)), 15 * 60_000);
        this.timer.unref();
    }
    onModuleDestroy() { if (this.timer)
        clearInterval(this.timer); }
    runOnce(hours = 24) { return this.decisions.repair(new Date(Date.now() - hours * 3600_000)); }
};
exports.ProductDecisionRepairJob = ProductDecisionRepairJob;
exports.ProductDecisionRepairJob = ProductDecisionRepairJob = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [product_decision_service_1.GrowthProductBookingService])
], ProductDecisionRepairJob);
//# sourceMappingURL=product-decision.job.js.map