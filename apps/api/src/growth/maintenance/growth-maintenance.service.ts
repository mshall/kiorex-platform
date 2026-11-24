import { Injectable } from '@nestjs/common';
import { subRefOf } from '../../common/privacy-hash';
import { memberHashOf } from '../corporate/corporate-code';
import { PrismaService } from '../../prisma/prisma.service';
import { DEFAULT_RETENTION } from '../config/growth-defaults';

export interface EraseResult { touchpointsDeleted: number; touchpointsAnonymised: number; eventsDeleted: number; visitorKeys: number; [phase2: string]: number }
export interface PurgeResult {
  ipHashBlanked: number; touchpointsDeletedUnlinked: number; touchpointsDeletedLinked: number; eventsDeleted: number; fraudSignalsDeleted: number;
  /** GRW-P2-X1 (growth_purge_expired_v2): the Phase 2 tables. */
  assistantTurnsDeleted?: number; assistantToolCallsDeleted?: number; assistantSessionsDeleted?: number; lifecycleDecisionsDeleted?: number; rewardLedgerEntriesDeleted?: number; rewardLotsDeleted?: number; qualificationChecksDeleted?: number; jobRunsDeleted?: number;
  /** GRW-P3-A (growth_purge_experiments). */
  experimentExposuresPurged?: number;
  /** GRW-P4-C (growth_purge_corporate). */
  corporateHrRowsPurged?: number; corporateHrBatchesPurged?: number; corporateLedgerEntriesPurged?: number;
}

/**
 * Thin, logic-free wrappers over the two SECURITY DEFINER SQL functions that are the ONLY way to change or remove a GrowthTouchpoint
 * (the table is append-only, see migration 20261128100000_growth_core). Both write an AuditLog row inside the database. Wave 2 consumers
 * (subject.deleted, retention job) call these; policy decisions (which months, when to run) belong to them, not here.
 */
@Injectable()
export class GrowthMaintenanceService {
  constructor(private readonly prisma: PrismaService) {}

  async eraseSubject(sub: string): Promise<EraseResult> {
    const rows = await this.prisma.$queryRaw<{ r: EraseResult }[]>`SELECT growth_erase_subject(${sub}) AS r`;
    // GRW-P2-B1/B2 (migration 20261217090000): approval requests, recoverable losses and unrevealed coupon seals of the subject
    const more = await this.prisma.$queryRaw<{ r: Record<string, number> }[]>`SELECT growth_erase_rewards_engine(${sub}) AS r`;
    // GRW-P1-J: the PatientRegistered fact is keyed by the person's pseudonymous reference, so it leaves with the person (it is a plain row, not append-only)
    const registered = await this.prisma.growthEvent.deleteMany({ where: { dedupeKey: `fact|PatientRegistered|${subRefOf(sub)}` } });
    // GRW-P3-A (migration 20270107090000): experiment exposures of an authenticated unit
    const exp = await this.prisma.$queryRaw<{ r: Record<string, number> }[]>`SELECT growth_erase_experiments(${sub}) AS r`;
    // GRW-P4-C (migration 20270128093000): a corporate member row is keyed by a hash only the application can compute, so it is passed in
    const corp = await this.prisma.$queryRaw<{ r: Record<string, number> }[]>`SELECT growth_erase_corporate(${memberHashOf(sub)}) AS r`;
    const r = { ...rows[0].r, ...more[0].r, ...exp[0].r, ...corp[0].r };
    return { ...r, eventsDeleted: Number(r.eventsDeleted) + registered.count };
  }

  async purgeExpired(opts: { now?: Date; linkedMonths?: number; unlinkedMonths?: number } = {}): Promise<PurgeResult> {
    const now = opts.now ?? new Date();
    const rows = await this.prisma.$queryRaw<{ r: PurgeResult }[]>`SELECT growth_purge_expired_v2(${now}::timestamptz, ${opts.linkedMonths ?? DEFAULT_RETENTION.linkedMonths}::int, ${opts.unlinkedMonths ?? DEFAULT_RETENTION.unlinkedMonths}::int) AS r`;
    const exp = await this.prisma.$queryRaw<{ r: Record<string, number> }[]>`SELECT growth_purge_experiments(${now}::timestamptz, ${opts.unlinkedMonths ?? DEFAULT_RETENTION.unlinkedMonths}::int) AS r`;
    // GRW-P4-C: HR list rows past their match window and ledger rows of long-ended accounts
    const corp = await this.prisma.$queryRaw<{ r: Record<string, number> }[]>`SELECT growth_purge_corporate(${now}::timestamptz) AS r`;
    return { ...rows[0].r, ...exp[0].r, ...corp[0].r } as PurgeResult;
  }
}
