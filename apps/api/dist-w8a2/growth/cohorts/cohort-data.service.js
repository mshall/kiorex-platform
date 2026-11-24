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
exports.CohortDataService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const market_core_public_1 = require("../../market/market-core-public");
const market_day_1 = require("../campaigns/market-day");
const cohort_builder_1 = require("./cohort-builder");
const CHUNK = 3000;
const REF = /^[A-Za-z0-9_-]{1,64}$/;
const SRC = /^[a-z0-9_-]{1,32}$/;
const chunks = (a, n = CHUNK) => { const o = []; for (let i = 0; i < a.length; i += n)
    o.push(a.slice(i, i + n)); return o; };
let CohortDataService = class CohortDataService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    windowStart(market, now, months) { const zone = (0, market_core_public_1.marketTimezone)(market); return (0, market_day_1.startOfLocalDay)((0, cohort_builder_1.monthStart)((0, cohort_builder_1.addMonths)((0, cohort_builder_1.monthOf)(now.getTime(), zone), -(months - 1))), zone); }
    async load(market, basis, now, months) {
        const since = this.windowStart(market, now, months);
        return basis === 'FIRST_COMPLETED' ? this.firstCompleted(market, since, now) : this.registered(market, since, now);
    }
    async attendedBy(market, subs, until) {
        const out = new Map();
        const owner = new Map();
        for (const c of chunks(subs))
            for (const b of await this.prisma.bookingIntent.findMany({ where: { sub: { in: c } }, select: { id: true, sub: true } }))
                owner.set(b.id, b.sub);
        const ids = [...owner.keys()];
        for (const c of chunks(ids))
            for (const e of await this.prisma.growthEvent.findMany({ where: { market, name: 'BookingAttended', bookingId: { in: c }, occurredAt: { lte: until } }, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }], select: { bookingId: true, occurredAt: true } })) {
                const sub = owner.get(e.bookingId);
                const l = out.get(sub) ?? [];
                if (!l.some((x) => x.bookingId === e.bookingId))
                    l.push({ bookingId: e.bookingId, at: e.occurredAt });
                out.set(sub, l);
            }
        return out;
    }
    async revenueOf(market, bookingIds) {
        const revenue = new Map();
        for (const c of chunks(bookingIds)) {
            const facts = await this.prisma.growthRevenueFact.findMany({ where: { market, bookingId: { in: c } }, select: { kind: true, chargeId: true, status: true, amountMinor: true, bookingId: true }, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] });
            const counted = new Set();
            for (const f of facts)
                if (f.kind === 'CHARGE' && (f.status === 'CONFIRMED' || f.status === 'BILLED') && !counted.has(f.chargeId)) {
                    counted.add(f.chargeId);
                    revenue.set(f.bookingId, (revenue.get(f.bookingId) ?? 0) + f.amountMinor);
                }
            for (const f of facts)
                if (f.kind === 'REVERSAL' && counted.has(f.chargeId))
                    revenue.set(f.bookingId, Math.max(0, (revenue.get(f.bookingId) ?? 0) - f.amountMinor));
        }
        return revenue;
    }
    async sourceOf(market, bookingIds) {
        const out = new Map();
        const campaigns = new Map((await this.prisma.growthCampaign.findMany({ where: { market }, select: { id: true, utmCampaign: true }, take: 5000 })).map((c) => [c.utmCampaign, c.id]));
        for (const c of chunks(bookingIds)) {
            const decisions = await this.prisma.growthAttributionDecision.findMany({ where: { market, bookingId: { in: c } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { bookingId: true, origin: true, winningTouchId: true } });
            const first = new Map();
            for (const d of decisions)
                if (!first.has(d.bookingId))
                    first.set(d.bookingId, d);
            const touchIds = [...first.values()].map((d) => d.winningTouchId).filter((x) => !!x);
            const touches = new Map();
            for (const t of chunks(touchIds))
                for (const r of await this.prisma.growthTouchpoint.findMany({ where: { id: { in: t } }, select: { id: true, kind: true, utmCampaign: true, utmSource: true } }))
                    touches.set(r.id, r);
            for (const [bookingId, d] of first) {
                const t = d.winningTouchId ? touches.get(d.winningTouchId) : undefined;
                const ref = t?.utmCampaign ?? '';
                const src = (t?.utmSource ?? '').toLowerCase();
                out.set(bookingId, { sourceKind: t?.kind ?? d.origin, campaignId: t && REF.test(ref) ? (campaigns.get(ref) ?? '') : '', platform: t && SRC.test(src) ? src : '' });
            }
        }
        return out;
    }
    async rewardsBy(market, subs, until) {
        const out = new Map();
        for (const c of chunks(subs))
            for (const e of await this.prisma.rewardLedgerEntry.findMany({ where: { type: 'REDEEM', createdAt: { lte: until }, lot: { market, sub: { in: c }, funding: 'PLATFORM_MARKETING' } }, select: { amountMinor: true, createdAt: true, lot: { select: { sub: true } } } })) {
                const l = out.get(e.lot.sub) ?? [];
                l.push({ at: e.createdAt.getTime(), costMinor: e.amountMinor });
                out.set(e.lot.sub, l);
            }
        return out;
    }
    async firstCompleted(market, since, now) {
        const inWindow = await this.prisma.growthEvent.findMany({ where: { market, name: 'BookingAttended', bookingId: { not: null }, occurredAt: { gte: since, lte: now } }, select: { bookingId: true }, distinct: ['bookingId'] });
        const ids = inWindow.map((e) => e.bookingId);
        const subs = new Set();
        for (const c of chunks(ids))
            for (const b of await this.prisma.bookingIntent.findMany({ where: { id: { in: c } }, select: { sub: true } }))
                subs.add(b.sub);
        const attended = await this.attendedBy(market, [...subs], now);
        const people = [...attended.entries()].filter(([, l]) => l.length && l[0].at >= since);
        const firstIds = people.map(([, l]) => l[0].bookingId);
        const allIds = people.flatMap(([, l]) => l.map((v) => v.bookingId));
        const [revenue, source, rewards] = await Promise.all([this.revenueOf(market, allIds), this.sourceOf(market, firstIds), this.rewardsBy(market, people.map(([s]) => s), now)]);
        return people.map(([sub, l]) => {
            const src = source.get(l[0].bookingId) ?? { sourceKind: 'UNATTRIBUTED', campaignId: '', platform: '' };
            return { acquiredAt: l[0].at.getTime(), registeredAt: null, ...src, visits: l.map((v) => ({ at: v.at.getTime(), revenueMinor: revenue.get(v.bookingId) ?? 0 })), rewards: rewards.get(sub) ?? [] };
        });
    }
    async registered(market, since, now) {
        const profiles = [];
        let cursor;
        for (;;) {
            const page = await this.prisma.patientProfile.findMany({ where: { market, createdAt: { gte: since, lte: now } }, orderBy: { id: 'asc' }, take: 5000, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, sub: true, createdAt: true } });
            if (!page.length)
                break;
            cursor = page[page.length - 1].id;
            profiles.push(...page.map((p) => ({ sub: p.sub, createdAt: p.createdAt })));
            if (page.length < 5000)
                break;
        }
        const attended = await this.attendedBy(market, profiles.map((p) => p.sub), now);
        const allIds = [...attended.values()].flatMap((l) => l.map((v) => v.bookingId));
        const firstIds = [...attended.values()].filter((l) => l.length).map((l) => l[0].bookingId);
        const [revenue, source, rewards] = await Promise.all([this.revenueOf(market, allIds), this.sourceOf(market, firstIds), this.rewardsBy(market, profiles.map((p) => p.sub), now)]);
        return profiles.map((p) => {
            const l = attended.get(p.sub) ?? [];
            const src = l.length ? (source.get(l[0].bookingId) ?? { sourceKind: 'UNATTRIBUTED', campaignId: '', platform: '' }) : { sourceKind: 'NO_BOOKING', campaignId: '', platform: '' };
            return { acquiredAt: l[0]?.at.getTime() ?? null, registeredAt: p.createdAt.getTime(), ...src, visits: l.map((v) => ({ at: v.at.getTime(), revenueMinor: revenue.get(v.bookingId) ?? 0 })), rewards: rewards.get(p.sub) ?? [] };
        });
    }
};
exports.CohortDataService = CohortDataService;
exports.CohortDataService = CohortDataService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], CohortDataService);
//# sourceMappingURL=cohort-data.service.js.map