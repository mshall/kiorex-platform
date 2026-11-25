"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.marketOffsetMinutes = exports.marketZone = void 0;
exports.zoneOffsetMinutes = zoneOffsetMinutes;
exports.quietWindowEnd = quietWindowEnd;
exports.marketClock = marketClock;
const config_1 = require("./config");
const marketZone = () => process.env.MARKET_TIME_ZONE || 'Africa/Cairo';
exports.marketZone = marketZone;
function zoneOffsetMinutes(timeZone, at, fallbackMinutes) {
    const ms = typeof at === 'number' ? at : at.getTime();
    try {
        const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms));
        const g = (t) => Number(parts.find((p) => p.type === t).value);
        return Math.round((Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(ms / 1000) * 1000) / 60_000);
    }
    catch {
        return fallbackMinutes;
    }
}
const marketOffsetMinutes = (at = Date.now()) => zoneOffsetMinutes((0, exports.marketZone)(), at, (0, config_1.cfg)().tzOffsetHours * 60);
exports.marketOffsetMinutes = marketOffsetMinutes;
function quietWindowEnd(at, startH, endH, zone = (0, exports.marketZone)(), fallbackMinutes = (0, config_1.cfg)().tzOffsetHours * 60) {
    if (startH === endH)
        return null;
    const off = zoneOffsetMinutes(zone, at, fallbackMinutes) * 60_000;
    const local = new Date(at + off);
    const h = local.getUTCHours();
    const inside = startH > endH ? h >= startH || h < endH : h >= startH && h < endH;
    if (!inside)
        return null;
    const endLocal = new Date(local);
    endLocal.setUTCHours(endH, 0, 0, 0);
    if (endLocal.getTime() <= local.getTime())
        endLocal.setUTCDate(endLocal.getUTCDate() + 1);
    let utc = endLocal.getTime() - off;
    for (let i = 0; i < 2; i++)
        utc = endLocal.getTime() - zoneOffsetMinutes(zone, utc, fallbackMinutes) * 60_000;
    return utc;
}
function marketClock(iso, lang, zone = (0, exports.marketZone)()) {
    const d = new Date(iso);
    const day = d.toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: zone });
    const hm = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: zone }).format(d);
    return `${day} ${hm}`;
}
//# sourceMappingURL=market-time.js.map