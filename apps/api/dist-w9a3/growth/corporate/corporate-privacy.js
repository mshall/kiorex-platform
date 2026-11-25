"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.looksPersonal = exports.maskTotal = exports.maskCount = exports.effectiveK = exports.K_FLOOR = void 0;
exports.maskBreakdown = maskBreakdown;
const kanon_1 = require("../analytics/kanon");
exports.K_FLOOR = kanon_1.K_MIN;
const effectiveK = (configured) => Math.max(exports.K_FLOOR, Number.isInteger(configured) ? configured : exports.K_FLOOR);
exports.effectiveK = effectiveK;
const maskCount = (n, k = exports.K_FLOOR) => (n === 0 || n >= (0, exports.effectiveK)(k) ? n : null);
exports.maskCount = maskCount;
function maskBreakdown(cells, k = exports.K_FLOOR) {
    const kk = (0, exports.effectiveK)(k);
    const out = {};
    const keys = Object.keys(cells);
    for (const key of keys)
        out[key] = cells[key] === 0 || cells[key] >= kk ? cells[key] : null;
    const hidden = keys.filter((x) => out[x] === null && cells[x] > 0);
    const visible = keys.filter((x) => out[x] !== null && cells[x] > 0).sort((a, b) => (cells[a] - cells[b]));
    if (hidden.length === 1 && visible.length)
        out[visible[0]] = null;
    return out;
}
const maskTotal = (total, group, k = exports.K_FLOOR) => (group === 0 || group >= (0, exports.effectiveK)(k) ? total : null);
exports.maskTotal = maskTotal;
const PERSONAL = [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, /(?:\+|00)?\d[\d\s().-]{8,}\d/, /\b[23]\d{13}\b/];
const looksPersonal = (text) => PERSONAL.some((re) => re.test(text.normalize('NFKC').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))));
exports.looksPersonal = looksPersonal;
//# sourceMappingURL=corporate-privacy.js.map