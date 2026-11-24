import { Injectable } from '@nestjs/common';
import { ConfigReaders } from '../growth/growth-readers-public';
import { PrismaService } from '../prisma/prisma.service';

export interface WidgetPolicy {
  maxOriginsPerOrg: number; allowLocalhostOrigins: boolean; sessionTokenTtlSeconds: number; maxActiveHoldsPerPhone: number; maxActiveHoldsPerIpHash: number; embedHost: string; sdkCacheSeconds: number;
}

/** PROPOSED_DEFAULT of WIDGET_POLICY (contracts growth-config schema; identical to `growth-defaults.ts`, asserted by widget-policy.unit.spec.ts). */
export const WIDGET_POLICY_DEFAULT: WidgetPolicy = {
  maxOriginsPerOrg: 10, allowLocalhostOrigins: false, sessionTokenTtlSeconds: 900, maxActiveHoldsPerPhone: 3, maxActiveHoldsPerIpHash: 5, embedHost: 'https://book.kiorex.com', sdkCacheSeconds: 31536000,
};

/**
 * WIDGET_POLICY from the versioned growth config. Read straight from `GrowthConfigVersion` (the ACTIVE row of the market, else the global one, else the proposed default):
 * the widget module must not import the growth barrel because booking, patient and growth form a load-order cycle (see growth/growth-ports.ts). Maker-checker, effective dates
 * and rollback stay with GrowthConfigService (package B/K); this service only reads the result. Cached for 30 s.
 */
@Injectable()
export class WidgetPolicyService {
  private cache?: { at: number; value: WidgetPolicy; used?: { scope: string; scopeId: string; versionId: string; version: number } };
  /** Propagation monitor (GRW-P1-K): the widget host reports which WIDGET_POLICY version it serves. */
  private readonly readers: ConfigReaders;
  constructor(private readonly prisma: PrismaService) { this.readers = new ConfigReaders(prisma); }
  private async report(u?: { scope: string; scopeId: string; versionId: string; version: number }) { if (u) await this.readers.record('widget-host', { kind: 'WIDGET_POLICY', ...u }); }
  async get(): Promise<WidgetPolicy> {
    if (this.cache && Date.now() - this.cache.at < 30_000) { await this.report(this.cache.used); return this.cache.value; }
    const now = new Date();
    let value = WIDGET_POLICY_DEFAULT;
    let used: { scope: string; scopeId: string; versionId: string; version: number } | undefined;
    for (const [scope, scopeId] of [['MARKET', 'EG'], ['GLOBAL', '']] as const) {
      const row = await this.prisma.growthConfigVersion.findFirst({
        where: { kind: 'WIDGET_POLICY', scope, scopeId, status: 'ACTIVE', effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (row) { value = { ...WIDGET_POLICY_DEFAULT, ...(row.payload as Partial<WidgetPolicy>) }; used = { scope, scopeId, versionId: row.id, version: row.version }; break; }
    }
    this.cache = { at: now.getTime(), value, used };
    await this.report(used);
    return value;
  }
  invalidate() { this.cache = undefined; }
}
