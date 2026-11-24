import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GROWTH_DEFAULT_MARKET } from '../growth-flags';

/** The metric names a rollup owns (a rerun replaces exactly these rows for the window and nothing else). */
export const ROLLUP_METRICS = [
  'PageViewed', 'SearchStarted', 'ResultsViewed', 'ProviderViewed', 'SlotSelected', 'BookingInitiated', 'BookingConfirmed', 'BookingAttended', 'BookingCancelled',
  'AppInstalled', 'PatientRegistered', 'WidgetLoaded', 'WidgetBookingStarted', 'WhatsAppConversationStarted', 'ConsentGranted',
  'AttendedNewPatient', 'GbvMinor', 'RevenueMinor', 'RevenueReversedMinor', 'CommissionPendingMinor',
] as const;
export type RollupMetric = (typeof ROLLUP_METRICS)[number];

/** Funnel stages up to ProviderViewed are the anonymous visitor stream: by care type and market only. From SlotSelected the facts are server-side and keyed to the booking. */
export const VISITOR_STREAM_METRICS = ['PageViewed', 'SearchStarted', 'ResultsViewed', 'ProviderViewed', 'AppInstalled', 'WidgetLoaded', 'WidgetBookingStarted', 'WhatsAppConversationStarted', 'ConsentGranted'] as const;

export interface Dims {
  sourceKind: string; landingKind: string; careType: string; origin: string; city: string; district: string; specialty: string;
  providerRef: string; doctorRef: string; branchRef: string; campaign: string; channel: string; platform: string; product: string;
}
export const EMPTY_DIMS: Dims = { sourceKind: '', landingKind: '', careType: '', origin: '', city: '', district: '', specialty: '', providerRef: '', doctorRef: '', branchRef: '', campaign: '', channel: '', platform: '', product: '' };
/** Dimensions a visitor-stream row may NEVER carry: specialty, provider, doctor, branch, place. (A test asserts it on real rows.) */
export const BOOKING_ONLY_DIMS = ['city', 'district', 'specialty', 'providerRef', 'doctorRef', 'branchRef', 'origin', 'channel', 'product'] as const;

export interface RollupRow extends Dims { day: string; metric: RollupMetric; value: number }

const dayStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * Daily rollups into `GrowthMetricDaily` (GRW-P1-J). Idempotent: one transaction deletes the window's rows for the owned metrics and inserts the recomputed ones, so
 * running it twice (or concurrently) gives identical rows. Reads only pseudonymous or aggregate-able columns; never a `sub`, visitor key, phone, name or address leaves this
 * service: the output dimensions are enums, business ids (organisation, branch, doctor listing) and place names. Dependants never enter (`dependantId IS NULL`).
 */
@Injectable()
export class GrowthRollupService {
  private readonly log = new Logger('growth-rollup');
  constructor(private readonly prisma: PrismaService) {}

