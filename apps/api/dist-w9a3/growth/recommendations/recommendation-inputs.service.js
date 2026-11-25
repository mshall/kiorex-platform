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
exports.RecommendationInputsService = exports.seoGroupOf = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("../../prisma/generated/client");
const prisma_service_1 = require("../../prisma/prisma.service");
const recommendation_types_1 = require("./recommendation.types");
const DAY = 86_400_000;
const iso = (d) => d.toISOString().slice(0, 10);
const seoGroupOf = (templateKind) => (['doctor', 'nurse', 'clinic', 'pharmacy', 'lab'].includes(templateKind) ? 'profile' : templateKind);
exports.seoGroupOf = seoGroupOf;
let RecommendationInputsService = class RecommendationInputsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async collect(market, now) {
        const to = new Date(now.getTime());
        const from = new Date(now.getTime() - 28 * DAY);
        const [campaigns, landings, seo, holdouts, ltv] = await Promise.all([this.campaigns(market, from, to, now), this.landings(market, from, to), this.seo(market, now), this.holdouts(market, now), this.ltv(market)]);
        const byChannel = new Map();
        for (const c of campaigns) {
            if (c.channel === 'MIXED')
                continue;
            const x = byChannel.get(c.channel) ?? { spend: 0, attended: 0, n: 0 };
            x.spend += c.spendMinor;
            x.attended += c.attendedNew;
            x.n++;
            byChannel.set(c.channel, x);
        }
        const small = (n) => n > 0 && n < recommendation_types_1.RECOMMENDATION_POLICY.k;
        const channels = [...byChannel.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([channel, x]) => ({ channel, campaigns: x.n, spendMinor: x.spend, attendedNew: small(x.attended) ? 0 : x.attended, cacMinor: x.attended >= recommendation_types_1.RECOMMENDATION_POLICY.k ? Math.round(x.spend / x.attended) : null, ltvMinor: ltv.get(channel) ?? null }));
        return { market, window: { from: iso(from), to: iso(to) }, channels, campaigns: campaigns.filter((c) => !small(c.attendedNew)), landings, seo, holdouts };
    }
    async campaigns(market, from, to, now) {
        const [spend, att] = await Promise.all([
            this.prisma.growthSpendEntry.groupBy({ by: ['campaignId'], where: { market, status: 'APPROVED', campaignId: { not: null }, day: { gte: from, lte: to } }, _sum: { amountMinor: true } }),
            this.prisma.growthMetricDaily.groupBy({ by: ['campaignId'], where: { market, metric: 'AttendedNewPatient', campaignId: { not: '' }, day: { gte: from, lte: to } }, _sum: { value: true } }),
        ]);
        const ids = [...new Set([...spend.map((s) => s.campaignId), ...att.map((a) => a.campaignId)])];
        if (!ids.length)
            return [];
        const rows = await this.prisma.growthCampaign.findMany({ where: { id: { in: ids }, market }, select: { id: true, utmCampaign: true, status: true, channels: true, activatedAt: true } });
        return rows.map((c) => {
            const spendMinor = spend.find((s) => s.campaignId === c.id)?._sum.amountMinor ?? 0;
            const attendedNew = att.find((a) => a.campaignId === c.id)?._sum.value ?? 0;
            return { campaignId: c.id, label: c.utmCampaign, status: c.status, channel: c.channels.length === 1 ? c.channels[0] : 'MIXED', activeDays: c.activatedAt ? Math.max(0, Math.floor((now.getTime() - c.activatedAt.getTime()) / DAY)) : 0, spendMinor, attendedNew, cacMinor: attendedNew > 0 ? Math.round(spendMinor / attendedNew) : null };
        });
    }
    async landings(market, from, to) {
        const rows = await this.prisma.growthMetricDaily.groupBy({ by: ['landingKind', 'metric'], where: { market, metric: { in: ['PageViewed', 'PatientRegistered'] }, landingKind: { not: '' }, day: { gte: from, lte: to } }, _sum: { value: true } });
        const kinds = [...new Set(rows.map((r) => r.landingKind))].sort();
        return kinds.map((k) => ({ landingKind: k, views: rows.find((r) => r.landingKind === k && r.metric === 'PageViewed')?._sum.value ?? 0, registrations: rows.find((r) => r.landingKind === k && r.metric === 'PatientRegistered')?._sum.value ?? 0 }));
    }
    async seo(market, now) {
        const since = new Date(now.getTime() - 30 * DAY);
        const reports = await this.prisma.$queryRaw(client_1.Prisma.sql `
      SELECT t."templateKind", t."locale", count(*)::int AS pages, count(*) FILTER (WHERE cardinality(t."failedChecks") > 0)::int AS failing
      FROM (SELECT DISTINCT ON ("pageKey","locale") "pageKey","locale","templateKind","failedChecks" FROM "SeoQualityReport" WHERE "market" = ${market} AND "checkedAt" >= ${since} ORDER BY "pageKey","locale","checkedAt" DESC) t
      GROUP BY 1, 2`);
        const checks = await this.prisma.$queryRaw(client_1.Prisma.sql `
      SELECT t."templateKind", t."locale", c AS "check", count(*)::int AS n
      FROM (SELECT DISTINCT ON ("pageKey","locale") "pageKey","locale","templateKind","failedChecks" FROM "SeoQualityReport" WHERE "market" = ${market} AND "checkedAt" >= ${since} ORDER BY "pageKey","locale","checkedAt" DESC) t, unnest(t."failedChecks") c
      GROUP BY 1, 2, 3`);
        const snaps = await this.prisma.$queryRaw(client_1.Prisma.sql `
      SELECT DISTINCT ON ("templateKind") "templateKind", "submitted", "indexed", COALESCE(("reasonBuckets"->>'indexedKnown')::boolean, false) AS known FROM "SeoIndexationSnapshot" WHERE "market" = ${market} ORDER BY "templateKind", "day" DESC`);
        const merged = new Map();
        for (const r of reports) {
            const key = `${(0, exports.seoGroupOf)(r.templateKind)}|${r.locale}`;
            const x = merged.get(key) ?? { pages: 0, failing: 0, checks: new Map() };
            x.pages += r.pages;
            x.failing += r.failing;
            merged.set(key, x);
        }
        for (const c of checks) {
            const x = merged.get(`${(0, exports.seoGroupOf)(c.templateKind)}|${c.locale}`);
            if (x)
                x.checks.set(c.check, (x.checks.get(c.check) ?? 0) + c.n);
        }
        const idx = new Map();
        for (const s of snaps)
            if (s.known) {
                const g = (0, exports.seoGroupOf)(s.templateKind);
                const x = idx.get(g) ?? { submitted: 0, indexed: 0 };
                x.submitted += s.submitted;
                x.indexed += s.indexed;
                idx.set(g, x);
            }
        return [...merged.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, x]) => {
            const [templateKind, locale] = key.split('|');
            const i = idx.get(templateKind);
            return { templateKind, locale, pages: x.pages, failingPages: x.failing, topFailedChecks: [...x.checks.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 3).map(([c]) => c), submitted: i?.submitted ?? null, indexed: i?.indexed ?? null };
        });
    }
    async holdouts(market, now) {
        const lo = new Date(now.getTime() - 90 * DAY);
        const hi = new Date(now.getTime() - 30 * DAY);
        const rows = await this.prisma.$queryRaw(client_1.Prisma.sql `
      WITH d AS (
        SELECT "journeyKey" AS j, "sub", CASE WHEN "decision" = 'SEND' THEN 'S' ELSE 'H' END AS g, min("at") AS at
        FROM "LifecycleMessageDecision" WHERE "market" = ${market} AND "messageClass" = 'MARKETING' AND "at" >= ${lo} AND "at" < ${hi} AND ("decision" = 'SEND' OR "reason" = 'HOLDOUT') GROUP BY 1, 2, 3)
      SELECT j AS journey, g, count(*)::int AS n,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "BookingIntent" b WHERE b."sub" = d."sub" AND b."createdAt" > d.at AND b."createdAt" <= d.at + interval '30 days' AND b."status" <> 'EXPIRED'))::int AS booked
      FROM d GROUP BY 1, 2`);
        const journeys = [...new Set(rows.map((r) => r.journey))].sort();
        const out = [];
        for (const j of journeys) {
            const s = rows.find((r) => r.journey === j && r.g === 'S');
            const h = rows.find((r) => r.journey === j && r.g === 'H');
            if (!s || !h || s.n < recommendation_types_1.RECOMMENDATION_POLICY.k || h.n < recommendation_types_1.RECOMMENDATION_POLICY.k)
                continue;
            out.push({ journey: j, sent: s.n, holdout: h.n, sentBookedBp: Math.round((s.booked * 10_000) / s.n), holdoutBookedBp: Math.round((h.booked * 10_000) / h.n) });
        }
        return out;
    }
    async ltv(market) {
        const rows = await this.prisma.growthLtvEstimate.findMany({ where: { market, cohortKey: { startsWith: 'channel:' }, n: { gte: recommendation_types_1.RECOMMENDATION_POLICY.k }, horizonMonths: 12 }, orderBy: { computedAt: 'desc' }, take: 50 });
        const m = new Map();
        for (const r of rows) {
            const ch = r.cohortKey.slice('channel:'.length);
            if (!m.has(ch))
                m.set(ch, Number(r.estimateMinor));
        }
        return m;
    }
};
exports.RecommendationInputsService = RecommendationInputsService;
exports.RecommendationInputsService = RecommendationInputsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], RecommendationInputsService);
//# sourceMappingURL=recommendation-inputs.service.js.map