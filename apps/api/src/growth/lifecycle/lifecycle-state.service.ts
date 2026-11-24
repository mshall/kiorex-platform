import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DEFAULT_STAGE_THRESHOLDS, deriveStage, type LifecycleStage, type StageFacts, type StageThresholds } from './lifecycle.stage';

const BOOKED_STATUSES = ['CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW', 'PENDING_CLINIC'];
const DAY = 86_400_000;

/**
 * PatientLifecycle (GRW-P2-E): one non-clinical row per person and market. Derived from booking timestamps and counts only, refreshed by the trigger scan and a nightly reconcile
 * (keyset batches), never by reading what a visit was for. The stage changes are recorded in `stageAt`.
 */
@Injectable()
export class LifecycleStateService {
  private readonly log = new Logger('lifecycle-state');
  constructor(private readonly prisma: PrismaService) {}

  async factsFor(sub: string, now: Date, t: StageThresholds = DEFAULT_STAGE_THRESHOLDS): Promise<(StageFacts & { market: string; platform: string; language: string; hasDependants: boolean }) | null> {
    const profile = await this.prisma.patientProfile.findUnique({ where: { sub }, select: { createdAt: true, market: true, preferredLocale: true, deletedAt: true } });
    if (!profile || profile.deletedAt) return null;
    const intents = await this.prisma.bookingIntent.findMany({ where: { sub }, select: { status: true, createdAt: true, startsAt: true, kiorlyAppointmentId: true } , orderBy: { createdAt: 'desc' }, take: 500 });
    const windowStart = now.getTime() - t.retainedWindowDays * DAY;
    const attended = intents.filter((i) => i.status === 'COMPLETED');
    const booked = intents.filter((i) => BOOKED_STATUSES.includes(i.status) || (i.status === 'CANCELLED' && i.kiorlyAppointmentId !== null));
    const dependants = await this.prisma.dependant.count({ where: { guardianSub: sub } });
    const device = await this.prisma.deviceToken.findFirst({ where: { sub, revokedAt: null }, orderBy: { lastSeenAt: 'desc' }, select: { platform: true } });
    return {
      registeredAt: profile.createdAt,
      lastBookingAt: intents.length ? intents[0]!.createdAt : null,
      lastAttendedAt: attended.length ? attended.reduce((a, b) => (a.startsAt > b.startsAt ? a : b)).startsAt : null,
      intentCount: intents.length, bookedCount: booked.length,
      attendedInWindow: attended.filter((i) => i.startsAt.getTime() >= windowStart).length, attendedTotal: attended.length,
      hasUpcoming: intents.some((i) => ['CONFIRMED', 'PENDING_CLINIC'].includes(i.status) && i.startsAt.getTime() > now.getTime()),
      market: profile.market, platform: (device?.platform ?? '').toLowerCase(), language: profile.preferredLocale === 'en' ? 'en' : 'ar', hasDependants: dependants > 0,
    };
  }

  /** Recompute one person; returns the stage and whether it changed. Erased or unknown people have no row. */
  async refresh(sub: string, now = new Date(), t: StageThresholds = DEFAULT_STAGE_THRESHOLDS): Promise<{ stage: LifecycleStage; changed: boolean; from: LifecycleStage | null } | null> {
    const f = await this.factsFor(sub, now, t);
    if (!f) { await this.prisma.patientLifecycle.deleteMany({ where: { sub } }); return null; }
    const stage = deriveStage(f, now, t);
    const prev = await this.prisma.patientLifecycle.findUnique({ where: { sub_market: { sub, market: f.market } } });
    const data = { stage, registeredAt: f.registeredAt, lastBookingAt: f.lastBookingAt, lastAttendedAt: f.lastAttendedAt, bookingsCount: f.bookedCount, platform: f.platform, language: f.language, hasDependants: f.hasDependants };
    const changed = !prev || prev.stage !== stage;
    await this.prisma.patientLifecycle.upsert({
      where: { sub_market: { sub, market: f.market } },
      create: { sub, market: f.market, ...data, stageAt: now },
      update: { ...data, ...(changed ? { stageAt: now } : {}) },
    });
    return { stage, changed, from: (prev?.stage as LifecycleStage | undefined) ?? null };
  }

  /** Nightly reconcile in keyset batches (`afterSub` cursor); idempotent; also what repairs a missed trigger. Returns the cursor for the next batch (null = done). */
  async reconcileBatch(afterSub: string | null, size = 200, now = new Date()): Promise<{ processed: number; changed: number; next: string | null }> {
    const rows = await this.prisma.patientProfile.findMany({ where: { deletedAt: null, ...(afterSub ? { sub: { gt: afterSub } } : {}) }, orderBy: { sub: 'asc' }, take: size, select: { sub: true } });
    let changed = 0;
    for (const r of rows) { const x = await this.refresh(r.sub, now).catch((e) => { this.log.warn(`refresh failed: ${(e as Error).message}`); return null; }); if (x?.changed) changed++; }
    return { processed: rows.length, changed, next: rows.length === size ? rows[rows.length - 1]!.sub : null };
  }

  /** Funnel counts per stage; a count under k = 10 is withheld (shown as null), so a small market never exposes individuals. */
  async funnel(market: string, k = 10): Promise<Array<{ stage: LifecycleStage; count: number | null }>> {
    const groups = await this.prisma.patientLifecycle.groupBy({ by: ['stage'], where: { market }, _count: { _all: true } });
    const m = new Map(groups.map((g) => [g.stage, g._count._all]));
    return (['REGISTERED', 'ACTIVATED', 'BOOKED', 'ATTENDED', 'RETAINED', 'DORMANT', 'CHURNED'] as LifecycleStage[]).map((stage) => { const c = m.get(stage) ?? 0; return { stage, count: c >= k ? c : null }; });
  }
}
