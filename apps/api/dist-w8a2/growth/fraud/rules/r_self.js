"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rSelf = void 0;
const wrap_1 = require("./wrap");
exports.rSelf = (0, wrap_1.referralRule)('r_self', 'RF_SELF', 'REFERRAL', ['REFERRAL_CLAIM', 'REFERRAL_ELIGIBILITY', 'REWARD'], (f, o) => {
    const phoneOnly = o.reason === 'same phone';
    return f.householdDeclared && phoneOnly ? { ...o, strength: 0.25, reason: 'same phone inside a declared household' } : o;
});
//# sourceMappingURL=r_self.js.map