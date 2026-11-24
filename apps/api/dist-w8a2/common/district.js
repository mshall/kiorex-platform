"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeDistrict = normalizeDistrict;
exports.addressForLog = addressForLog;
function normalizeDistrict(v) {
    if (typeof v !== 'string')
        return null;
    const s = v.trim().toLowerCase().replace(/[\s_]+/g, '-');
    return /^[a-z0-9][a-z0-9-]{1,39}$/.test(s) ? s : null;
}
function addressForLog(a) {
    return { district: a?.district ?? null, governorate: a?.governorate ?? null, address: '[masked]' };
}
//# sourceMappingURL=district.js.map