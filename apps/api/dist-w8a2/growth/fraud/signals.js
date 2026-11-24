"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clamp01 = exports.FRAUD_ACTIONS = exports.CASE_STATUSES = exports.FRAUD_BANDS = exports.FRAUD_SURFACES = exports.FRAUD_CASE_KINDS = exports.FRAUD_RULE_IDS = void 0;
exports.FRAUD_RULE_IDS = ['r_self', 'r_dup', 'r_bot', 'r_farm', 'r_fakebooking', 'r_collusion', 'r_cancel', 'r_redeem', 'r_touch_burst', 'r_widget_abuse', 'r_lt_replay'];
exports.FRAUD_CASE_KINDS = ['REFERRAL', 'REWARD', 'TOUCH', 'WIDGET', 'PROVIDER'];
exports.FRAUD_SURFACES = ['REFERRAL_CLAIM', 'REWARD', 'REFERRAL_ELIGIBILITY', 'WIDGET', 'TOUCH', 'PROVIDER_REVIEW'];
exports.FRAUD_BANDS = ['ALLOW', 'REVIEW', 'HOLD'];
exports.CASE_STATUSES = ['OPEN', 'IN_REVIEW', 'CONFIRMED', 'DISMISSED', 'APPEALED', 'CLOSED'];
exports.FRAUD_ACTIONS = ['NONE', 'OPEN_CASE', 'REJECT_CLAIM', 'HOLD_REWARD', 'SUSPEND_REFERRAL', 'THROTTLE_ORIGIN', 'QUARANTINE_TOUCH', 'OPEN_PROVIDER_REVIEW'];
const clamp01 = (n) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
exports.clamp01 = clamp01;
//# sourceMappingURL=signals.js.map