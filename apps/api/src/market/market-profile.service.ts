import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeMarketProfile, validateMarketProfile, type MarketProfile } from './market-profile';
import { marketProfileSnapshot, setMarketProfileSnapshot } from './market-registry';

/**
 * Resolver behind the registry (GRW-P3-G, AD-12): loads the in-force `MARKET_PROFILE` growth configuration versions (scope MARKET, one per country) into the synchronous
 * snapshot that `marketFacts`, `marketTimezone` and the quiet-hours default read. A row that fails validation is skipped (the code fallback, if any, still answers) and logged,
 * so a bad version can never take a market down. The snapshot refreshes on boot, every `MARKET_PROFILE_REFRESH_MS` (default 15 s) and right after the wizard publishes.
 * Reads the table directly: the config service lives in the growth module, which depends on this one.
 */
@Injectable()
export class MarketProfileService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('MarketProfile');
  private timer?: NodeJS.Timeout;
  private loadedAt = 0;
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.refresh().catch((e) => this.log.warn(`first load failed: ${(e as Error).message}`));
    const ms = Number(process.env.MARKET_PROFILE_REFRESH_MS ?? 15_000);
    if (process.env.NODE_ENV !== 'test' && Number.isFinite(ms) && ms > 0) { this.timer = setInterval(() => void this.refresh().catch(() => undefined), ms); this.timer.unref(); }
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  /** Reloads the snapshot; returns the profiles now in force from configuration. */
  async refresh(now = new Date()): Promise<MarketProfile[]> {
    const rows = await this.prisma.growthConfigVersion.findMany({
      where: { kind: 'MARKET_PROFILE', scope: 'MARKET', status: { in: ['ACTIVE', 'APPROVED'] }, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
      orderBy: [{ scopeId: 'asc' }, { effectiveFrom: 'desc' }, { version: 'desc' }],
    });
    const out = new Map<string, MarketProfile>();
    for (const r of rows) {
      if (out.has(r.scopeId)) continue;
      const errs = validateMarketProfile(r.payload);
      const p = r.payload as { cc?: string };
      if (errs.length || p.cc !== r.scopeId) { this.log.warn(`MARKET_PROFILE ${r.scopeId} v${r.version} ignored: ${errs[0] ?? 'cc differs from the scope'}`); continue; }
      out.set(r.scopeId, normalizeMarketProfile(r.payload as Record<string, unknown>));
    }
    const list = [...out.values()]; setMarketProfileSnapshot(list); this.loadedAt = Date.now();
    return list;
  }
  /** Cheap staleness guard for request paths (the interval does the normal work). */
  async ensureFresh(maxAgeMs = 5000): Promise<void> { if (Date.now() - this.loadedAt > maxAgeMs) await this.refresh().catch(() => undefined); }
  configured(): readonly MarketProfile[] { return marketProfileSnapshot(); }
}
