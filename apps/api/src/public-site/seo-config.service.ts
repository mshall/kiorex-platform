import { Injectable } from '@nestjs/common';
import { GROWTH_DEFAULT_PAYLOADS } from '../growth/growth-public';
import { PrismaService } from '../prisma/prisma.service';

/** The SEO growth config (contract kind SEO). Defaults are the PROPOSED_DEFAULT payload; an ACTIVE GrowthConfigVersion (MARKET then GLOBAL) overrides it. */
export interface SeoConfig {
  canonicalHost: string;
  locales: string[];
  defaultLocale: string;
  minLiveProviders: number;
  minUniqueBlocks: number;
  maxSiblingSimilarityPercent: number;
  sitemapShardSize: number;
  edgeCacheSeconds: number;
  staleWhileRevalidateSeconds: number;
  delistedGoneAfterDays: number;
  reviewMarkupEnabled: boolean;
  districtPagesEnabled: boolean;
}

const DEFAULTS = (): SeoConfig => ({ ...(GROWTH_DEFAULT_PAYLOADS.SEO as unknown as SeoConfig) });

/** Merge a stored payload over the defaults, ignoring wrongly typed values (a bad config row never takes the site down). */
export function mergeSeoConfig(base: SeoConfig, payload: unknown): SeoConfig {
  if (!payload || typeof payload !== 'object') return base;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
    if (k in base && typeof v === typeof (base as unknown as Record<string, unknown>)[k] && (!Array.isArray(v) || Array.isArray((base as unknown as Record<string, unknown>)[k]))) out[k] = v;
  }
  return out as unknown as SeoConfig;
}

@Injectable()
export class SeoConfigService {
  private cache = new Map<string, { at: number; cfg: SeoConfig }>();
  constructor(private readonly prisma: PrismaService) {}

  invalidate(): void { this.cache.clear(); }

  async get(market = 'EG'): Promise<SeoConfig> {
    const hit = this.cache.get(market);
    if (hit && Date.now() - hit.at < 30_000) return hit.cfg;
    const now = new Date();
    let cfg = DEFAULTS();
    try {
      const rows = await this.prisma.growthConfigVersion.findMany({
        where: { kind: 'SEO', status: 'ACTIVE', OR: [{ scope: 'GLOBAL', scopeId: '' }, { scope: 'MARKET', scopeId: market }] },
        orderBy: { version: 'asc' },
      });
      const live = rows.filter((r) => (!r.effectiveFrom || r.effectiveFrom <= now) && (!r.effectiveTo || r.effectiveTo > now));
      for (const r of live.filter((x) => x.scope === 'GLOBAL')) cfg = mergeSeoConfig(cfg, r.payload);
      for (const r of live.filter((x) => x.scope === 'MARKET')) cfg = mergeSeoConfig(cfg, r.payload);
    } catch { /* defaults: a config read failure must not take the public site down */ }
    this.cache.set(market, { at: Date.now(), cfg });
    return cfg;
  }
}
