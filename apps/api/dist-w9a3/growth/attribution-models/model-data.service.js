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
exports.buildPaths = exports.ModelDataService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const market_day_1 = require("../campaigns/market-day");
const path_builder_1 = require("./path-builder");
Object.defineProperty(exports, "buildPaths", { enumerable: true, get: function () { return path_builder_1.buildPaths; } });
const CHUNK = 4000;
const REF = /^[A-Za-z0-9_-]{1,64}$/;
const chunks = (a, n = CHUNK) => { const o = []; for (let i = 0; i < a.length; i += n)
    o.push(a.slice(i, i + n)); return o; };
let ModelDataService = class ModelDataService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async conversions(market, from, to) {
        const zone = (0, market_day_1.marketTimezone)(market);
        const ev = await this.prisma.growthEvent.findMany({ where: { market, name: 'BookingAttended', bookingId: { not: null }, props: { path: ['bucket'], equals: 'new' }, occurredAt: { gte: (0, market_day_1.startOfLocalDay)(from, zone), lt: (0, market_day_1.startOfLocalDay)((0, market_day_1.addDays)(to, 1), zone) } }, select: { bookingId: true, occurredAt: true }, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] });
        const first = new Map();
        for (const e of ev)
            if (e.bookingId && !first.has(e.bookingId))
                first.set(e.bookingId, e.occurredAt);
        const ids = [...first.keys()];
        if (!ids.length)
            return [];
        const subs = new Map();
        const revenue = new Map();
        for (const c of chunks(ids)) {
            for (const b of await this.prisma.bookingIntent.findMany({ where: { id: { in: c } }, select: { id: true, sub: true } }))
                subs.set(b.id, b.sub);
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
        return ids.map((id) => ({ id, sub: subs.get(id) ?? null, at: first.get(id).getTime(), revenueMinor: revenue.get(id) ?? 0 }));
    }
    async touchesOf(market, subs, since, until) {
        const rows = new Map();
        const campaigns = await this.campaignIds(market);
        const add = (t) => {
            const ref = t.kind === 'CAMPAIGN' ? (t.utmCampaign ?? '') : (t.linkCode ?? '');
            const safe = REF.test(ref) ? ref : '';
            rows.set(t.id, { id: t.id, sub: t.sub, visitorKey: t.visitorKey, at: t.occurredAt.getTime(), kind: t.kind, ref: safe, campaignId: t.kind === 'CAMPAIGN' && safe ? (campaigns.get(safe) ?? '') : '' });
        };
        const sel = { id: true, sub: true, visitorKey: true, occurredAt: true, kind: true, linkCode: true, utmCampaign: true };
        const vks = new Set();
        for (const c of chunks(subs))
            for (const t of await this.prisma.growthTouchpoint.findMany({ where: { market, sub: { in: c }, occurredAt: { gte: since, lte: until } }, select: sel })) {
                add(t);
                if (t.visitorKey)
                    vks.add(t.visitorKey);
            }
        for (const c of chunks([...vks]))
            for (const t of await this.prisma.growthTouchpoint.findMany({ where: { market, visitorKey: { in: c }, occurredAt: { gte: since, lte: until } }, select: sel }))
                add(t);
        const withdrawn = new Map();
        for (const c of chunks(subs))
            for (const r of await this.prisma.consentRecord.findMany({ where: { sub: { in: c }, purpose: 'ANALYTICS_MEASUREMENT' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { sub: true, granted: true, createdAt: true } })) {
                if (r.granted)
                    withdrawn.delete(r.sub);
                else
                    withdrawn.set(r.sub, r.createdAt.getTime());
            }
        const quarantined = await this.quarantinedIds(since);
        return [...rows.values()].filter((t) => !quarantined.has(t.id) && !(t.sub && withdrawn.has(t.sub) && t.at <= withdrawn.get(t.sub)));
    }
    async allTouches(market, since, until, onPage) {
        const campaigns = await this.campaignIds(market);
        let cursor;
        for (;;) {
            const page = await this.prisma.growthTouchpoint.findMany({ where: { market, occurredAt: { gte: since, lte: until } }, orderBy: { id: 'asc' }, take: 20_000, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, sub: true, visitorKey: true, occurredAt: true, kind: true, linkCode: true, utmCampaign: true } });
            if (!page.length)
                break;
            cursor = page[page.length - 1].id;
            const q = await this.quarantinedIds(since);
            onPage(page.filter((t) => !q.has(t.id)).map((t) => { const ref = t.kind === 'CAMPAIGN' ? (t.utmCampaign ?? '') : (t.linkCode ?? ''); const safe = REF.test(ref) ? ref : ''; return { id: t.id, sub: t.sub, visitorKey: t.visitorKey, at: t.occurredAt.getTime(), kind: t.kind, ref: safe, campaignId: t.kind === 'CAMPAIGN' && safe ? (campaigns.get(safe) ?? '') : '' }; }));
            if (page.length < 20_000)
                break;
        }
    }
    async quarantinedIds(since) {
        return new Set((await this.prisma.auditLog.findMany({ where: { action: 'growth.fraud.touch_quarantine', createdAt: { gte: new Date(since.getTime() - 400 * 86_400_000) } }, select: { resourceId: true }, take: 100_000 })).map((r) => r.resourceId).filter(Boolean));
    }
    async campaignIds(market) { return new Map((await this.prisma.growthCampaign.findMany({ where: { market }, select: { id: true, utmCampaign: true }, take: 5000 })).map((c) => [c.utmCampaign, c.id])); }
};
exports.ModelDataService = ModelDataService;
exports.ModelDataService = ModelDataService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ModelDataService);
//# sourceMappingURL=model-data.service.js.map