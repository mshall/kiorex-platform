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
exports.ReferralExpiryJob = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("../../common/config");
const referral_qualification_service_1 = require("./referral-qualification.service");
let ReferralExpiryJob = class ReferralExpiryJob {
    qual;
    log = new common_1.Logger('referral-expiry');
    timer;
    constructor(qual) {
        this.qual = qual;
    }
    onModuleInit() {
        if (!(0, config_1.cfg)().jobsEnabled)
            return;
        this.timer = setInterval(() => void this.run().catch((e) => this.log.warn(`referral job failed: ${e.message}`)), 30 * 60_000);
        this.timer.unref();
    }
    onModuleDestroy() { if (this.timer)
        clearInterval(this.timer); }
    run(now = new Date()) { return this.qual.runDue(now); }
};
exports.ReferralExpiryJob = ReferralExpiryJob;
exports.ReferralExpiryJob = ReferralExpiryJob = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [referral_qualification_service_1.ReferralQualificationService])
], ReferralExpiryJob);
//# sourceMappingURL=referral-expiry.job.js.map