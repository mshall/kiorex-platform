import { Injectable, Logger } from '@nestjs/common';
import { newId } from '../../common/ids';
import { PrismaService } from '../../prisma/prisma.service';
import { GROWTH_DEFAULT_MARKET } from '../growth-flags';

export type RevenueBasisReport = { factCharges: number; inferredCharges: number; inferredShare: number | null; basis: 'CLINIC_FACT' | 'MIXED' | 'INFERRED_AT_COMPLETION' | 'NONE' };
/** G-19 caveat shared by the revenue service and the metrics overview (kept free of Nest DI so both can use it). */
export async function revenueBasisReport(prisma: Pick<PrismaService, 'growthRevenueFact'>, market: string, from: Date, to: Date): Promise<RevenueBasisReport> {
  const rows = await prisma.growthRevenueFact.groupBy({ by: ['basis'], where: { market, kind: 'CHARGE', status: { in: ['CONFIRMED', 'BILLED'] }, occurredAt: { gte: from, lt: to } }, _count: { _all: true } });
  const n = (b: string) => rows.find((r) => r.basis === b)?._count._all ?? 0;
  const inferred = n('INFERRED_AT_COMPLETION'); const fact = n('CLINIC_FACT'); const total = inferred + fact;
  return { factCharges: fact, inferredCharges: inferred, inferredShare: total ? Math.round((inferred / total) * 100) / 100 : null, basis: !total ? 'NONE' : !inferred ? 'CLINIC_FACT' : !fact ? 'INFERRED_AT_COMPLETION' : 'MIXED' };
}

const minor = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v * 100);
  if (typeof v === 'string' && /^-?\d+(\.\d{1,2})?$/.test(v)) return Math.round(Number(v) * 100);
  return null;
};

/**
 * Kiorex revenue facts (GRW-P1-J; KX-32 section 04). The Clinic reports commission charges to Kiorex as `COMMISSION_CHARGE_CREATED` (status PENDING) and
 * `COMMISSION_CHARGE_REVERSED`; it emits no event when a PENDING charge is confirmed, which happens when the visit is completed (Clinic `onComplete`). Kiorex sees
 * that same completion as the booking's COMPLETED event, so `onBookingCompleted` writes the CONFIRMED fact. Only facts that came from a charge are stored here:
 * booking value, deposits, credits, tax lines and settlements have no way in.
 *
 * G-19: every fact says where it came from (`basis`). CLINIC_FACT = the Clinic reported the charge status (a CONFIRMED, BILLED or WAIVED status on the charge event, i.e. the
 * settlement path). INFERRED_AT_COMPLETION = the completion inference above. A later Clinic fact for the same charge upgrades the inferred row (`reconcileBasis`), nothing is
 * double counted (the rollup counts a charge once, on the first revenue status), and reports state how much of the revenue is still inferred.
 */
@Injectable()
export class GrowthRevenueService {
  private readonly log = new Logger('growth-revenue');
  constructor(private readonly prisma: PrismaService) {}

  async recordFromEvent(type: string, data: Record<string, any>, occurredAt?: string): Promise<boolean> {
    try {
      const chargeId = typeof data.chargeId === 'string' ? data.chargeId : '';
      const appointmentId = typeof data.appointmentId === 'string' ? data.appointmentId : '';
      const amount = minor(data.amount);
      if (!chargeId || !appointmentId || amount === null || (type !== 'COMMISSION_CHARGE_CREATED' && type !== 'COMMISSION_CHARGE_REVERSED')) return false;
      const reversal = type === 'COMMISSION_CHARGE_REVERSED';
      if (!reversal && ['CONFIRMED', 'BILLED'].includes(String(data.status ?? 'PENDING'))) await this.prisma.growthRevenueFact.updateMany({ where: { chargeId, kind: 'CHARGE', basis: 'INFERRED_AT_COMPLETION' }, data: { basis: 'CLINIC_FACT' } });
      const booking = await this.prisma.bookingIntent.findFirst({ where: { kiorlyAppointmentId: appointmentId }, select: { id: true } });
      const status = reversal ? 'REVERSED' : String(data.status ?? 'PENDING');
      const at = occurredAt && !Number.isNaN(Date.parse(occurredAt)) ? new Date(occurredAt) : new Date();
      const r = await this.prisma.growthRevenueFact.createMany({
        data: [{ market: GROWTH_DEFAULT_MARKET, kind: reversal ? 'REVERSAL' : 'CHARGE', chargeId, appointmentId, bookingId: booking?.id ?? null, status, amountMinor: Math.abs(amount), currency: String(data.currency ?? 'EGP').slice(0, 3), origin: typeof data.origin === 'string' ? data.origin : '', occurredAt: at }],
        skipDuplicates: true,
      });
      return r.count === 1;
    } catch (e) { this.log.warn(`revenue fact not recorded: ${(e as Error).message}`); return false; }
  }

  /** The visit was completed: every still-PENDING charge of that booking is now CONFIRMED (Clinic `onComplete`). Idempotent (unique on kind, charge, status). */
  async onBookingCompleted(bookingId: string, at = new Date()): Promise<number> {
    try {
      const pending = await this.prisma.growthRevenueFact.findMany({ where: { bookingId, kind: 'CHARGE', status: 'PENDING' } });
      let n = 0;
      for (const p of pending) {
        if (await this.prisma.growthRevenueFact.findFirst({ where: { chargeId: p.chargeId, OR: [{ kind: 'REVERSAL' }, { kind: 'CHARGE', status: { in: ['CONFIRMED', 'BILLED', 'WAIVED'] } }] } })) continue;
        const r = await this.prisma.growthRevenueFact.createMany({ data: [{ id: newId('grf'), market: p.market, kind: 'CHARGE', chargeId: p.chargeId, appointmentId: p.appointmentId, bookingId, status: 'CONFIRMED', basis: 'INFERRED_AT_COMPLETION', amountMinor: p.amountMinor, currency: p.currency, origin: p.origin, occurredAt: at }], skipDuplicates: true });
        n += r.count;
      }
      return n;
    } catch (e) { this.log.warn(`revenue confirmation for ${bookingId} failed: ${(e as Error).message}`); return 0; }
  }

  /**
   * G-19 backfill: an inferred CONFIRMED row whose charge has since been reported BILLED (or CONFIRMED by the Clinic itself) is a settled fact: upgrade it to CLINIC_FACT.
   * Idempotent, safe to run daily and after a webhook replay. Returns how many rows changed.
   */
  async reconcileBasis(): Promise<number> {
    const r = await this.prisma.$executeRaw`
      UPDATE "GrowthRevenueFact" c SET "basis" = 'CLINIC_FACT'
      WHERE c."kind" = 'CHARGE' AND c."basis" = 'INFERRED_AT_COMPLETION'
        AND EXISTS (SELECT 1 FROM "GrowthRevenueFact" b WHERE b."chargeId" = c."chargeId" AND b."kind" = 'CHARGE' AND b."status" = 'BILLED' AND b."basis" = 'CLINIC_FACT')`;
    return Number(r);
  }

  /** How much of the revenue that reached CONFIRMED or BILLED in a period rests on the completion inference. Charges, not people; no identifiers. */
  basisReport(market: string, from: Date, to: Date) { return revenueBasisReport(this.prisma, market, from, to); }
}
