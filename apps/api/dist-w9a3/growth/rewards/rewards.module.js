"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RewardsModule = void 0;
const common_1 = require("@nestjs/common");
const growth_ports_public_1 = require("../growth-ports-public");
const goodwill_service_1 = require("./goodwill.service");
const reward_events_service_1 = require("./reward-events.service");
const reward_expiry_job_1 = require("./reward-expiry.job");
const reward_finance_service_1 = require("./reward-finance.service");
const reward_hold_service_1 = require("./reward-hold.service");
const reward_household_service_1 = require("./reward-household.service");
const reward_issuance_service_1 = require("./reward-issuance.service");
const reward_ledger_service_1 = require("./reward-ledger.service");
const reward_policy_service_1 = require("./reward-policy.service");
const reward_reconcile_job_1 = require("./reward-reconcile.job");
const reward_redemption_service_1 = require("./reward-redemption.service");
const reward_reversal_service_1 = require("./reward-reversal.service");
const rewards_admin_controller_1 = require("./rewards-admin.controller");
const rewards_controller_1 = require("./rewards.controller");
const rewards_port_service_1 = require("./rewards-port.service");
const rewards_query_service_1 = require("./rewards-query.service");
let RewardsModule = class RewardsModule {
};
exports.RewardsModule = RewardsModule;
exports.RewardsModule = RewardsModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        controllers: [rewards_controller_1.RewardsController, rewards_admin_controller_1.RewardsAdminController],
        providers: [
            reward_events_service_1.RewardEventsService, reward_policy_service_1.RewardPolicyService, reward_ledger_service_1.RewardLedgerService, reward_issuance_service_1.RewardIssuanceService, reward_redemption_service_1.RewardRedemptionService, reward_reversal_service_1.RewardReversalService, reward_hold_service_1.RewardHoldService, reward_household_service_1.RewardHouseholdService, goodwill_service_1.GoodwillService, reward_finance_service_1.RewardFinanceService,
            reward_reconcile_job_1.RewardReconcileJob, reward_expiry_job_1.RewardExpiryJob, rewards_query_service_1.RewardsQueryService, rewards_port_service_1.RewardsPortService, { provide: growth_ports_public_1.REWARDS_PORT, useExisting: rewards_port_service_1.RewardsPortService },
        ],
        exports: [growth_ports_public_1.REWARDS_PORT, reward_policy_service_1.RewardPolicyService, reward_issuance_service_1.RewardIssuanceService, reward_redemption_service_1.RewardRedemptionService, reward_reversal_service_1.RewardReversalService, reward_hold_service_1.RewardHoldService, reward_ledger_service_1.RewardLedgerService, reward_events_service_1.RewardEventsService, reward_expiry_job_1.RewardExpiryJob, reward_reconcile_job_1.RewardReconcileJob, reward_finance_service_1.RewardFinanceService, goodwill_service_1.GoodwillService, reward_household_service_1.RewardHouseholdService],
    })
], RewardsModule);
//# sourceMappingURL=rewards.module.js.map