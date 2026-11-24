import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { applyKAnonymity, maskCount, type Masked } from '../analytics/kanon';
import { GROWTH_DEFAULT_MARKET } from '../growth-flags';
import { CONTINUITY_ENTRY_KINDS, ENTRY_META, LAG_BUCKETS, lagBucket, type ContinuityEntryKind } from './continuity-rules';
import { CrossProductService } from './continuity.service';

const DAY = 86_400_000;
const isMasked = (v: Masked) => typeof v === 'string';

/**
 * Funnel read model for the ops pages (GRW-P4-A): clinic visit -> continuity prompt offered -> continued downstream (pharmacy, lab, home visit), by the source of the first booking and by time
 * to continue. COUNTS ONLY, k >= 10 with secondary suppression; no specialty, clinic, item, person or fact id. The commission link of products is inert and no reward exists for a downstream fact.
 */
@Injectable()
export class CrossProductFunnelService {
  constructor(private readonly prisma: PrismaService, private readonly cross: CrossProductService) {}

  async funnel(days = 30, market = GROWTH_DEFAULT_MARKET) {
    const d = Math.min(Math.max(Math.trunc(days) || 30, 1), 365);
    const since = new Date(Date.now() - d * DAY);
    const [visits, offeredRows, dismissedRows, links] = await Promise.all([
      this.prisma.bookingIntent.count({ where: { status: 'COMPLETED', dependantId: null, startsAt: { gte: since, lte: new Date() } } }),
      this.prisma.crossProductEntryPoint.groupBy({ by: ['kind'], where: { market, createdAt: { gte: since } }, _count: { _all: true } }),
      this.prisma.crossProductEntryPoint.groupBy({ by: ['kind'], where: { market, createdAt: { gte: since }, dismissedAt: { not: null }, consumedAt: null }, _count: { _all: true } }),
      this.prisma.crossProductContinuity.findMany({ where: { market, createdAt: { gte: since } }, select: { entryPoint: true, parentOrigin: true, lagHours: true, toOrigin: true }, take: 50_000 }),
    ]);
    const n = (rows: { kind: string; _count: { _all: number } }[], k: string) => rows.find((r) => r.kind === k)?._count._all ?? 0;
    const continuedRaw = (k: ContinuityEntryKind) => links.filter((l) => l.entryPoint === k).length;
    const offeredCells = applyKAnonymity(CONTINUITY_ENTRY_KINDS.map((k) => ({ key: k, count: n(offeredRows, k) })), { totalShown: false }); // three independent measures, no total is shown: no differencing between products
    const continuedCells = applyKAnonymity(CONTINUITY_ENTRY_KINDS.map((k) => ({ key: k, count: continuedRaw(k) })), { totalShown: false });
    const products = CONTINUITY_ENTRY_KINDS.map((k, i) => {
      const mine = links.filter((l) => l.entryPoint === k);
      const origins = applyKAnonymity(['PROVIDER_LED', 'MARKETPLACE', 'UNATTRIBUTED'].map((o) => ({ key: o, count: mine.filter((l) => l.parentOrigin === o).length })));
      const lag = applyKAnonymity(LAG_BUCKETS.map((b) => ({ key: b, count: mine.filter((l) => lagBucket(l.lagHours) === b).length })));
      const offered = offeredCells[i]!.count; const continued = continuedCells[i]!.count; const dismissed = maskCount(n(dismissedRows, k));
      const raw = { offered: n(offeredRows, k), continued: mine.length, dismissed: n(dismissedRows, k) };
      // drop-off is derived: hidden when any of the three counts it rests on is masked (no subtraction can recover a small cell)
      const dropOff: Masked = isMasked(offered) || isMasked(continued) || isMasked(dismissed) ? '<10' : Math.max(0, raw.offered - raw.continued - raw.dismissed);
      return {
        product: ENTRY_META[k].toProduct, entryPoint: k, offered, dismissed, continued, notContinued: dropOff,
        bySourceOfFirstBooking: Object.fromEntries(origins.map((c) => [c.key, c.count])),
        timeToContinue: Object.fromEntries(lag.map((c) => [c.key, c.count])),
      };
    });
    return {
      days: d, market, enabled: await this.cross.isOn(market),
      clinicVisitsCompleted: maskCount(visits),
      products,
      /** the package never creates a reward or a referral qualification, and the commission link of products is inert (AD-13) */
      rewards: 'NONE' as const, commissionLink: 'INERT' as const,
    };
  }
}
