"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rCollusion = void 0;
const wrap_1 = require("./wrap");
exports.rCollusion = (0, wrap_1.referralRule)('r_collusion', 'RF_PROVIDER_COLLUSION', 'PROVIDER', ['PROVIDER_REVIEW', 'REWARD'], (f, o) => (f.bookedOnBehalfByStaff && o.reason.startsWith('patient phone matches a staff phone') ? { ...o, strength: 0.2, reason: 'staff phone on a booking made on behalf of a patient' } : o));
//# sourceMappingURL=r_collusion.js.map