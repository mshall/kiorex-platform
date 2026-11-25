"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.earliestTouchDay = exports.maxWindowDays = exports.MAX_WINDOW_DAYS = exports.DEFAULT_WINDOWS = void 0;
exports.windowDaysFor = windowDaysFor;
exports.checkWindows = checkWindows;
exports.inWindow = inWindow;
const market_day_1 = require("../campaigns/market-day");
exports.DEFAULT_WINDOWS = { webAppDays: 30, campaignDays: 7, providerLinkDays: 30 };
exports.MAX_WINDOW_DAYS = 90;
const PROVIDER_KINDS = new Set(['PROVIDER_LINK', 'PROVIDER_QR', 'WIDGET']);
function windowDaysFor(kind, w = exports.DEFAULT_WINDOWS) {
    if (kind === 'CAMPAIGN')
        return w.campaignDays;
    if (PROVIDER_KINDS.has(kind))
        return w.providerLinkDays;
    return w.webAppDays;
}
const maxWindowDays = (w = exports.DEFAULT_WINDOWS) => Math.max(w.webAppDays, w.campaignDays, w.providerLinkDays);
exports.maxWindowDays = maxWindowDays;
function checkWindows(w) {
    for (const [k, v] of Object.entries(w))
        if (!Number.isInteger(v) || v < 1 || v > exports.MAX_WINDOW_DAYS)
            throw new RangeError(`window ${k} must be an integer from 1 to ${exports.MAX_WINDOW_DAYS}`);
    return w;
}
const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
function inWindow(t, conversionAt, zone, w = exports.DEFAULT_WINDOWS) {
    if (t.at > conversionAt)
        return false;
    return dayDiff((0, market_day_1.localDay)(t.at, zone), (0, market_day_1.localDay)(conversionAt, zone)) <= windowDaysFor(t.kind, w);
}
const earliestTouchDay = (conversionAt, zone, w = exports.DEFAULT_WINDOWS) => (0, market_day_1.addDays)((0, market_day_1.localDay)(conversionAt, zone), -(0, exports.maxWindowDays)(w));
exports.earliestTouchDay = earliestTouchDay;
//# sourceMappingURL=windows.js.map