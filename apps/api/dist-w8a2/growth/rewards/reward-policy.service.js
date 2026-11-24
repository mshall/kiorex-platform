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
exports.RewardPolicyService = void 0;
const common_1 = require("@nestjs/common");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const growth_config_service_1 = require("../config/growth-config.service");
const growth_flags_1 = require("../growth-flags");
const reward_rules_1 = require("./reward-rules");
let RewardPolicyService = class RewardPolicyService {
    config;
    flags;
    constructor(config, flags) {
        this.config = config;
        this.flags = flags;
    }
    async rewardRules(market = growth_flags_1.GROWTH_DEFAULT_MARKET) {
        const r = await this.config.resolve('REWARD_RULES', { market });
        return { rules: (0, reward_rules_1.toRewardRules)(r.payload), versionId: r.versionId, source: r.source };
    }
    async referralRules(market = growth_flags_1.GROWTH_DEFAULT_MARKET) {
        const r = await this.config.resolve('REFERRAL_RULES', { market });
        return { rules: r.payload, versionId: r.versionId };
    }
    on(key, market = growth_flags_1.GROWTH_DEFAULT_MARKET) { return this.flags.isEnabled(key, { market }); }
    rewardsOn(m) { return this.on(growth_flags_1.GROWTH_FLAG.REWARDS, m); }
    referralOn(m) { return this.on(growth_flags_1.GROWTH_FLAG.PATIENT_REFERRAL, m); }
    creditOn(m) { return this.on(growth_flags_1.GROWTH_FLAG.PATIENT_CREDIT, m); }
    familyOn(m) { return this.on(growth_flags_1.GROWTH_FLAG.FAMILY_CREDIT, m); }
    goodwillOn(m) { return this.on(growth_flags_1.GROWTH_FLAG.SUPPORT_GOODWILL, m); }
    fraudEnforced(m) { return this.on(growth_flags_1.GROWTH_FLAG.REFERRAL_FRAUD_ENFORCE, m); }
    async issueMode(rules, m) { return rules.mode === 'CREDIT' && (await this.creditOn(m)) ? 'CREDIT' : 'COUPON'; }
    async refundCreditAvailable(rules, m) {
        const r = rules ?? (await this.rewardRules(m)).rules;
        return r.credit.refundAsCredit.enabled && (await this.creditOn(m)) && (await this.on(growth_flags_1.GROWTH_FLAG.REFUND_AS_CREDIT, m));
    }
    async familyAvailable(rules, m) {
        const r = rules ?? (await this.rewardRules(m)).rules;
        return r.credit.family.enabled && (await this.creditOn(m)) && (await this.familyOn(m));
    }
};
exports.RewardPolicyService = RewardPolicyService;
exports.RewardPolicyService = RewardPolicyService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [growth_config_service_1.GrowthConfigService, control_plane_public_1.FlagsService])
], RewardPolicyService);
//# sourceMappingURL=reward-policy.service.js.map