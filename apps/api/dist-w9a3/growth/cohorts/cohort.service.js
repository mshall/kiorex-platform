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
exports.CohortService = exports.cohortKey = exports.BASES = exports.LTV_MODEL = void 0;
exports.toLtvPatient = toLtvPatient;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const prisma_service_1 = require("../../prisma/prisma.service");
const market_core_public_1 = require("../../market/market-core-public");
const growth_errors_1 = require("../growth-errors");
const growth_config_service_1 = require("../config/growth-config.service");
const kanon_1 = require("../analytics/kanon");
const cohort_builder_1 = require("./cohort-builder");
const cohort_data_service_1 = require("./cohort-data.service");
const ltv_fit_1 = require("./ltv-fit");
const ltv_policy_1 = require("./ltv-policy");
const retention_1 = require("./retention");
const market_day_1 = require("../campaigns/market-day");
exports.LTV_MODEL = 'ltv-v1';
exports.BASES = ['FIRST_COMPLETED', 'REGISTRATION'];
const DIMS = ['ALL', 'SOURCE', 'CAMPAIGN', 'PLATFORM'];
const policyTag = (p) => (0, node_crypto_1.createHash)('sha256').update(JSON.stringify(Object.keys(p).sort().map((k) => [k, p[k]]))).digest('hex').slice(0, 8);
const cohortKey = (basis, dim, value) => `${basis}|${dim}|${value}`;
exports.cohortKey = cohortKey;
function toLtvPatient(r, zone, asOf, includeReward) {
    if (r.acquiredAt === null)
        return null;
    const cohort = (0, cohort_builder_1.monthOf)(r.acquiredAt, zone);
    const age = (0, cohort_builder_1.monthsBetween)(cohort, (0, cohort_builder_1.monthOf)(asOf, zone));
    if (age < 0)
        return null;
    const contrib = new Array(age + 1).fill(0);
    for (const v of r.visits) {
        const i = (0, cohort_builder_1.monthsBetween)(cohort, (0, cohort_builder_1.monthOf)(v.at, zone));
        if (i >= 0 && i <= age)
            contrib[i] += v.revenueMinor;
    }
    if (includeReward)
        for (const w of r.rewards) {
            const i = (0, cohort_builder_1.monthsBetween)(cohort, (0, cohort_builder_1.monthOf)(w.at, zone));
            if (i >= 0 && i <= age)
                contrib[i] -= w.costMinor;
        }
    return { age, contrib };
}
let CohortService = class CohortService {
    prisma;
    data;
    config;
    constructor(prisma, data, config) {
        this.prisma = prisma;
        this.data = data;
        this.config = config;
    }
    async policy(market) {
        const r = await this.config.resolve('LTV_POLICY', { market });
        const policy = (0, ltv_policy_1.withLtvDefaults)(r.payload);
        return { policy, version: r.source === 'ACTIVE' ? r.version : null, source: r.source, tag: policyTag(policy) };
    }
    async rollup(i) {
        const now = i.now ?? new Date();
        const months = Math.min(60, Math.max(1, i.months ?? 24));
        const zone = (0, market_core_public_1.marketTimezone)(i.market);
        const { policy, tag } = await this.policy(i.market);
        const out = { market: i.market, months, estimates: 0 };
        for (const basis of i.basis ? [i.basis] : exports.BASES) {
            const records = await this.data.load(i.market, basis, now, months);
            const cells = (0, cohort_builder_1.buildCohorts)(records, { basis, zone, asOf: now.getTime(), k: policy.minCohortPatients });
            const first = (0, cohort_builder_1.monthStart)((0, cohort_builder_1.addMonths)((0, cohort_builder_1.monthOf)(now.getTime(), zone), -(months - 1)));
            await this.prisma.$transaction(async (tx) => {
                await tx.growthCohortMonthly.deleteMany({ where: { market: i.market, cohortBasis: basis, cohortMonth: { gte: new Date(`${first}T00:00:00Z`) } } });
                for (let o = 0; o < cells.length; o += 2000)
                    await tx.growthCohortMonthly.createMany({ data: cells.slice(o, o + 2000).map((c) => ({ market: i.market, cohortMonth: new Date(`${c.cohortMonth}T00:00:00Z`), cohortBasis: c.basis, sourceKind: c.sourceKind, campaignId: c.campaignId, platform: c.platform, monthIndex: c.monthIndex, patients: c.patients, retainedPatients: c.retainedPatients, completedBookings: c.completedBookings, revenueMinor: BigInt(c.revenueMinor), rewardCostMinor: BigInt(c.rewardCostMinor), k: c.k, suppressed: c.suppressed })) });
            }, { timeout: 120_000 });
            out[`cells_${basis}`] = cells.length;
            if (basis === 'FIRST_COMPLETED')
                out.estimates = await this.estimate(i.market, records, zone, now, policy, tag);
        }
        return out;
    }
    async estimate(market, records, zone, now, policy, tag) {
        const groups = new Map();
        const add = (dim, value, p) => { const k = (0, exports.cohortKey)('FIRST_COMPLETED', dim, value); const g = groups.get(k) ?? { dim, value, list: [] }; g.list.push(p); groups.set(k, g); };
        for (const r of records) {
            const p = toLtvPatient(r, zone, now.getTime(), policy.includeRewardCost);
            if (!p)
                continue;
            add('ALL', '', p);
            add('SOURCE', r.sourceKind, p);
            if (r.campaignId)
                add('CAMPAIGN', r.campaignId, p);
            if (r.platform)
                add('PLATFORM', r.platform, p);
        }
        let n = 0;
        const keep = new Set();
        for (const [key, g] of groups) {
            const f = (0, ltv_fit_1.fitLtv)(g.list, policy, key);
            if (!f)
                continue;
            keep.add(key);
            n++;
            const data = { estimateMinor: BigInt(f.estimateMinor), lowMinor: BigInt(f.lowMinor), highMinor: BigInt(f.highMinor), n: f.n, computedAt: now, label: 'ESTIMATE' };
            await this.prisma.growthLtvEstimate.upsert({ where: { market_cohortKey_horizonMonths_modelVersion: { market, cohortKey: key, horizonMonths: policy.horizonMonths, modelVersion: `${exports.LTV_MODEL}+${tag}` } }, create: { market, cohortKey: key, horizonMonths: policy.horizonMonths, modelVersion: `${exports.LTV_MODEL}+${tag}`, ...data }, update: data });
        }
        await this.prisma.growthLtvEstimate.deleteMany({ where: { market, modelVersion: `${exports.LTV_MODEL}+${tag}`, cohortKey: { startsWith: 'FIRST_COMPLETED|' }, NOT: { cohortKey: { in: [...keep] } } } });
        return n;
    }
    cells(rows) {
        return rows.map((r) => ({ cohortMonth: r.cohortMonth.toISOString().slice(0, 10), basis: r.cohortBasis, sourceKind: r.sourceKind, campaignId: r.campaignId, platform: r.platform, monthIndex: r.monthIndex, patients: r.patients, retainedPatients: r.retainedPatients, completedBookings: r.completedBookings, revenueMinor: Number(r.revenueMinor), rewardCostMinor: Number(r.rewardCostMinor), k: r.k, suppressed: r.suppressed }));
    }
    async load(market, basis, dimension, value) {
        const where = { market, cohortBasis: basis, sourceKind: dimension === 'SOURCE' ? value : '', campaignId: dimension === 'CAMPAIGN' ? value : '', platform: dimension === 'PLATFORM' ? value : '' };
        return this.cells(await this.prisma.growthCohortMonthly.findMany({ where, orderBy: [{ cohortMonth: 'asc' }, { monthIndex: 'asc' }] }));
    }
    async values(market, basis, dimension) {
        const col = dimension === 'SOURCE' ? 'sourceKind' : dimension === 'CAMPAIGN' ? 'campaignId' : 'platform';
        const rows = await this.prisma.growthCohortMonthly.findMany({ where: { market, cohortBasis: basis, [col]: { not: '' }, suppressed: false }, distinct: [col], select: { sourceKind: true, campaignId: true, platform: true } });
        return rows.map((r) => r[col]).sort();
    }
    async table(q) {
        const basis = q.basis ?? 'FIRST_COMPLETED';
        const dimension = q.dimension ?? 'ALL';
        if (!exports.BASES.includes(basis) || !DIMS.includes(dimension))
            throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'Unknown basis or dimension');
        if (dimension !== 'ALL' && !q.value)
            throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'A dimension needs a value');
        const cells = await this.load(q.market, basis, dimension, dimension === 'ALL' ? '' : (q.value ?? ''));
        const byMonth = new Map();
        for (const c of cells)
            byMonth.set(c.cohortMonth, [...(byMonth.get(c.cohortMonth) ?? []), c]);
        const rows = [...byMonth.entries()].map(([cohortMonth, list]) => {
            if (list.every((c) => c.suppressed))
                return { cohortMonth, suppressed: true, patients: kanon_1.MASK, months: [] };
            const live = list.filter((c) => !c.suppressed);
            const patients = live[0].patients;
            return { cohortMonth, suppressed: false, patients, months: live.map((c) => { const small = (0, kanon_1.maskCount)(c.retainedPatients) === kanon_1.MASK; return { monthIndex: c.monthIndex, retained: (0, kanon_1.maskCount)(c.retainedPatients), completedBookings: small ? kanon_1.MASK : c.completedBookings, revenueMinor: small ? kanon_1.MASK : c.revenueMinor, rewardCostMinor: small ? kanon_1.MASK : c.rewardCostMinor }; }) };
        });
        return { market: q.market, basis, dimension, value: dimension === 'ALL' ? null : q.value, k: 10, rows, visitsPerPatientM3: (0, retention_1.visitsPerPatient)(cells, 3), note: 'Cells with fewer than 10 people show "fewer than 10"; no per-person data exists.' };
    }
    async retention(q) {
        const basis = q.basis ?? 'FIRST_COMPLETED';
        const dimension = q.dimension ?? 'ALL';
        const cells = await this.load(q.market, basis, dimension, dimension === 'ALL' ? '' : (q.value ?? ''));
        return { market: q.market, basis, dimension, value: dimension === 'ALL' ? null : q.value, rows: (0, retention_1.retentionRows)(cells), k: 10 };
    }
    async ltv(q) {
        const { policy, tag, version, source } = await this.policy(q.market);
        const rows = await this.prisma.growthLtvEstimate.findMany({ where: { market: q.market, modelVersion: `${exports.LTV_MODEL}+${tag}`, cohortKey: { startsWith: `${q.basis ?? 'FIRST_COMPLETED'}|` } }, orderBy: { cohortKey: 'asc' } });
        return {
            market: q.market, label: 'ESTIMATE', modelVersion: `${exports.LTV_MODEL}+${tag}`, policy: { version, source, horizonMonths: policy.horizonMonths, discountRateBp: policy.discountRateBp, includeRewardCost: policy.includeRewardCost, intervalPercent: policy.intervalPercent, resamples: policy.bootstrapResamples },
            rows: rows.map((r) => { const [, dimension, value] = r.cohortKey.split('|'); return { dimension, value: value || null, horizonMonths: r.horizonMonths, estimateMinor: Number(r.estimateMinor), lowMinor: Number(r.lowMinor), highMinor: Number(r.highMinor), n: r.n, label: r.label, computedAt: r.computedAt.toISOString() }; }),
            method: 'Observed cumulative contribution per acquired patient, projected with a geometric tail for months not yet observed, bootstrap interval over patients (seeded). Model risk is not in the interval. No per-person value exists.',
        };
    }
    async payback(q) {
        const now = q.now ?? new Date();
        const zone = (0, market_core_public_1.marketTimezone)(q.market);
        const months = Math.min(36, Math.max(1, q.months ?? 12));
        const { policy, tag } = await this.policy(q.market);
        const cells = await this.load(q.market, 'FIRST_COMPLETED', 'ALL', '');
        const est = await this.prisma.growthLtvEstimate.findUnique({ where: { market_cohortKey_horizonMonths_modelVersion: { market: q.market, cohortKey: (0, exports.cohortKey)('FIRST_COMPLETED', 'ALL', ''), horizonMonths: policy.horizonMonths, modelVersion: `${exports.LTV_MODEL}+${tag}` } } });
        const byMonth = new Map();
        for (const c of cells)
            byMonth.set(c.cohortMonth, [...(byMonth.get(c.cohortMonth) ?? []), c]);
        const rows = [];
        for (const [cohortMonth, list] of [...byMonth.entries()].sort().slice(-months)) {
            const live = list.filter((c) => !c.suppressed);
            if (!live.length) {
                rows.push({ cohortMonth, suppressed: true });
                continue;
            }
            const patients = live[0].patients;
            const ym = cohortMonth.slice(0, 7);
            const from = new Date(`${ym}-01T00:00:00Z`);
            const to = new Date(`${(0, cohort_builder_1.addMonths)(ym, 1)}-01T00:00:00Z`);
            const spend = await this.prisma.growthSpendEntry.aggregate({ where: { market: q.market, status: 'APPROVED', day: { gte: from, lt: to } }, _sum: { amountMinor: true } });
            const spendMinor = spend._sum.amountMinor ?? 0;
            const cac = spendMinor > 0 ? Math.round(spendMinor / patients) : null;
            let cum = 0;
            let payback = null;
            const curve = [];
            for (const c of live) {
                cum += (c.revenueMinor - (policy.includeRewardCost ? c.rewardCostMinor : 0)) / patients;
                curve.push(Math.round(cum));
                if (payback === null && cac !== null && cum >= cac)
                    payback = c.monthIndex;
            }
            rows.push({ cohortMonth, suppressed: false, patients, spendMinor: spendMinor || null, cacMinor: cac, paybackMonth: payback, observedMonths: live.length, cumulativePerPatientMinor: curve });
        }
        const spendTotal = rows.reduce((s, r) => s + (('spendMinor' in r && r.spendMinor) || 0), 0);
        const patientTotal = rows.reduce((s, r) => s + (('patients' in r && typeof r.patients === 'number') ? r.patients : 0), 0);
        const blended = spendTotal > 0 && patientTotal >= 10 ? Math.round(spendTotal / patientTotal) : null;
        const ratio = est && blended ? { estimate: round2(Number(est.estimateMinor) / blended), low: round2(Number(est.lowMinor) / blended), high: round2(Number(est.highMinor) / blended), n: est.n, label: 'ESTIMATE' } : null;
        return { market: q.market, rows, blendedCacMinor: blended, ltvToCac: ratio, note: blended === null ? 'No approved spend (or fewer than 10 acquired patients): CAC and LTV:CAC are not shown. Spend is entered in Growth finance.' : 'CAC is blended: approved spend of the cohort month over patients acquired in it. LTV carries its interval; the CAC is a single figure.', horizonMonths: policy.horizonMonths, zoneDay: (0, market_day_1.localDay)(now, zone), since: (0, market_day_1.addDays)((0, market_day_1.localDay)(now, zone), -30) };
    }
    async reconcile(market, now = new Date(), months = 24) {
        const zone = (0, market_core_public_1.marketTimezone)(market);
        const stored = await this.load(market, 'FIRST_COMPLETED', 'ALL', '');
        const records = await this.data.load(market, 'FIRST_COMPLETED', now, months);
        const live = stored.filter((c) => !c.suppressed && c.monthIndex === 0);
        const patients = live.reduce((s, c) => s + c.patients, 0);
        const recount = new Map();
        for (const r of records)
            if (r.acquiredAt !== null) {
                const m = `${(0, cohort_builder_1.monthOf)(r.acquiredAt, zone)}-01`;
                recount.set(m, (recount.get(m) ?? 0) + 1);
            }
        const expected = [...recount.entries()].filter(([, n]) => n >= 10).reduce((s, [, n]) => s + n, 0);
        const revenueStored = stored.filter((c) => !c.suppressed).reduce((s, c) => s + c.revenueMinor, 0);
        const shown = new Set(live.map((c) => c.cohortMonth.slice(0, 7)));
        let revenueRecount = 0;
        for (const r of records) {
            if (r.acquiredAt === null || !shown.has((0, cohort_builder_1.monthOf)(r.acquiredAt, zone)))
                continue;
            for (const v of r.visits)
                revenueRecount += v.revenueMinor;
        }
        return { ok: patients === expected && revenueStored === revenueRecount, patientsStored: patients, patientsRecount: expected, revenueStoredMinor: revenueStored, revenueRecountMinor: revenueRecount };
    }
};
exports.CohortService = CohortService;
exports.CohortService = CohortService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, cohort_data_service_1.CohortDataService, growth_config_service_1.GrowthConfigService])
], CohortService);
const round2 = (n) => Math.round(n * 100) / 100;
//# sourceMappingURL=cohort.service.js.map