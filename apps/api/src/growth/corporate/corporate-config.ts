import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GROWTH_DEFAULT_MARKET } from '../growth-flags';
import { K_FLOOR } from './corporate-privacy';

/**
 * `CORPORATE_POLICY` growth configuration (work package P4-C; the contract kind joins with the unreleased 1.14.0 set, so it is validated here like the wave 7 kinds until the vendored contracts carry it).
 * It holds NO price, discount value or ceiling: those are per-account terms an ops user enters after a signed contract (NEEDS_HUMAN H-16). Defaults are PROPOSED_DEFAULT and the safest ones:
 * open codes on, the two identity-backed paths on but dependent on verified data, SPONSOR_CREDIT funding, k = 10, a 30-day HR match window (retention: counsel to confirm).
 */
export interface CorporatePolicy {
  enabled: boolean;
  eligibility: { openCode: boolean; domainEmail: boolean; hrList: boolean };
  fundingMode: 'SPONSOR_CREDIT' | 'PLATFORM_PROMO';
  minAggregateK: number;
  codeFormat: { length: number; groupSize: number };
  hrList: { matchWindowDays: number; maxRows: number };
}
export const CORPORATE_POLICY_DEFAULTS = (): CorporatePolicy => ({
  enabled: true,
  eligibility: { openCode: true, domainEmail: true, hrList: true },
  fundingMode: 'SPONSOR_CREDIT',
  minAggregateK: K_FLOOR,
  codeFormat: { length: 10, groupSize: 5 },
  hrList: { matchWindowDays: 30, maxRows: 5000 },
});

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const int = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

/** Same contract as the JSON Schema `CORPORATE_POLICY.schema.json` of the unreleased contracts set: unknown keys rejected, the aggregate floor cannot go below 10. */
export function validateCorporatePolicy(payload: unknown): { errors: string[] } {
  const errors: string[] = [];
  if (!isObj(payload)) return { errors: ['payload must be an object'] };
  const top = ['enabled', 'eligibility', 'fundingMode', 'minAggregateK', 'codeFormat', 'hrList'];
  for (const k of Object.keys(payload)) if (!top.includes(k)) errors.push(`unknown key ${k}`);
  if ('enabled' in payload && typeof payload.enabled !== 'boolean') errors.push('enabled must be a boolean');
  if ('fundingMode' in payload && !['SPONSOR_CREDIT', 'PLATFORM_PROMO'].includes(payload.fundingMode as string)) errors.push('fundingMode must be SPONSOR_CREDIT or PLATFORM_PROMO');
  if ('minAggregateK' in payload && !int(payload.minAggregateK, K_FLOOR, 1000)) errors.push(`minAggregateK must be an integer from ${K_FLOOR} to 1000`);
  const sub = (key: string, allowed: Record<string, (v: unknown) => boolean>) => {
    if (!(key in payload)) return;
    const o = payload[key];
    if (!isObj(o)) { errors.push(`${key} must be an object`); return; }
    for (const [k, v] of Object.entries(o)) { if (!(k in allowed)) errors.push(`unknown key ${key}.${k}`); else if (!allowed[k](v)) errors.push(`${key}.${k} is invalid`); }
  };
  const bool = (v: unknown) => typeof v === 'boolean';
  sub('eligibility', { openCode: bool, domainEmail: bool, hrList: bool });
  sub('codeFormat', { length: (v) => int(v, 8, 16), groupSize: (v) => int(v, 0, 8) });
  sub('hrList', { matchWindowDays: (v) => int(v, 1, 90), maxRows: (v) => int(v, 1, 100000) });
  return { errors };
}

export function mergeCorporatePolicy(base: CorporatePolicy, over: unknown): CorporatePolicy {
  if (!isObj(over) || validateCorporatePolicy(over).errors.length) return base;
  const o = over as Partial<CorporatePolicy>;
  return {
    enabled: o.enabled ?? base.enabled, fundingMode: o.fundingMode ?? base.fundingMode, minAggregateK: Math.max(K_FLOOR, o.minAggregateK ?? base.minAggregateK),
    eligibility: { ...base.eligibility, ...(o.eligibility ?? {}) }, codeFormat: { ...base.codeFormat, ...(o.codeFormat ?? {}) }, hrList: { ...base.hrList, ...(o.hrList ?? {}) },
  };
}

/** Reads the ACTIVE `CORPORATE_POLICY` versions (GLOBAL then MARKET, newest wins per scope). A bad row never takes the programme down: invalid versions are ignored and the defaults answer. */
@Injectable()
export class CorporateConfigService {
  constructor(private readonly prisma: PrismaService) {}
  async get(market = GROWTH_DEFAULT_MARKET, now = new Date()): Promise<CorporatePolicy> {
    let cfg = CORPORATE_POLICY_DEFAULTS();
    try {
      const rows = await this.prisma.growthConfigVersion.findMany({ where: { kind: 'CORPORATE_POLICY', status: 'ACTIVE', OR: [{ scope: 'GLOBAL', scopeId: '' }, { scope: 'MARKET', scopeId: market }] }, orderBy: { version: 'asc' } });
      const live = rows.filter((r) => (!r.effectiveFrom || r.effectiveFrom <= now) && (!r.effectiveTo || r.effectiveTo > now));
      for (const scope of ['GLOBAL', 'MARKET'] as const) { const last = live.filter((r) => r.scope === scope).pop(); if (last) cfg = mergeCorporatePolicy(cfg, last.payload); }
    } catch { /* defaults */ }
    return cfg;
  }
}
