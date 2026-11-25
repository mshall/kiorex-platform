"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GrowthMetricsService = exports.FILTER_KEYS = void 0;
exports.parseFilters = parseFilters;
const common_1 = require("@nestjs/common");
const client_1 = require("../../prisma/generated/client");
const prisma_service_1 = require("../../prisma/prisma.service");
const growth_flags_1 = require("../growth-flags");
const growth_errors_1 = require("../growth-errors");
const formulas_1 = require("./formulas");
const kanon_1 = require("./kanon");
const rollup_service_1 = require("./rollup.service");
exports.FILTER_KEYS = ['country', 'city', 'district', 'specialty', 'provider', 'doctor', 'branch', 'campaign', 'channel', 'careType', 'platform', 'sourceKind', 'origin'];
const DIM_COLUMN = { city: 'city', district: 'district', specialty: 'specialty', provider: 'providerRef', doctor: 'doctorRef', branch: 'branchRef', campaign: 'campaign', channel: 'channel', careType: 'careType', platform: 'platform', sourceKind: 'sourceKind', origin: 'origin' };
const BOOKING_ONLY_FILTERS = ['city', 'district', 'specialty', 'provider', 'doctor', 'branch', 'origin', 'channel'];
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID_LIKE = /^[A-Za-z0-9 _.:-]{1,64}$/u;
function parseFilters(q, now = new Date()) {
    const to = typeof q.to === 'string' && ISO_DAY.test(q.to) ? q.to : now.toISOString().slice(0, 10);
    const from = typeof q.from === 'string' && ISO_DAY.test(q.from) ? q.from : new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
    if (from > to)
        throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'from must not be after to');
    if (Date.parse(to) - Date.parse(from) > 366 * 86_400_000)
        throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'a report covers at most 366 days');
    const f = { from, to };
    for (const k of exports.FILTER_KEYS) {
        const v = q[k];
        if (v === undefined || v === '')
            continue;
        if (typeof v !== 'string' || !ID_LIKE.test(v))
            throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', `${k} is not a valid filter value`);
        if (k === 'country')
            f.market = v.toUpperCase();
        else
            f[k] = v;
    }
    return f;
}
const num = (v) => v ?? 0;
let GrowthMetricsService = class GrowthMetricsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    where(f, a, metrics) {
        const w = { market: f.market ?? growth_flags_1.GROWTH_DEFAULT_MARKET, day: { gte: new Date(`${f.from}T00:00:00Z`), lte: new Date(`${f.to}T00:00:00Z`) } };
        if (metrics)
            w.metric = { in: [...metrics] };
        for (const [k, col] of Object.entries(DIM_COLUMN)) {
            const v = f[k];
            if (v)
                w[col] = v;
        }
        if (a.kind === 'PROVIDER')
            w.providerRef = a.orgId;
        return w;
    }
    bookingOnly(f, a) { return a.kind === 'PROVIDER' || BOOKING_ONLY_FILTERS.some((k) => f[k]); }
    async sums(f, a, metrics, by = []) {
        const rows = await this.prisma.growthMetricDaily.groupBy({ by: ['metric', ...by], where: this.where(f, a, metrics), _sum: { value: true } });
        const m = new Map();
        for (const r of rows) {
            const key = Object.fromEntries(by.map((b) => [b, String(r[b] ?? '')]));
            const id = JSON.stringify(key);
            const e = m.get(id) ?? { key, sums: new Map() };
            e.sums.set(String(r.metric), num(r._sum.value));
            m.set(id, e);
        }
        return [...m.values()];
    }
    total = async (f, a, metrics) => (await this.sums(f, a, metrics))[0]?.sums ?? new Map();
    async spend(f, a, by = []) {
        if (a.kind === 'PROVIDER')
            return [];
        const rows = await this.prisma.growthSpendEntry.findMany({ where: { market: f.market ?? growth_flags_1.GROWTH_DEFAULT_MARKET, status: 'APPROVED', day: { gte: new Date(`${f.from}T00:00:00Z`), lte: new Date(`${f.to}T00:00:00Z`) }, ...(f.campaign ? { campaign: f.campaign } : {}), ...(f.channel ? { channel: f.channel } : {}), ...(f.sourceKind ? { sourceKind: f.sourceKind } : {}) } });
        const m = new Map();
        for (const r of rows) {
            const key = Object.fromEntries(by.map((b) => [b, r[b]]));
            const id = JSON.stringify(key);
            const e = m.get(id) ?? { key, amountMinor: 0 };
            e.amountMinor += r.amountMinor;
            m.set(id, e);
        }
        return [...m.values()];
    }
    async spendTotal(f, a) { return (await this.spend(f, a)).reduce((s, r) => s + r.amountMinor, 0); }
    async freshness() {
        const m = await this.prisma.growthMetricDaily.aggregate({ _max: { updatedAt: true } });
        const e = await this.prisma.growthEvent.aggregate({ _max: { occurredAt: true } });
        return { rolledUpAt: m._max.updatedAt?.toISOString() ?? null, lastEventAt: e._max.occurredAt?.toISOString() ?? null };
    }
    async overview(f, a) {
        const s = await this.total(f, a, ['BookingConfirmed', 'BookingAttended', 'AttendedNewPatient', 'SearchStarted', 'GbvMinor', 'RevenueMinor', 'RevenueReversedMinor', 'CommissionPendingMinor']);
        const byOrigin = await this.sums(f, a, ['BookingConfirmed', 'AttendedNewPatient'], ['origin']);
        const get = (name) => num(s.get(name));
        const confirmed = get('BookingConfirmed');
        const anp = get('AttendedNewPatient');
        const origin = (name, o) => num(byOrigin.find((r) => r.key.origin === o)?.sums.get(name));
        const led = { providerLed: origin('BookingConfirmed', 'PROVIDER_LED'), marketplace: origin('BookingConfirmed', 'MARKETPLACE'), unattributed: origin('BookingConfirmed', 'UNATTRIBUTED') };
        const feeBearingAnp = origin('AttendedNewPatient', 'MARKETPLACE') + origin('AttendedNewPatient', 'UNATTRIBUTED');
        const own = a.kind === 'OPS';
        const spend = own ? await this.spendTotal(f, a) : 0;
        const revenue = get('RevenueMinor') - get('RevenueReversedMinor');
        const hideVisitor = this.bookingOnly(f, a);
        const searches = hideVisitor ? null : get('SearchStarted');
        const k = (n) => n === 0 || n >= kanon_1.K_MIN;
        const m = (count, v) => (v === null ? null : count > 0 && count < kanon_1.K_MIN ? kanon_1.MASK : v);
        return {
            period: { from: f.from, to: f.to }, filters: this.shown(f), audience: a.kind, k: kanon_1.K_MIN, freshness: await this.freshness(),
            bookings: (0, kanon_1.maskTotal)(confirmed).count,
            attendedNewPatients: (0, kanon_1.maskTotal)(anp).count,
            feeBearingNewPatients: (0, kanon_1.maskTotal)(feeBearingAnp).count,
            providerLedShare: m(confirmed, (0, formulas_1.pct)(led.providerLed, led.providerLed + led.marketplace + led.unattributed)),
            originMix: { providerLed: (0, kanon_1.maskTotal)(led.providerLed).count, marketplace: (0, kanon_1.maskTotal)(led.marketplace).count, unattributed: (0, kanon_1.maskTotal)(led.unattributed).count },
            bookingToAttended: m(confirmed, (0, formulas_1.pct)(get('BookingAttended'), confirmed)),
            searchToBooking: searches === null ? null : m(searches, (0, formulas_1.pct)(confirmed, searches)),
            ...(own ? {
                grossBookingValueMinor: m(confirmed, get('GbvMinor')), grossBookingValue: { isRevenue: false, note: 'Visit fees of confirmed bookings: a volume indicator, never Kiorex revenue' },
                kiorexRevenueMinor: m(anp, revenue), commissionPendingMinor: m(anp, get('CommissionPendingMinor')), revenueNote: 'Commission charges (CONFIRMED or BILLED) net of reversals. Excludes deposits, promotional credits, taxes and provider settlements.',
                spendMinor: spend, blendedCacMinor: m(anp, (0, formulas_1.blendedCac)(spend, anp)), merRatio: m(anp, (0, formulas_1.mer)(revenue, spend)), ltvMinor: (0, formulas_1.ltvMinor)(4000, 0.04),
            } : {}),
            coverage: { visitorStageAvailable: !hideVisitor, note: hideVisitor ? 'Place, specialty, provider and origin filters apply to booking stages only: the anonymous visitor stream has none of them.' : undefined },
            masked: ![confirmed, anp].every(k),
        };
    }
    async funnel(f, a) {
        const hideVisitor = this.bookingOnly(f, a);
        const stages = [...(hideVisitor ? [] : ['PageViewed', 'SearchStarted', 'ResultsViewed', 'ProviderViewed']), 'SlotSelected', 'BookingInitiated', 'BookingConfirmed', 'BookingAttended'];
        const s = await this.total(f, a, stages);
        const counts = stages.map((st) => num(s.get(st)));
        const cells = (0, kanon_1.applyKAnonymity)(stages.map((st, i) => ({ key: st, count: counts[i] })), { totalShown: false });
        return {
            period: { from: f.from, to: f.to }, filters: this.shown(f), audience: a.kind, k: kanon_1.K_MIN, freshness: await this.freshness(),
            stages: stages.map((st, i) => {
                const c = cells[i];
                const prev = i > 0 ? counts[i - 1] : null;
                const prevMasked = i > 0 ? cells[i - 1].masked : false;
                const visitor = rollup_service_1.VISITOR_STREAM_METRICS.includes(st);
                return { stage: st, count: c.count, masked: c.masked, kind: visitor ? 'VISITOR_STREAM' : 'BOOKING_FACT', stepConversionPct: c.masked || prevMasked || prev === null ? (prev === null ? null : kanon_1.MASK) : (0, formulas_1.pct)(counts[i], prev), cumulativeConversionPct: i === 0 || c.masked || cells[0].masked ? (i === 0 ? null : kanon_1.MASK) : (0, formulas_1.pct)(counts[i], counts[0]) };
            }),
            coverage: { visitorStageAvailable: !hideVisitor },
        };
    }
    async channels(f, a, by = ['sourceKind']) {
        const rows = await this.sums(f, a, ['BookingConfirmed', 'AttendedNewPatient', 'RevenueMinor', 'RevenueReversedMinor'], by);
        const own = a.kind === 'OPS';
        const spend = own ? await this.spend(f, a, by.filter((b) => b === 'campaign' || b === 'sourceKind')) : [];
        const keyOf = (k) => by.map((b) => k[b] ?? '').join('|') || 'ALL';
        const spendOf = (k) => spend.find((r) => by.every((b) => (r.key[b] ?? '') === (k[b] ?? '')))?.amountMinor ?? 0;
        const known = new Set(rows.map((r) => keyOf(r.key)));
        const orphan = spend.filter((sp) => !known.has(keyOf(sp.key))).map((sp) => ({ key: sp.key, sums: new Map() }));
        const all = [...rows, ...orphan].sort((x, y) => num(y.sums.get('BookingConfirmed')) - num(x.sums.get('BookingConfirmed')) || (keyOf(x.key) < keyOf(y.key) ? -1 : 1));
        const cells = (0, kanon_1.applyKAnonymity)(all.map((r) => ({ key: keyOf(r.key), count: num(r.sums.get('BookingConfirmed')) })));
        const anpCells = (0, kanon_1.applyKAnonymity)(all.map((r) => ({ key: keyOf(r.key), count: num(r.sums.get('AttendedNewPatient')) })), { totalShown: false });
        return {
            period: { from: f.from, to: f.to }, filters: this.shown(f), audience: a.kind, k: kanon_1.K_MIN, freshness: await this.freshness(),
            rows: all.map((r, i) => {
                const bookings = cells[i];
                const anpC = anpCells[i];
                const anp = num(r.sums.get('AttendedNewPatient'));
                const sp = spendOf(r.key);
                const revenue = num(r.sums.get('RevenueMinor')) - num(r.sums.get('RevenueReversedMinor'));
                const hide = bookings.masked || anpC.masked;
                const cac = (0, formulas_1.blendedCac)(sp, anp);
                const lc = (0, formulas_1.ltvToCac)((0, formulas_1.ltvMinor)(4000, 0.04), cac);
                return {
                    ...r.key, bookings: bookings.count, attendedNewPatients: anpC.count,
                    ...(own ? { spendMinor: sp, revenueMinor: anpC.masked ? kanon_1.MASK : revenue, cacMinor: anpC.masked ? kanon_1.MASK : cac, roas: anpC.masked ? kanon_1.MASK : (0, formulas_1.roas)(revenue, sp), ltvToCac: anpC.masked ? kanon_1.MASK : lc, verdict: anpC.masked ? kanon_1.MASK : (0, formulas_1.campaignVerdict)(lc) } : {}),
                    masked: hide,
                };
            }),
        };
    }
    async breakdown(f, a, dim) {
        const col = DIM_COLUMN[dim];
        const sums = await this.sums(f, a, ['BookingConfirmed', 'AttendedNewPatient'], [col, 'origin']);
        const dims = new Map();
        for (const r of sums) {
            const k = r.key[col] ?? '';
            const e = dims.get(k) ?? { bookings: 0, anp: 0, led: 0 };
            const b = num(r.sums.get('BookingConfirmed'));
            e.bookings += b;
            e.anp += num(r.sums.get('AttendedNewPatient'));
            if (r.key.origin === 'PROVIDER_LED')
                e.led += b;
            dims.set(k, e);
        }
        const list = [...dims.entries()].filter(([k]) => k !== '').sort((x, y) => y[1].bookings - x[1].bookings || (x[0] < y[0] ? -1 : 1));
        const cells = (0, kanon_1.applyKAnonymity)(list.map(([k, v]) => ({ key: k, count: v.bookings })));
        return { dimension: dim, period: { from: f.from, to: f.to }, k: kanon_1.K_MIN, rows: list.map(([k, v], i) => ({ [dim]: k, bookings: cells[i].count, attendedNewPatients: cells[i].masked ? kanon_1.MASK : (0, kanon_1.maskTotal)(v.anp).count, providerLedSharePct: cells[i].masked ? kanon_1.MASK : (0, formulas_1.pct)(v.led, v.bookings), masked: cells[i].masked })) };
    }
    async cohorts(f, a, now = new Date()) {
        const months = Math.min(Math.max(f.months ?? 12, 1), 24);
        const counted = ['PENDING_CLINIC', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW'];
        const org = a.kind === 'PROVIDER' ? a.orgId : null;
        const rows = await this.prisma.$queryRaw(client_1.Prisma.sql `
      WITH first AS (
        SELECT DISTINCT ON (b."sub") b."sub" AS sub, b."createdAt" AS first_at, COALESCE(b."acquisitionOrigin", 'UNATTRIBUTED') AS origin, b."tenantId" AS tenant
        FROM "BookingIntent" b WHERE b."dependantId" IS NULL AND b."status" = ANY(${counted})
        ORDER BY b."sub", b."createdAt", b."id")
      SELECT to_char(date_trunc('month', f.first_at), 'YYYY-MM') AS cohort, count(*)::int AS size,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "BookingIntent" r WHERE r."sub" = f.sub AND r."dependantId" IS NULL AND r."status" = ANY(${counted}) AND r."createdAt" > f.first_at AND r."createdAt" <= f.first_at + interval '30 days'))::int AS r30,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "BookingIntent" r WHERE r."sub" = f.sub AND r."dependantId" IS NULL AND r."status" = ANY(${counted}) AND r."createdAt" > f.first_at AND r."createdAt" <= f.first_at + interval '90 days'))::int AS r90,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "BookingIntent" r WHERE r."sub" = f.sub AND r."dependantId" IS NULL AND r."status" = ANY(${counted}) AND r."createdAt" > f.first_at AND r."createdAt" <= f.first_at + interval '180 days'))::int AS r180
      FROM first f WHERE f.first_at >= date_trunc('month', ${now}::timestamptz) - (${months}::int * interval '1 month')
        ${f.origin ? client_1.Prisma.sql `AND f.origin = ${f.origin}` : client_1.Prisma.empty} ${org ? client_1.Prisma.sql `AND f.tenant = ${org}` : client_1.Prisma.empty}
      GROUP BY 1 ORDER BY 1`);
        const cells = (0, kanon_1.applyKAnonymity)(rows.map((r) => ({ key: r.cohort, count: r.size })), { totalShown: false });
        return {
            method: 'ACQUISITION_COHORT_FIRST_BOOKING_MONTH', k: kanon_1.K_MIN, observation: 'A window is shown only once it is closed for the whole cohort; retention is a product measure and earns no fee by itself.',
            rows: rows.map((r, i) => {
                const monthEnd = new Date(Date.UTC(Number(r.cohort.slice(0, 4)), Number(r.cohort.slice(5)), 1));
                const closed = (d) => now.getTime() >= monthEnd.getTime() + d * 86_400_000;
                const c = cells[i];
                const show = (n, d) => (c.masked ? kanon_1.MASK : !closed(d) ? null : (0, formulas_1.pct)(n, r.size));
                return { cohort: r.cohort, size: c.count, masked: c.masked, retention30Pct: show(r.r30, 30), retention90Pct: show(r.r90, 90), retention180Pct: show(r.r180, 180) };
            }),
        };
    }
    unitEconomics() { return { feeMinor: 4000, disputeRate: 0.04, ltvMinor: (0, formulas_1.ltvMinor)(4000, 0.04), payMarginMinor: 0, note: 'PROPOSED_DEFAULT inputs (ADR-007 EGP 40, 4 percent dispute rate); LTV = f x (1 - r) + Pay margin (not modelled)' }; }
    shown(f) { const o = {}; for (const k of [...exports.FILTER_KEYS]) {
        const v = k === 'country' ? f.market : f[k];
        if (v)
            o[k] = v;
    } return o; }
};
exports.GrowthMetricsService = GrowthMetricsService;
exports.GrowthMetricsService = GrowthMetricsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], GrowthMetricsService);
void formulas_1.ratio;
void formulas_1.providerLedShare;
void formulas_1.bookingToAttended;
void formulas_1.searchToBooking;
//# sourceMappingURL=metrics.service.js.map