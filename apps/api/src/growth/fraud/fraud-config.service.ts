import { DEFAULT_MARKET } from '../../market/market-core-public';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FRAUD_RULES_DEFAULTS, mergeFraudRules, type FraudRulesConfig } from './fraud-config';

/**
 * Reads the `FRAUD_RULES` growth configuration (ACTIVE versions, GLOBAL then MARKET, newest wins per scope). The kind is introduced by contracts 1.13.0; until the maker-checker
 * can store it the in-code PROPOSED_DEFAULT (shadow, nothing enforced) is in force. A bad row never takes scoring down (invalid pieces are ignored one by one).
 */
@Injectable()
export class FraudConfigService {
  private cache = new Map<string, { at: number; cfg: FraudRulesConfig; version: number | null }>();
  constructor(private readonly prisma: PrismaService) {}
  invalidate(): void { this.cache.clear(); }

  async get(market = DEFAULT_MARKET): Promise<FraudRulesConfig & { version: number | null }> {
    const hit = this.cache.get(market);
    const ttl = process.env.NODE_ENV === 'test' ? 0 : 15_000;
    if (hit && Date.now() - hit.at < ttl) return { ...hit.cfg, version: hit.version };
    const now = new Date();
    let cfg = FRAUD_RULES_DEFAULTS(); let version: number | null = null;
    try {
      const rows = await this.prisma.growthConfigVersion.findMany({ where: { kind: 'FRAUD_RULES', status: 'ACTIVE', OR: [{ scope: 'GLOBAL', scopeId: '' }, { scope: 'MARKET', scopeId: market }] }, orderBy: { version: 'asc' } });
      const live = rows.filter((r) => (!r.effectiveFrom || r.effectiveFrom <= now) && (!r.effectiveTo || r.effectiveTo > now));
      for (const scope of ['GLOBAL', 'MARKET'] as const) {
        const last = live.filter((r) => r.scope === scope).pop();
        if (last) { cfg = mergeFraudRules(cfg, last.payload); version = last.version; }
      }
    } catch { /* defaults */ }
    this.cache.set(market, { at: Date.now(), cfg, version });
    return { ...cfg, version };
  }
}
