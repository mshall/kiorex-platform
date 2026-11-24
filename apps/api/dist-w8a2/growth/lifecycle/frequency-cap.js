"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withinWindowBudget = exports.stricterCaps = exports.DAY_MS = void 0;
exports.capCounts = capCounts;
exports.inHoldout = inHoldout;
const node_crypto_1 = require("node:crypto");
exports.DAY_MS = 86_400_000;
function capCounts(sentAt, now) {
    let day = 0;
    let week = 0;
    for (const d of sentAt) {
        const age = now - d.getTime();
        if (age < 0)
            continue;
        if (age < exports.DAY_MS)
            day++;
        if (age < 7 * exports.DAY_MS)
            week++;
    }
    return { day, week };
}
const stricterCaps = (a, b) => ({ perDay: Math.min(a.perDay, b.perDay), perWeek: Math.min(a.perWeek, b.perWeek) });
exports.stricterCaps = stricterCaps;
const withinWindowBudget = (sentAt, now, max, windowDays) => sentAt.filter((d) => now - d.getTime() >= 0 && now - d.getTime() < windowDays * exports.DAY_MS).length < max;
exports.withinWindowBudget = withinWindowBudget;
function inHoldout(sub, journeyKey, holdoutBps, salt = 'kx-lifecycle-holdout') {
    if (!(holdoutBps > 0))
        return false;
    const h = (0, node_crypto_1.createHmac)('sha256', salt).update(`${journeyKey}:${sub}`).digest();
    return h.readUInt32BE(0) % 10_000 < Math.min(holdoutBps, 10_000);
}
//# sourceMappingURL=frequency-cap.js.map