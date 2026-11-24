import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DEFAULT_RETENTION } from '../config/growth-defaults';

export interface EraseResult { touchpointsDeleted: number; touchpointsAnonymised: number; eventsDeleted: number; visitorKeys: number }
export interface PurgeResult { ipHashBlanked: number; touchpointsDeletedUnlinked: number; touchpointsDeletedLinked: number; eventsDeleted: number; fraudSignalsDeleted: number }

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
    return rows[0].r;
  }

  async purgeExpired(opts: { now?: Date; linkedMonths?: number; unlinkedMonths?: number } = {}): Promise<PurgeResult> {
    const now = opts.now ?? new Date();
    const rows = await this.prisma.$queryRaw<{ r: PurgeResult }[]>`SELECT growth_purge_expired(${now}::timestamptz, ${opts.linkedMonths ?? DEFAULT_RETENTION.linkedMonths}::int, ${opts.unlinkedMonths ?? DEFAULT_RETENTION.unlinkedMonths}::int) AS r`;
    return rows[0].r;
  }
}
