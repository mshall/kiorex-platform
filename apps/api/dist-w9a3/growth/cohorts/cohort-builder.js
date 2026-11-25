"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lastDayOfMonth = exports.dimensionOf = exports.monthStart = exports.addMonths = exports.monthsBetween = exports.monthOf = void 0;
exports.buildCohorts = buildCohorts;
const kanon_1 = require("../analytics/kanon");
const market_day_1 = require("../campaigns/market-day");
const monthOf = (at, zone) => (0, market_day_1.localDay)(at, zone).slice(0, 7);
exports.monthOf = monthOf;
const monthsBetween = (from, to) => (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + (Number(to.slice(5, 7)) - Number(from.slice(5, 7)));
exports.monthsBetween = monthsBetween;
const addMonths = (ym, n) => { const t = Number(ym.slice(0, 4)) * 12 + (Number(ym.slice(5, 7)) - 1) + n; return `${String(Math.floor(t / 12)).padStart(4, '0')}-${String((t % 12) + 1).padStart(2, '0')}`; };
exports.addMonths = addMonths;
const monthStart = (ym) => `${ym}-01`;
exports.monthStart = monthStart;
const slot = (a, i) => { let s = a.byIndex.get(i); if (!s) {
    s = { retained: 0, bookings: 0, revenue: 0, reward: 0 };
    a.byIndex.set(i, s);
} return s; };
function buildCohorts(patients, o) {
    const k = Math.max(10, o.k ?? 10);
    const nowMonth = (0, exports.monthOf)(o.asOf, o.zone);
    const groups = new Map();
    const get = (cohortMonth, dim, value) => { const key = `${cohortMonth}|${dim}|${value}`; let g = groups.get(key); if (!g) {
        g = { cohortMonth, dim, value, acc: { patients: 0, byIndex: new Map() } };
        groups.set(key, g);
    } return g.acc; };
    for (const p of patients) {
        const anchor = o.basis === 'FIRST_COMPLETED' ? p.acquiredAt : (p.registeredAt ?? p.acquiredAt);
        if (anchor === null || anchor === undefined)
            continue;
        const cohortMonth = (0, exports.monthOf)(anchor, o.zone);
        const age = (0, exports.monthsBetween)(cohortMonth, nowMonth);
        if (age < 0)
            continue;
        const dims = [['ALL', ''], ['SOURCE', p.sourceKind]];
        if (p.campaignId)
            dims.push(['CAMPAIGN', p.campaignId]);
        if (p.platform)
            dims.push(['PLATFORM', p.platform]);
        const months = new Map();
        const at = (i) => { let m = months.get(i); if (!m) {
            m = { bookings: 0, revenue: 0, reward: 0 };
            months.set(i, m);
        } return m; };
        for (const v of p.visits) {
            const i = (0, exports.monthsBetween)(cohortMonth, (0, exports.monthOf)(v.at, o.zone));
            if (i >= 0 && i <= age) {
                const m = at(i);
                m.bookings += 1;
                m.revenue += v.revenueMinor;
            }
        }
        for (const r of p.rewards) {
            const i = (0, exports.monthsBetween)(cohortMonth, (0, exports.monthOf)(r.at, o.zone));
            if (i >= 0 && i <= age)
                at(i).reward += r.costMinor;
        }
        for (const [dim, value] of dims) {
            const acc = get(cohortMonth, dim, value);
            acc.patients += 1;
            for (let i = 0; i <= age; i++)
                slot(acc, i);
            for (const [i, m] of months) {
                const s = slot(acc, i);
                if (m.bookings > 0 || (o.basis === 'FIRST_COMPLETED' && i === 0))
                    s.retained += 1;
                s.bookings += m.bookings;
                s.revenue += m.revenue;
                s.reward += m.reward;
            }
        }
    }
    const suppressedKey = new Set();
    const byMonth = new Map();
    for (const g of groups.values())
        if (g.dim === 'SOURCE') {
            const l = byMonth.get(g.cohortMonth) ?? [];
            l.push({ key: g.value, count: g.acc.patients });
            byMonth.set(g.cohortMonth, l);
        }
    for (const [m, cells] of byMonth)
        for (const c of (0, kanon_1.applyKAnonymity)(cells))
            if (c.masked)
                suppressedKey.add(`${m}|SOURCE|${c.key}`);
    const out = [];
    for (const g of groups.values()) {
        const key = `${g.cohortMonth}|${g.dim}|${g.value}`;
        const base = { cohortMonth: (0, exports.monthStart)(g.cohortMonth), basis: o.basis, sourceKind: g.dim === 'SOURCE' ? g.value : '', campaignId: g.dim === 'CAMPAIGN' ? g.value : '', platform: g.dim === 'PLATFORM' ? g.value : '', k };
        if (g.acc.patients < k || suppressedKey.has(key)) {
            out.push({ ...base, monthIndex: 0, patients: 0, retainedPatients: 0, completedBookings: 0, revenueMinor: 0, rewardCostMinor: 0, suppressed: true });
            continue;
        }
        for (const [i, s] of [...g.acc.byIndex].sort((a, b) => a[0] - b[0]))
            out.push({ ...base, monthIndex: i, patients: g.acc.patients, retainedPatients: s.retained, completedBookings: s.bookings, revenueMinor: s.revenue, rewardCostMinor: s.reward, suppressed: false });
    }
    return out.sort((a, b) => a.cohortMonth.localeCompare(b.cohortMonth) || a.sourceKind.localeCompare(b.sourceKind) || a.campaignId.localeCompare(b.campaignId) || a.platform.localeCompare(b.platform) || a.monthIndex - b.monthIndex);
}
const dimensionOf = (c) => (c.sourceKind ? 'SOURCE' : c.campaignId ? 'CAMPAIGN' : c.platform ? 'PLATFORM' : 'ALL');
exports.dimensionOf = dimensionOf;
const lastDayOfMonth = (ym) => (0, market_day_1.addDays)(`${(0, exports.addMonths)(ym, 1)}-01`, -1);
exports.lastDayOfMonth = lastDayOfMonth;
//# sourceMappingURL=cohort-builder.js.map