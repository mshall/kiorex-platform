import { Injectable } from '@nestjs/common';
import { GROWTH_DEFAULT_PAYLOADS } from '../growth/growth-public';
import { ConfigReaders } from '../growth/growth-readers-public';
import { mergeSeoExtensions, SEO_EXTENSION_DEFAULTS, type SeoExtensions } from '../growth/seo/seo-public';
import { PrismaService } from '../prisma/prisma.service';

/** The SEO growth config (contract kind SEO). Defaults are the PROPOSED_DEFAULT payload; an ACTIVE GrowthConfigVersion (MARKET then GLOBAL) overrides it. */
export interface SeoConfig extends SeoExtensions {
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

interface SeoUsed { scope: string; scopeId: string; versionId: string; version: number }
const DEFAULTS = (): SeoConfig => ({ ...(GROWTH_DEFAULT_PAYLOADS.SEO as unknown as SeoConfig), ...SEO_EXTENSION_DEFAULTS() });

/** Merge a stored payload over the defaults, ignoring wrongly typed values (a bad config row never takes the site down). */
export function mergeSeoConfig(base: SeoConfig, payload: unknown): SeoConfig {
  if (!payload || typeof payload !== 'object') return base;
  const out: Record<string, unknown> = { ...base, ...mergeSeoExtensions(base, payload) };
  for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
    if (k in base && !(k in SEO_EXTENSION_DEFAULTS()) && typeof v === typeof (base as unknown as Record<string, unknown>)[k] && (!Array.isArray(v) || Array.isArray((base as unknown as Record<string, unknown>)[k]))) out[k] = v;
  }
  return out as unknown as SeoConfig;
}

@Injectable()
export class SeoConfigService {
  private cache = new Map<string, { at: number; cfg: SeoConfig; used: SeoUsed[] }>();
  /** Propagation monitor (GRW-P1-K): this renderer reports the SEO version it serves, so ops can see a change reach every instance without a redeploy. */
  private readonly readers: ConfigReaders;
  constructor(private readonly prisma: PrismaService) { this.readers = new ConfigReaders(prisma); }

  invalidate(): void { this.cache.clear(); }

  async get(market = 'EG'): Promise<SeoConfig> {
    const hit = this.cache.get(market);
    if (hit && Date.now() - hit.at < 30_000) { await this.report(hit.used); return hit.cfg; }
    const now = new Date();
    let cfg = DEFAULTS();
    const used: SeoUsed[] = [];
    try {
      const rows = await this.prisma.growthConfigVersion.findMany({
        where: { kind: 'SEO', status: 'ACTIVE', OR: [{ scope: 'GLOBAL', scopeId: '' }, { scope: 'MARKET', scopeId: market }] },
        orderBy: { version: 'asc' },
      });
      const live = rows.filter((r) => (!r.effectiveFrom || r.effectiveFrom <= now) && (!r.effectiveTo || r.effectiveTo > now));
      for (const scope of ['GLOBAL', 'MARKET'] as const) {
        const mine = live.filter((x) => x.scope === scope);
        for (const r of mine) cfg = mergeSeoConfig(cfg, r.payload);
        const last = mine[mine.length - 1]; // the newest ACTIVE version of the scope is the one in force
        if (last) used.push({ scope, scopeId: last.scopeId, versionId: last.id, version: last.version });
      }
    } catch { /* defaults: a config read failure must not take the public site down */ }
    this.cache.set(market, { at: Date.now(), cfg, used });
    await this.report(used);
    return cfg;
  }

  private async report(used: SeoUsed[]): Promise<void> {
    for (const u of used) await this.readers.record('seo-renderer', { kind: 'SEO', ...u });
  }
}
