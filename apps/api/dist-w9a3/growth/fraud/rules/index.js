"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FRAUD_RULE_BY_ID = exports.FRAUD_RULES_LIST = void 0;
const r_bot_1 = require("./r_bot");
const r_cancel_1 = require("./r_cancel");
const r_collusion_1 = require("./r_collusion");
const r_dup_1 = require("./r_dup");
const r_fakebooking_1 = require("./r_fakebooking");
const r_farm_1 = require("./r_farm");
const r_lt_replay_1 = require("./r_lt_replay");
const r_redeem_1 = require("./r_redeem");
const r_self_1 = require("./r_self");
const r_touch_burst_1 = require("./r_touch_burst");
const r_widget_abuse_1 = require("./r_widget_abuse");
exports.FRAUD_RULES_LIST = [r_self_1.rSelf, r_dup_1.rDup, r_bot_1.rBot, r_farm_1.rFarm, r_fakebooking_1.rFakeBooking, r_collusion_1.rCollusion, r_cancel_1.rCancel, r_redeem_1.rRedeem, r_touch_burst_1.rTouchBurst, r_widget_abuse_1.rWidgetAbuse, r_lt_replay_1.rLtReplay];
exports.FRAUD_RULE_BY_ID = new Map(exports.FRAUD_RULES_LIST.map((r) => [r.id, r]));
//# sourceMappingURL=index.js.map