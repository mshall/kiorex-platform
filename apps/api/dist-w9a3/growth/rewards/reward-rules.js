"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_ACTIVE_LOTS = exports.RECOVERABLE_LOSS_BLOCK_DAYS = void 0;
exports.toRewardRules = toRewardRules;
const growth_defaults_1 = require("../config/growth-defaults");
exports.RECOVERABLE_LOSS_BLOCK_DAYS = 90;
exports.MAX_ACTIVE_LOTS = 50;
function toRewardRules(payload) {
    const d = growth_defaults_1.GROWTH_DEFAULT_PAYLOADS.REWARD_RULES;
    const p = (payload ?? {});
    return {
        ...d, ...p,
        amounts: { ...d.amounts, ...(p.amounts ?? {}) },
        credit: {
            ...d.credit, ...(p.credit ?? {}),
            refundAsCredit: { ...d.credit.refundAsCredit, ...(p.credit?.refundAsCredit ?? {}) },
            family: { ...d.credit.family, ...(p.credit?.family ?? {}) },
            goodwill: { ...d.credit.goodwill, ...(p.credit?.goodwill ?? {}) },
            campaignScope: { ...d.credit.campaignScope, ...(p.credit?.campaignScope ?? {}) },
        },
    };
}
//# sourceMappingURL=reward-rules.js.map