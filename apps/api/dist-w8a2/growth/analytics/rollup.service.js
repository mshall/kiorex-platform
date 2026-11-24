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
var GrowthRollupService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.GrowthRollupService = exports.BOOKING_ONLY_DIMS = exports.EMPTY_DIMS = exports.VISITOR_STREAM_METRICS = exports.ROLLUP_METRICS = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("../../prisma/generated/client");
const prisma_service_1 = require("../../prisma/prisma.service");
const growth_flags_1 = require("../growth-flags");
exports.ROLLUP_METRICS = [
    'PageViewed', 'SearchStarted', 'ResultsViewed', 'ProviderViewed', 'SlotSelected', 'BookingInitiated', 'BookingConfirmed', 'BookingAttended', 'BookingCancelled',
    'AppInstalled', 'PatientRegistered', 'WidgetLoaded', 'WidgetBookingStarted', 'WhatsAppConversationStarted', 'ConsentGranted',
    'AttendedNewPatient', 'GbvMinor', 'RevenueMinor', 'RevenueReversedMinor', 'CommissionPendingMinor',
];
exports.VISITOR_STREAM_METRICS = ['PageViewed', 'SearchStarted', 'ResultsViewed', 'ProviderViewed', 'AppInstalled', 'WidgetLoaded', 'WidgetBookingStarted', 'WhatsAppConversationStarted', 'ConsentGranted'];
exports.EMPTY_DIMS = { sourceKind: '', landingKind: '', careType: '', origin: '', city: '', district: '', specialty: '', providerRef: '', doctorRef: '', branchRef: '', campaign: '', channel: '', platform: '', product: '', campaignId: '' };
exports.BOOKING_ONLY_DIMS = ['city', 'district', 'specialty', 'providerRef', 'doctorRef', 'branchRef', 'origin', 'channel', 'product'];
const dayStart = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
let GrowthRollupService = class GrowthRollupService {
    static { GrowthRollupService_1 = this; }
    prisma;
    log = new common_1.Logger('growth-rollup');
    constructor(prisma) {
        this.prisma = prisma;
    }
    async rollup(o = {}) {
        const market = o.market ?? growth_flags_1.GROWTH_DEFAULT_MARKET;
        const to = dayStart(o.to ?? new Date());
        const from = dayStart(o.from ?? new Date(to.getTime() - ((o.days ?? 3) - 1) * 86_400_000));
        const end = new Date(to.getTime() + 86_400_000);
        const rows = [...(await this.visitorStream(market, from, end)), ...(await this.bookingFacts(market, from, end)), ...(await this.revenue(market, from, end))];
        const raw = rows.map((r) => ({ market, day: new Date(`${r.day}T00:00:00.000Z`), metric: r.metric, value: Math.min(r.value, 2_147_483_647), sourceKind: r.sourceKind, landingKind: r.landingKind, careType: r.careType, origin: r.origin, city: r.city, district: r.district, specialty: r.specialty, providerRef: r.providerRef, doctorRef: r.doctorRef, branchRef: r.branchRef, campaign: r.campaign, channel: r.channel, platform: r.platform, product: r.product, campaignId: r.campaignId }));
        const merged = new Map();
        for (const r of raw) {
            const k = JSON.stringify([r.day.toISOString(), r.metric, r.sourceKind, r.landingKind, r.careType, r.origin, r.city, r.district, r.specialty, r.providerRef, r.doctorRef, r.branchRef, r.campaign, r.channel, r.platform, r.product, r.campaignId]);
            const e = merged.get(k);
            if (e)
                e.value = Math.min(e.value + r.value, 2_147_483_647);
            else
                merged.set(k, { ...r });
        }
        const data = [...merged.values()];
        const days = data.map((d) => d.day.getTime());
        const delFrom = days.length ? new Date(Math.min(from.getTime(), ...days)) : from;
        const delTo = days.length ? new Date(Math.max(to.getTime(), ...days)) : to;
        await this.prisma.$transaction(async (tx) => {
            await tx.$executeRaw `SELECT pg_advisory_xact_lock(hashtext('growth_rollup'))`;
            await tx.growthMetricDaily.deleteMany({ where: { market, day: { gte: delFrom, lte: delTo }, metric: { in: [...exports.ROLLUP_METRICS] } } });
            for (let i = 0; i < data.length; i += 500)
                await tx.growthMetricDaily.createMany({ data: data.slice(i, i + 500) });
        }, { timeout: 60_000 });
        this.log.log(`rolled up ${data.length} rows for ${from.toISOString().slice(0, 10)}..${to.toISOString().slice(0, 10)}`);
        return { days: Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1, rows: data.length };
    }
    async freshness() {
        const a = await this.prisma.growthMetricDaily.aggregate({ _max: { updatedAt: true } });
        const e = await this.prisma.growthEvent.aggregate({ _max: { occurredAt: true } });
        return { rolledUpAt: a._max.updatedAt?.toISOString() ?? null, lastEventAt: e._max.occurredAt?.toISOString() ?? null };
    }
    async visitorStream(market, from, end) {
        const rows = await this.prisma.$queryRaw(client_1.Prisma.sql `
      SELECT (e."occurredAt" AT TIME ZONE 'UTC')::date AS day, e."name" AS metric, COALESCE(e."careType", '') AS "careType", COALESCE(e."props"->>'landingKind', '') AS "landingKind",
             COALESCE(e."props"->>'platform', '') AS platform, COALESCE(t."kind", '') AS "sourceKind", COALESCE(t."utmCampaign", '') AS campaign, COALESCE(t."campaignId", '') AS "campaignId", count(*)::int AS value
      FROM "GrowthEvent" e
      LEFT JOIN LATERAL (SELECT p."kind", p."utmCampaign", (SELECT CASE WHEN s."sourceKind" = 'CAMPAIGN' THEN s."sourceRef" ELSE '' END FROM "GrowthAcquisitionSource" s WHERE s."id" = p."sourceId") AS "campaignId" FROM "GrowthTouchpoint" p WHERE e."visitorKey" IS NOT NULL AND p."visitorKey" = e."visitorKey" AND p."occurredAt" <= e."occurredAt" ORDER BY p."occurredAt" DESC LIMIT 1) t ON true
      WHERE e."market" = ${market} AND e."bookingId" IS NULL AND e."occurredAt" >= ${from} AND e."occurredAt" < ${end} AND e."name" = ANY(${[...exports.VISITOR_STREAM_METRICS, 'PatientRegistered']})
      GROUP BY 1, 2, 3, 4, 5, 6, 7, 8`);
        return rows.map((r) => ({ ...exports.EMPTY_DIMS, day: r.day.toISOString().slice(0, 10), metric: r.metric, careType: r.careType, landingKind: r.landingKind, platform: r.platform, sourceKind: r.sourceKind, campaign: r.campaign, campaignId: r.campaignId, value: r.value }));
    }
    static BOOKING_DIMS = client_1.Prisma.sql `
      COALESCE(d."origin", b."acquisitionOrigin", 'UNATTRIBUTED') AS origin,
      CASE WHEN t."kind" IS NOT NULL THEN t."kind" WHEN COALESCE(d."origin", b."acquisitionOrigin") = 'PROVIDER_LED' THEN 'PROVIDER_LINK' WHEN b."channel" = 'WHATSAPP' THEN 'WHATSAPP' ELSE 'DIRECT' END AS "sourceKind",
      COALESCE(t."utmCampaign", '') AS campaign, b."channel" AS channel, COALESCE(b."careType", '') AS "careType",
      COALESCE(p."governorate", '') AS city, COALESCE(b."visitDistrict", p."area", '') AS district, COALESCE(p."specialty", '') AS specialty,
      COALESCE(b."tenantId", p."tenantId", '') AS "providerRef", COALESCE(b."clinicianId", '') AS "doctorRef", COALESCE(b."clinicId", '') AS "branchRef",
      COALESCE((SELECT CASE WHEN s."sourceKind" = 'CAMPAIGN' THEN s."sourceRef" END FROM "GrowthAcquisitionSource" s WHERE s."id" = t."sourceId"), '') AS "campaignId"`;
    static BOOKING_JOINS = client_1.Prisma.sql `
      JOIN "BookingIntent" b ON b."id" = x."bookingId" AND b."dependantId" IS NULL
      LEFT JOIN "Provider" p ON p."id" = b."providerId"
      LEFT JOIN LATERAL (SELECT g."origin", g."winningTouchId" FROM "GrowthAttributionDecision" g WHERE g."bookingId" = b."id" AND NOT EXISTS (SELECT 1 FROM "GrowthAttributionDecision" s WHERE s."supersedesId" = g."id") ORDER BY g."createdAt" DESC, g."id" DESC LIMIT 1) d ON true
      LEFT JOIN "GrowthTouchpoint" t ON t."id" = d."winningTouchId"`;
    async bookingFacts(market, from, end) {
        const counts = await this.prisma.$queryRaw(client_1.Prisma.sql `
      SELECT (x."occurredAt" AT TIME ZONE 'UTC')::date AS day, x."name" AS metric, count(*)::int AS value, ${GrowthRollupService_1.BOOKING_DIMS}, COALESCE(x."props"->>'platform', '') AS platform
      FROM "GrowthEvent" x ${GrowthRollupService_1.BOOKING_JOINS}
      WHERE x."market" = ${market} AND x."occurredAt" >= ${from} AND x."occurredAt" < ${end} AND x."bookingId" IS NOT NULL AND x."name" IN ('SlotSelected','BookingInitiated','BookingConfirmed','BookingAttended','BookingCancelled')
      GROUP BY 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16`);
        const anp = await this.prisma.$queryRaw(client_1.Prisma.sql `
      SELECT (x."occurredAt" AT TIME ZONE 'UTC')::date AS day, 'AttendedNewPatient' AS metric, count(*)::int AS value, ${GrowthRollupService_1.BOOKING_DIMS}, COALESCE(x."props"->>'platform', '') AS platform
      FROM "GrowthEvent" x ${GrowthRollupService_1.BOOKING_JOINS}
      WHERE x."market" = ${market} AND x."occurredAt" >= ${from} AND x."occurredAt" < ${end} AND x."bookingId" IS NOT NULL AND x."name" = 'BookingAttended' AND x."props"->>'bucket' = 'new'
      GROUP BY 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16`);
        const gbv = await this.prisma.$queryRaw(client_1.Prisma.sql `
      SELECT (x."occurredAt" AT TIME ZONE 'UTC')::date AS day, 'GbvMinor' AS metric, COALESCE(sum(b."feeMinor"), 0)::int AS value, ${GrowthRollupService_1.BOOKING_DIMS}, COALESCE(x."props"->>'platform', '') AS platform
      FROM "GrowthEvent" x ${GrowthRollupService_1.BOOKING_JOINS}
      WHERE x."market" = ${market} AND x."occurredAt" >= ${from} AND x."occurredAt" < ${end} AND x."bookingId" IS NOT NULL AND x."name" = 'BookingConfirmed'
      GROUP BY 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16`);
        return [...counts, ...anp, ...gbv].map((r) => this.toRow(r));
    }
    async revenue(market, from, end) {
        const rows = await this.prisma.$queryRaw(client_1.Prisma.sql `
      WITH rev AS (
        -- a charge counts once, on the day it first reached a revenue status (CONFIRMED or BILLED); PENDING is reported separately until then; a reversal counts only for a charge that had counted
        SELECT f."id", f."bookingId", f."amountMinor", f."occurredAt", 'RevenueMinor' AS metric FROM "GrowthRevenueFact" f
          WHERE f."market" = ${market} AND f."kind" = 'CHARGE' AND f."status" IN ('CONFIRMED','BILLED')
            AND NOT EXISTS (SELECT 1 FROM "GrowthRevenueFact" e WHERE e."chargeId" = f."chargeId" AND e."kind" = 'CHARGE' AND e."status" IN ('CONFIRMED','BILLED') AND (e."occurredAt" < f."occurredAt" OR (e."occurredAt" = f."occurredAt" AND e."id" < f."id")))
        UNION ALL
        SELECT f."id", f."bookingId", f."amountMinor", f."occurredAt", 'RevenueReversedMinor' FROM "GrowthRevenueFact" f
          WHERE f."market" = ${market} AND f."kind" = 'REVERSAL' AND EXISTS (SELECT 1 FROM "GrowthRevenueFact" e WHERE e."chargeId" = f."chargeId" AND e."kind" = 'CHARGE' AND e."status" IN ('CONFIRMED','BILLED'))
        UNION ALL
        SELECT f."id", f."bookingId", f."amountMinor", f."occurredAt", 'CommissionPendingMinor' FROM "GrowthRevenueFact" f
          WHERE f."market" = ${market} AND f."kind" = 'CHARGE' AND f."status" = 'PENDING'
            AND NOT EXISTS (SELECT 1 FROM "GrowthRevenueFact" e WHERE e."chargeId" = f."chargeId" AND (e."kind" = 'REVERSAL' OR e."status" IN ('CONFIRMED','BILLED','WAIVED')))
      )
      SELECT (x."occurredAt" AT TIME ZONE 'UTC')::date AS day, x.metric AS metric, COALESCE(sum(x."amountMinor"), 0)::int AS value, ${GrowthRollupService_1.BOOKING_DIMS}, '' AS platform
      FROM rev x
      JOIN "BookingIntent" b ON b."id" = x."bookingId" AND b."dependantId" IS NULL
      LEFT JOIN "Provider" p ON p."id" = b."providerId"
      LEFT JOIN LATERAL (SELECT g."origin", g."winningTouchId" FROM "GrowthAttributionDecision" g WHERE g."bookingId" = b."id" AND NOT EXISTS (SELECT 1 FROM "GrowthAttributionDecision" s WHERE s."supersedesId" = g."id") ORDER BY g."createdAt" DESC, g."id" DESC LIMIT 1) d ON true
      LEFT JOIN "GrowthTouchpoint" t ON t."id" = d."winningTouchId"
      WHERE x."occurredAt" >= ${from} AND x."occurredAt" < ${end}
      GROUP BY 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15`);
        return rows.map((r) => this.toRow(r));
    }
    toRow(r) {
        return { ...exports.EMPTY_DIMS, day: r.day.toISOString().slice(0, 10), metric: r.metric, value: r.value, origin: r.origin, sourceKind: r.sourceKind, campaign: r.campaign, channel: r.channel, careType: r.careType, city: r.city, district: r.district, specialty: r.specialty, providerRef: r.providerRef, doctorRef: r.doctorRef, branchRef: r.branchRef, platform: r.platform, campaignId: r.campaignId, product: 'KIOREX_BOOKING' };
    }
};
exports.GrowthRollupService = GrowthRollupService;
exports.GrowthRollupService = GrowthRollupService = GrowthRollupService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], GrowthRollupService);
//# sourceMappingURL=rollup.service.js.map