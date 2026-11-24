import { Injectable, Logger } from '@nestjs/common';
import { newId } from '../../common/ids';
import { PrismaService } from '../../prisma/prisma.service';
import { GROWTH_DEFAULT_MARKET } from '../growth-flags';

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
        const r = await this.prisma.growthRevenueFact.createMany({ data: [{ id: newId('grf'), market: p.market, kind: 'CHARGE', chargeId: p.chargeId, appointmentId: p.appointmentId, bookingId, status: 'CONFIRMED', amountMinor: p.amountMinor, currency: p.currency, origin: p.origin, occurredAt: at }], skipDuplicates: true });
        n += r.count;
      }
      return n;
    } catch (e) { this.log.warn(`revenue confirmation for ${bookingId} failed: ${(e as Error).message}`); return 0; }
  }
}
