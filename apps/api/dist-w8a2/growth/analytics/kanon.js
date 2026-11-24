"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.maskCount = exports.MASK = exports.K_MIN = void 0;
exports.applyKAnonymity = applyKAnonymity;
exports.maskTotal = maskTotal;
exports.K_MIN = 10;
exports.MASK = '<10';
const maskCount = (n) => (n > 0 && n < exports.K_MIN ? exports.MASK : n);
exports.maskCount = maskCount;
function applyKAnonymity(cells, opts = {}) {
    const hide = new Set(cells.filter((c) => c.count > 0 && c.count < exports.K_MIN).map((c) => c.key));
    if (opts.totalShown !== false && hide.size === 1) {
        const visible = cells.filter((c) => !hide.has(c.key) && c.count > 0).sort((a, b) => a.count - b.count || (a.key < b.key ? -1 : 1));
        if (visible[0])
            hide.add(visible[0].key);
    }
    return cells.map((c) => {
        const masked = hide.has(c.key);
        return { key: c.key, count: masked ? exports.MASK : c.count, masked, values: Object.fromEntries(Object.entries(c.values ?? {}).map(([k, v]) => [k, masked ? exports.MASK : v])) };
    });
}
function maskTotal(count, values = {}) {
    const masked = count > 0 && count < exports.K_MIN;
    return { count: masked ? exports.MASK : count, masked, values: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v === null ? null : masked ? exports.MASK : v])) };
}
//# sourceMappingURL=kanon.js.map