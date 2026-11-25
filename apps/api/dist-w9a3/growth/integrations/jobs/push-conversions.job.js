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
exports.PushConversionsJob = void 0;
const common_1 = require("@nestjs/common");
const assert_ad_safe_1 = require("../assert-ad-safe");
const integration_service_1 = require("../integration.service");
let PushConversionsJob = class PushConversionsJob {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    async prepare(batch, opts) {
        const safe = [];
        let rejected = 0;
        for (const c of batch) {
            try {
                safe.push((0, assert_ad_safe_1.assertAdSafe)(c, opts));
            }
            catch (e) {
                if (e instanceof assert_ad_safe_1.AdUnsafeError)
                    rejected++;
                else
                    throw e;
            }
        }
        return { safe, rejected };
    }
    async runOnce(kind, market, batch, opts) {
        const s = await this.svc.setting(kind, market);
        const enabled = s.pushConversions === true;
        if (!enabled)
            return { sent: 0, reason: 'DISABLED' };
        const { safe, rejected } = await this.prepare(batch, opts);
        if (s.mode === 'mock')
            return { sent: 0, wouldSend: safe.length, rejected, reason: 'MOCK_SENDS_NOTHING' };
        return { sent: 0, rejected, reason: 'NEEDS_HUMAN' };
    }
};
exports.PushConversionsJob = PushConversionsJob;
exports.PushConversionsJob = PushConversionsJob = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [integration_service_1.IntegrationService])
], PushConversionsJob);
//# sourceMappingURL=push-conversions.job.js.map