  /** Recompute [from, to] (inclusive days, UTC). Default: the last `days` days including today. */
  async rollup(o: { from?: Date; to?: Date; days?: number; market?: string } = {}): Promise<{ days: number; rows: number }> {
    const market = o.market ?? GROWTH_DEFAULT_MARKET;
    const to = dayStart(o.to ?? new Date());
    const from = dayStart(o.from ?? new Date(to.getTime() - ((o.days ?? 3) - 1) * 86_400_000));
    const end = new Date(to.getTime() + 86_400_000);
    const rows = [...(await this.visitorStream(market, from, end)), ...(await this.bookingFacts(market, from, end)), ...(await this.revenue(market, from, end))];
    const data = rows.map((r) => ({ market, day: new Date(`${r.day}T00:00:00.000Z`), metric: r.metric, value: Math.min(r.value, 2_147_483_647), sourceKind: r.sourceKind, landingKind: r.landingKind, careType: r.careType, origin: r.origin, city: r.city, district: r.district, specialty: r.specialty, providerRef: r.providerRef, doctorRef: r.doctorRef, branchRef: r.branchRef, campaign: r.campaign, channel: r.channel, platform: r.platform, product: r.product }));
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('growth_rollup'))`; // two rollups (job and a manual trigger) never interleave their delete and insert
      await tx.growthMetricDaily.deleteMany({ where: { market, day: { gte: from, lte: to }, metric: { in: [...ROLLUP_METRICS] } } });
      for (let i = 0; i < data.length; i += 500) await tx.growthMetricDaily.createMany({ data: data.slice(i, i + 500) });
    }, { timeout: 60_000 });
    this.log.log(`rolled up ${data.length} rows for ${from.toISOString().slice(0, 10)}..${to.toISOString().slice(0, 10)}`);
    return { days: Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1, rows: data.length };
  }

  /** Newest rollup write, for the freshness line. */
  async freshness(): Promise<{ rolledUpAt: string | null; lastEventAt: string | null }> {
    const a = await this.prisma.growthMetricDaily.aggregate({ _max: { updatedAt: true } });
    const e = await this.prisma.growthEvent.aggregate({ _max: { occurredAt: true } });
    return { rolledUpAt: a._max.updatedAt?.toISOString() ?? null, lastEventAt: e._max.occurredAt?.toISOString() ?? null };
  }

  private async visitorStream(market: string, from: Date, end: Date): Promise<RollupRow[]> {
    // sourceKind and campaign only with a consented visitor key (the key joins the latest touch before the event); otherwise ''. NO specialty, provider or place.
    const rows = await this.prisma.$queryRaw<Array<{ day: Date; metric: string; careType: string; landingKind: string; platform: string; sourceKind: string; campaign: string; value: number }>>(Prisma.sql`
      SELECT (e."occurredAt" AT TIME ZONE 'UTC')::date AS day, e."name" AS metric, COALESCE(e."careType", '') AS "careType", COALESCE(e."props"->>'landingKind', '') AS "landingKind",
             COALESCE(e."props"->>'platform', '') AS platform, COALESCE(t."kind", '') AS "sourceKind", COALESCE(t."utmCampaign", '') AS campaign, count(*)::int AS value
      FROM "GrowthEvent" e
      LEFT JOIN LATERAL (SELECT p."kind", p."utmCampaign" FROM "GrowthTouchpoint" p WHERE e."visitorKey" IS NOT NULL AND p."visitorKey" = e."visitorKey" AND p."occurredAt" <= e."occurredAt" ORDER BY p."occurredAt" DESC LIMIT 1) t ON true
      WHERE e."market" = ${market} AND e."bookingId" IS NULL AND e."occurredAt" >= ${from} AND e."occurredAt" < ${end} AND e."name" = ANY(${[...VISITOR_STREAM_METRICS, 'PatientRegistered']})
      GROUP BY 1, 2, 3, 4, 5, 6, 7`);
    return rows.map((r) => ({ ...EMPTY_DIMS, day: r.day.toISOString().slice(0, 10), metric: r.metric as RollupMetric, careType: r.careType, landingKind: r.landingKind, platform: r.platform, sourceKind: r.sourceKind, campaign: r.campaign, value: r.value }));
  }

  /** The per-booking dimensions, one expression set reused by the booking and the revenue queries. */
  private static readonly BOOKING_DIMS = Prisma.sql`
      COALESCE(d."origin", b."acquisitionOrigin", 'UNATTRIBUTED') AS origin,
      CASE WHEN t."kind" IS NOT NULL THEN t."kind" WHEN COALESCE(d."origin", b."acquisitionOrigin") = 'PROVIDER_LED' THEN 'PROVIDER_LINK' WHEN b."channel" = 'WHATSAPP' THEN 'WHATSAPP' ELSE 'DIRECT' END AS "sourceKind",
      COALESCE(t."utmCampaign", '') AS campaign, b."channel" AS channel, COALESCE(b."careType", '') AS "careType",
      COALESCE(p."governorate", '') AS city, COALESCE(b."visitDistrict", p."area", '') AS district, COALESCE(p."specialty", '') AS specialty,
      COALESCE(b."tenantId", p."tenantId", '') AS "providerRef", COALESCE(b."clinicianId", '') AS "doctorRef", COALESCE(b."clinicId", '') AS "branchRef"`;
  private static readonly BOOKING_JOINS = Prisma.sql`
      JOIN "BookingIntent" b ON b."id" = x."bookingId" AND b."dependantId" IS NULL
      LEFT JOIN "Provider" p ON p."id" = b."providerId"
      LEFT JOIN LATERAL (SELECT g."origin", g."winningTouchId" FROM "GrowthAttributionDecision" g WHERE g."bookingId" = b."id" AND NOT EXISTS (SELECT 1 FROM "GrowthAttributionDecision" s WHERE s."supersedesId" = g."id") ORDER BY g."createdAt" DESC, g."id" DESC LIMIT 1) d ON true
      LEFT JOIN "GrowthTouchpoint" t ON t."id" = d."winningTouchId"`;

  private async bookingFacts(market: string, from: Date, end: Date): Promise<RollupRow[]> {
    type R = { day: Date; metric: string; value: number; origin: string; sourceKind: string; campaign: string; channel: string; careType: string; city: string; district: string; specialty: string; providerRef: string; doctorRef: string; branchRef: string; platform: string };
    // plain count per canonical server event
    const counts = await this.prisma.$queryRaw<R[]>(Prisma.sql`
      SELECT (x."occurredAt" AT TIME ZONE 'UTC')::date AS day, x."name" AS metric, count(*)::int AS value, ${GrowthRollupService.BOOKING_DIMS}, COALESCE(x."props"->>'platform', '') AS platform
      FROM "GrowthEvent" x ${GrowthRollupService.BOOKING_JOINS}
      WHERE x."market" = ${market} AND x."occurredAt" >= ${from} AND x."occurredAt" < ${end} AND x."bookingId" IS NOT NULL AND x."name" IN ('SlotSelected','BookingInitiated','BookingConfirmed','BookingAttended','BookingCancelled')
      GROUP BY 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15`);
    const anp = await this.prisma.$queryRaw<R[]>(Prisma.sql`
      SELECT (x."occurredAt" AT TIME ZONE 'UTC')::date AS day, 'AttendedNewPatient' AS metric, count(*)::int AS value, ${GrowthRollupService.BOOKING_DIMS}, COALESCE(x."props"->>'platform', '') AS platform
      FROM "GrowthEvent" x ${GrowthRollupService.BOOKING_JOINS}
      WHERE x."market" = ${market} AND x."occurredAt" >= ${from} AND x."occurredAt" < ${end} AND x."bookingId" IS NOT NULL AND x."name" = 'BookingAttended' AND x."props"->>'bucket' = 'new'
      GROUP BY 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15`);
    // gross booking value: the visit fee of CONFIRMED bookings. A volume indicator, NEVER revenue (its own metric name, never summed into RevenueMinor).
    const gbv = await this.prisma.$queryRaw<R[]>(Prisma.sql`
      SELECT (x."occurredAt" AT TIME ZONE 'UTC')::date AS day, 'GbvMinor' AS metric, COALESCE(sum(b."feeMinor"), 0)::int AS value, ${GrowthRollupService.BOOKING_DIMS}, COALESCE(x."props"->>'platform', '') AS platform
      FROM "GrowthEvent" x ${GrowthRollupService.BOOKING_JOINS}
      WHERE x."market" = ${market} AND x."occurredAt" >= ${from} AND x."occurredAt" < ${end} AND x."bookingId" IS NOT NULL AND x."name" = 'BookingConfirmed'
      GROUP BY 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15`);
    return [...counts, ...anp, ...gbv].map((r) => this.toRow(r));
  }

  private async revenue(market: string, from: Date, end: Date): Promise<RollupRow[]> {
    type R = { day: Date; metric: string; value: number; origin: string; sourceKind: string; campaign: string; channel: string; careType: string; city: string; district: string; specialty: string; providerRef: string; doctorRef: string; branchRef: string; platform: string };
    const rows = await this.prisma.$queryRaw<R[]>(Prisma.sql`
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
      SELECT (x."occurredAt" AT TIME ZONE 'UTC')::date AS day, x.metric AS metric, COALESCE(sum(x."amountMinor"), 0)::int AS value, ${GrowthRollupService.BOOKING_DIMS}, '' AS platform
      FROM rev x
      JOIN "BookingIntent" b ON b."id" = x."bookingId" AND b."dependantId" IS NULL
      LEFT JOIN "Provider" p ON p."id" = b."providerId"
      LEFT JOIN LATERAL (SELECT g."origin", g."winningTouchId" FROM "GrowthAttributionDecision" g WHERE g."bookingId" = b."id" AND NOT EXISTS (SELECT 1 FROM "GrowthAttributionDecision" s WHERE s."supersedesId" = g."id") ORDER BY g."createdAt" DESC, g."id" DESC LIMIT 1) d ON true
      LEFT JOIN "GrowthTouchpoint" t ON t."id" = d."winningTouchId"
      WHERE x."occurredAt" >= ${from} AND x."occurredAt" < ${end}
      GROUP BY 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14`);
    return rows.map((r) => this.toRow(r));
  }

  private toRow(r: { day: Date; metric: string; value: number; origin: string; sourceKind: string; campaign: string; channel: string; careType: string; city: string; district: string; specialty: string; providerRef: string; doctorRef: string; branchRef: string; platform: string }): RollupRow {
    return { ...EMPTY_DIMS, day: r.day.toISOString().slice(0, 10), metric: r.metric as RollupMetric, value: r.value, origin: r.origin, sourceKind: r.sourceKind, campaign: r.campaign, channel: r.channel, careType: r.careType, city: r.city, district: r.district, specialty: r.specialty, providerRef: r.providerRef, doctorRef: r.doctorRef, branchRef: r.branchRef, platform: r.platform, product: 'KIOREX_BOOKING' };
  }
}
