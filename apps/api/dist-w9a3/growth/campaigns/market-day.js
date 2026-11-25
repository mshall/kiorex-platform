"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nextDayBoundary = exports.addDays = exports.marketTimezone = void 0;
exports.localDay = localDay;
exports.startOfLocalDay = startOfLocalDay;
exports.daysBetween = daysBetween;
var market_core_public_1 = require("../../market/market-core-public");
Object.defineProperty(exports, "marketTimezone", { enumerable: true, get: function () { return market_core_public_1.marketTimezone; } });
const fmts = new Map();
const fmt = (zone) => { let f = fmts.get(zone); if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    fmts.set(zone, f);
} return f; };
const parts = (at, zone) => { const p = {}; for (const x of fmt(zone).formatToParts(new Date(at)))
    if (x.type !== 'literal')
        p[x.type] = Number(x.value); return p; };
function localDay(at, zone) {
    const t = typeof at === 'number' ? at : at.getTime();
    const p = parts(t, zone);
    return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}
const offsetMs = (at, zone) => { const p = parts(at, zone); return Date.UTC(p.year, p.month - 1, p.day, p.hour === 24 ? 0 : p.hour, p.minute, p.second) - Math.floor(at / 1000) * 1000; };
function startOfLocalDay(day, zone) {
    const [y, m, d] = day.split('-').map(Number);
    const naive = Date.UTC(y, m - 1, d, 0, 0, 0);
    let utc = naive - offsetMs(naive, zone);
    const again = naive - offsetMs(utc, zone);
    if (again !== utc)
        utc = again;
    return new Date(utc);
}
const addDays = (day, n) => { const t = Date.parse(`${day}T00:00:00Z`) + n * 86_400_000; return new Date(t).toISOString().slice(0, 10); };
exports.addDays = addDays;
const nextDayBoundary = (at, zone) => startOfLocalDay((0, exports.addDays)(localDay(at, zone), 1), zone);
exports.nextDayBoundary = nextDayBoundary;
function daysBetween(a, b, zone) {
    const out = [];
    let d = localDay(a, zone);
    const end = localDay(b, zone);
    for (let i = 0; i < 800 && d <= end; i++) {
        out.push(d);
        d = (0, exports.addDays)(d, 1);
    }
    return out;
}
//# sourceMappingURL=market-day.js.map