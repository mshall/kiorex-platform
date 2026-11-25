"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultQuiet = void 0;
exports.quietWindow = quietWindow;
exports.quietEnd = quietEnd;
const notify_1 = require("@kiorex/contracts/notify");
const market_core_public_1 = require("../../market/market-core-public");
const defaultQuiet = (market = market_core_public_1.DEFAULT_MARKET) => (0, market_core_public_1.marketQuietHours)(market);
exports.defaultQuiet = defaultQuiet;
const hourOf = (hhmm) => { const h = Number(hhmm.slice(0, 2)); return Number.isInteger(h) && h >= 0 && h <= 23 ? h : 0; };
function quietWindow(policy = (0, exports.defaultQuiet)(), personal) {
    const own = personal && personal.start !== null && personal.end !== null ? personal : null;
    return { startHour: own ? own.start : hourOf(policy.start), endHour: own ? own.end : hourOf(policy.end), tzOffsetMinutes: 0, zone: policy.timezone };
}
function quietEnd(at, q) {
    return (0, notify_1.quietUntil)(at, q, q.zone);
}
//# sourceMappingURL=quiet-hours.js.map