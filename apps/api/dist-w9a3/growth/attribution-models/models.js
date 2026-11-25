"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UNATTRIBUTED_TOUCH = exports.DEFAULT_MODEL_OPTIONS = exports.PATH_MODELS = exports.DEFAULT_MODEL = exports.ATTRIBUTION_MODELS = exports.ONE_MILLION = void 0;
exports.apportion = apportion;
exports.creditPath = creditPath;
exports.ONE_MILLION = 1_000_000;
exports.ATTRIBUTION_MODELS = ['LAST_TOUCH', 'LAST_NON_DIRECT', 'FIRST_TOUCH', 'LINEAR', 'TIME_DECAY', 'POSITION_BASED', 'DATA_DRIVEN'];
exports.DEFAULT_MODEL = 'POSITION_BASED';
exports.PATH_MODELS = exports.ATTRIBUTION_MODELS.filter((m) => m !== 'DATA_DRIVEN');
exports.DEFAULT_MODEL_OPTIONS = { halfLifeDays: 7, positionFirstBp: 4000, positionLastBp: 4000 };
function apportion(total, weights) {
    const n = weights.length;
    if (n === 0)
        return [];
    if (!Number.isInteger(total) || total < 0)
        throw new RangeError('total must be a non-negative integer');
    const sum = weights.reduce((a, b) => a + (b > 0 ? b : 0), 0);
    if (sum <= 0) {
        const out = new Array(n).fill(0);
        out[n - 1] = total;
        return out;
    }
    const exact = weights.map((w) => (w > 0 ? (w / sum) * total : 0));
    const floor = exact.map((x) => Math.floor(x));
    let rest = total - floor.reduce((a, b) => a + b, 0);
    const order = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r || a.i - b.i);
    for (let k = 0; rest > 0 && k < order.length; k++, rest--)
        floor[order[k].i] += 1;
    if (rest < 0) {
        const j = floor.indexOf(Math.max(...floor));
        floor[j] += rest;
    }
    return floor;
}
const isDirect = (t) => t.kind === 'DIRECT';
function creditPath(model, path, conversionAt, opts = exports.DEFAULT_MODEL_OPTIONS) {
    const n = path.length;
    if (n === 0)
        return [];
    const only = (i) => { const w = new Array(n).fill(0); w[i] = exports.ONE_MILLION; return w; };
    switch (model) {
        case 'LAST_TOUCH': return only(n - 1);
        case 'FIRST_TOUCH': return only(0);
        case 'LAST_NON_DIRECT': {
            for (let i = n - 1; i >= 0; i--)
                if (!isDirect(path[i]))
                    return only(i);
            return only(n - 1);
        }
        case 'LINEAR': return apportion(exports.ONE_MILLION, new Array(n).fill(1));
        case 'TIME_DECAY': {
            const hl = Math.max(0.01, opts.halfLifeDays) * 86_400_000;
            return apportion(exports.ONE_MILLION, path.map((t) => Math.pow(2, -Math.max(0, conversionAt - t.at) / hl)));
        }
        case 'POSITION_BASED': {
            if (n === 1)
                return only(0);
            if (n === 2)
                return [exports.ONE_MILLION / 2, exports.ONE_MILLION / 2];
            const first = Math.round((opts.positionFirstBp / 10_000) * exports.ONE_MILLION);
            const last = Math.round((opts.positionLastBp / 10_000) * exports.ONE_MILLION);
            const mid = exports.ONE_MILLION - first - last;
            if (mid < 0)
                throw new RangeError('first plus last share exceeds 100 percent');
            const middle = apportion(mid, new Array(n - 2).fill(1));
            return [first, ...middle, last];
        }
    }
}
const UNATTRIBUTED_TOUCH = (at) => ({ at, kind: 'UNATTRIBUTED', ref: '', campaignId: '' });
exports.UNATTRIBUTED_TOUCH = UNATTRIBUTED_TOUCH;
//# sourceMappingURL=models.js.map