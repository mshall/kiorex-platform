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
exports.SeoAutomationJob = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("../../common/config");
const indexation_service_1 = require("./indexation.service");
const seo_automation_service_1 = require("./seo-automation.service");
const vitals_service_1 = require("./vitals.service");
let SeoAutomationJob = class SeoAutomationJob {
    seo;
    vitals;
    indexation;
    log = new common_1.Logger('seo-automation-job');
    timer;
    last = '';
    constructor(seo, vitals, indexation) {
        this.seo = seo;
        this.vitals = vitals;
        this.indexation = indexation;
    }
    onModuleInit() {
        if (!(0, config_1.cfg)().jobsEnabled)
            return;
        this.timer = setInterval(() => void this.tick().catch((e) => this.log.warn(`seo job failed: ${e.message}`)), 30 * 60_000);
        this.timer.unref();
    }
    onModuleDestroy() { if (this.timer)
        clearInterval(this.timer); }
    async tick(now = new Date()) {
        const day = now.toISOString().slice(0, 10);
        if (now.getUTCHours() < 2 || this.last === day)
            return null;
        this.last = day;
        return this.run(now);
    }
    async run(now = new Date()) {
        const gate = await this.seo.run({ actor: 'system:seo-automation-job' });
        const lab = await this.vitals.ingestLab(undefined, now);
        const field = await this.vitals.ingestField(now);
        const check = await this.vitals.check(now);
        const idx = await this.indexation.snapshot(now);
        return { gate, lab, field, breaches: check.breaches.length, indexation: idx.length };
    }
};
exports.SeoAutomationJob = SeoAutomationJob;
exports.SeoAutomationJob = SeoAutomationJob = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [seo_automation_service_1.SeoAutomationService, vitals_service_1.SeoVitalsService, indexation_service_1.SeoIndexationService])
], SeoAutomationJob);
//# sourceMappingURL=seo-automation.job.js.map