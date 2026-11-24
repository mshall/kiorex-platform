"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rDup = void 0;
const wrap_1 = require("./wrap");
exports.rDup = (0, wrap_1.referralRule)('r_dup', 'RF_DUP_ACCOUNT', 'REFERRAL', ['REFERRAL_CLAIM', 'REWARD'], (f, o) => (f.householdDeclared && o.reason === 'phone seen on another account' ? { ...o, strength: 0.25, reason: 'phone shared inside a declared household' } : o));
//# sourceMappingURL=r_dup.js.map