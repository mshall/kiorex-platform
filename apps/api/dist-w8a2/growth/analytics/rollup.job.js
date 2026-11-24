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
exports.GrowthRollupJob = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("../../common/config");
const rollup_service_1 = require("./rollup.service");
let GrowthRollupJob = class GrowthRollupJob {
    rollup;
    log = new common_1.Logger('growth-rollup-job');
    timer;
    constructor(rollup) {
        this.rollup = rollup;
    }
    onModuleInit() {
        if (!(0, config_1.cfg)().jobsEnabled)
            return;
        this.timer = setInterval(() => void this.runOnce().catch((e) => this.log.warn(`rollup failed: ${e.message}`)), 3600_000);
        this.timer.unref();
    }
    onModuleDestroy() { if (this.timer)
        clearInterval(this.timer); }
    runOnce(days = 3) { return this.rollup.rollup({ days }); }
};
exports.GrowthRollupJob = GrowthRollupJob;
exports.GrowthRollupJob = GrowthRollupJob = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [rollup_service_1.GrowthRollupService])
], GrowthRollupJob);
//# sourceMappingURL=rollup.job.js.map