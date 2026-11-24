import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { cfg } from '../../common/config';
import { PrismaService } from '../../prisma/prisma.service';
import { CorporateBenefitService } from './corporate-benefit.service';
import { CorporateMemberService } from './corporate-member.service';

export interface CorporateRunResult { endedMembers: number; releasedHolds: number; hrBatchesPurged: number; hrRowsPurged: number; problems: string[] }

/** Corporate housekeeping (hourly, idempotent, callable on demand): members of ended accounts lose eligibility, stale holds go back, expired HR lists are deleted, and the ledger is reconciled (problems are logged, never fixed silently). */
@Injectable()
export class CorporateJob implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('corporate-job');
  private timer?: NodeJS.Timeout;
  constructor(private readonly prisma: PrismaService, private readonly members: CorporateMemberService, private readonly benefit: CorporateBenefitService) {}
  onModuleInit() {
    if (!cfg().jobsEnabled) return;
    this.timer = setInterval(() => void this.runOnce().catch((e) => this.log.warn(`corporate housekeeping failed: ${(e as Error).message}`)), 3600_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  async runOnce(now = new Date()): Promise<CorporateRunResult> {
    const endedMembers = await this.members.endExpired(now);
    const releasedHolds = await this.benefit.releaseStale(now);
    const r = await this.prisma.$queryRaw<{ r: { corporateHrRowsPurged: number; corporateHrBatchesPurged: number } }[]>`SELECT growth_purge_corporate(${now}::timestamptz) AS r`;
    const problems = await this.benefit.reconcile();
    if (problems.length) this.log.error(`corporate ledger reconciliation found ${problems.length} problem(s): ${problems.slice(0, 5).join(' | ')}`);
    return { endedMembers, releasedHolds, hrBatchesPurged: Number(r[0].r.corporateHrBatchesPurged), hrRowsPurged: Number(r[0].r.corporateHrRowsPurged), problems };
  }
}
