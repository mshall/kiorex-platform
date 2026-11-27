import { Injectable } from '@nestjs/common';
import { badRequest, conflict } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_LEAD_CONFIG, validateLeadConfig, type LeadConfig } from './lead-config';

const KEY = 'config';
const TTL_MS = 15_000;

/** Reads and saves the join-flow configuration. A missing or unreadable stored document falls back to the shipped defaults (the public form must never break on a bad row). */
@Injectable()
export class LeadConfigService {
  private cache?: { at: number; version: number; config: LeadConfig };
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<{ version: number; config: LeadConfig; updatedAt: Date | null; updatedBy: string | null; isDefault: boolean }> {
    const row = await this.prisma.leadSetting.findUnique({ where: { key: KEY } });
    if (!row) return { version: 0, config: DEFAULT_LEAD_CONFIG, updatedAt: null, updatedBy: null, isDefault: true };
    const v = validateLeadConfig(row.value);
    return { version: row.version, config: v.ok ? v.config : DEFAULT_LEAD_CONFIG, updatedAt: row.updatedAt, updatedBy: row.updatedBy, isDefault: !v.ok };
  }

  /** Cached read for the hot public path. */
  async current(): Promise<LeadConfig> {
    if (this.cache && Date.now() - this.cache.at < TTL_MS) return this.cache.config;
    const g = await this.get();
    this.cache = { at: Date.now(), version: g.version, config: g.config };
    return g.config;
  }
  invalidate() { this.cache = undefined; }

  /** Super admin only (the controller enforces the role). Optimistic concurrency on `expectedVersion`; every save is audited with the changed sections only. */
  async save(actor: string, raw: unknown, expectedVersion: number) {
    const v = validateLeadConfig(raw);
    if (!v.ok) throw badRequest('INVALID_LEAD_CONFIG', 'The configuration is not valid', { errors: v.errors });
    const cur = await this.get();
    if (cur.version !== expectedVersion) throw conflict('LEAD_CONFIG_STALE', 'The configuration changed since you opened it: reload and try again', { version: cur.version });
    const changed = (Object.keys(v.config) as (keyof LeadConfig)[]).filter((k) => JSON.stringify(v.config[k]) !== JSON.stringify(cur.config[k]));
    const next = cur.version + 1;
    if (cur.version === 0) await this.prisma.leadSetting.create({ data: { key: KEY, value: v.config as never, version: next, updatedBy: actor } });
    else {
      const r = await this.prisma.leadSetting.updateMany({ where: { key: KEY, version: cur.version }, data: { value: v.config as never, version: next, updatedBy: actor } });
      if (!r.count) throw conflict('LEAD_CONFIG_STALE', 'The configuration changed since you opened it: reload and try again');
    }
    await this.prisma.auditLog.create({ data: { actor, action: 'lead.config_changed', resource: 'LeadSetting', resourceId: KEY, metadata: { version: next, sections: changed } as never } });
    this.invalidate();
    return this.get();
  }
}
