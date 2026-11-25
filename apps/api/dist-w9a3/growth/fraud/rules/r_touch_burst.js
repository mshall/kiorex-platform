"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rTouchBurst = void 0;
const signals_1 = require("../signals");
exports.rTouchBurst = {
    id: 'r_touch_burst', kind: 'TOUCH', surfaces: ['TOUCH'],
    evaluate(f, t) {
        const limit = f.touchBurstLimit ?? t.touchBurstPerMinute;
        const burst = f.touchBurstPerMinute !== undefined && f.touchBurstPerMinute > limit;
        if (!burst && !f.clickWithoutRender)
            return null;
        const strength = burst ? (0, signals_1.clamp01)(0.6 + ((f.touchBurstPerMinute - limit) / (limit * 4))) : 0.5;
        return { strength, reason: burst ? 'more touches per minute than a person produces' : 'click without a rendered page', evidence: [burst ? 'burst-per-ip-hash' : 'click-without-render'] };
    },
};
//# sourceMappingURL=r_touch_burst.js.map