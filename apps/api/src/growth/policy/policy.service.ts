import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GrowthConfigService } from '../config/growth-config.service';
import { POLICY_KINDS, clearPolicyOverrides, policyNow, policyVersion, setPolicyOverride, validatePolicy, type PolicyKind } from './policy-registry';

/**
 * Feeds the policy registry from the maker-checker config rows (ACTIVE, or APPROVED whose effective time has come; GLOBAL scope). A stored payload that fails today's validator
 * is ignored and logged by kind (never its content): the defaults that shipped keep running. Refreshes on start, every REFRESH_MS, and right after any config transition.
 */
export const POLICY_REFRESH_MS = 15_000;

@Injectable()
export class GrowthPolicyService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('policy');
  private timer?: NodeJS.Timeout;
  constructor(private readonly prisma: PrismaService, private readonly config: GrowthConfigService) {}

  onModuleInit(): void {
    GrowthConfigService.onChange.push(this.listener);
    void this.refresh();
    if (process.env.NODE_ENV !== 'test') { this.timer = setInterval(() => void this.refresh(), POLICY_REFRESH_MS); this.timer.unref?.(); }
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    const i = GrowthConfigService.onChange.indexOf(this.listener); if (i >= 0) GrowthConfigService.onChange.splice(i, 1);
  }
  private readonly listener = () => { void this.refresh(); };

  async refresh(now = new Date()): Promise<void> {
    try {
      const rows = await this.prisma.growthConfigVersion.findMany({
        where: { kind: { in: [...POLICY_KINDS] }, scope: 'GLOBAL', scopeId: '', status: { in: ['ACTIVE', 'APPROVED'] }, OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }], AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }] },
        orderBy: { version: 'asc' },
      });
      for (const kind of POLICY_KINDS) {
        const last = rows.filter((r) => r.kind === kind).pop();
        if (!last) { setPolicyOverride(kind, null); continue; }
        const ok = setPolicyOverride(kind, last.payload as Record<string, unknown>, last.version);
        if (!ok) { setPolicyOverride(kind, null); this.log.warn(`stored ${kind} v${last.version} fails validation and is ignored; code defaults stay in force`); }
      }
    } catch (e) { this.log.warn(`policy refresh failed: ${(e as Error).message}`); }
  }

  /** What is in force for a kind, for the ops pages and the catalogue endpoint. */
  inForce(kind: PolicyKind): { kind: PolicyKind; version: number | null; payload: Record<string, unknown> } { return { kind, version: policyVersion(kind), payload: policyNow(kind) }; }
  validate(kind: string, payload: unknown): string[] { return validatePolicy(kind, payload); }
  resetForTests(): void { clearPolicyOverrides(); }
}
