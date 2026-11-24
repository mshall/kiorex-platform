import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../prisma/generated/client';
import { notFound } from '../../common/errors';
import { FlagsService } from '../../control-plane/control-plane-public';
import { PrismaService } from '../../prisma/prisma.service';
import { CORPORATE_FLAG } from '../growth-flags';
import type { CorporateBenefitPort, CorporateBenefitQuoteOut } from '../growth-ports-public';
import { memberHashOf } from './corporate-code';
import { benefitFor } from './corporate-math';

type Db = Prisma.TransactionClient | PrismaService;
const LIVE_BOOKING = ['INTENT', 'HELD', 'PENDING_CLINIC', 'CONFIRMED', 'CHECKED_IN'];
const MAX_RETRIES = 3;

export interface BenefitUse { reserved: number; released: number; redeemed: number; reversed: number; used: number; held: number; net: number }
const useOf = (r: { reserved: bigint | null; released: bigint | null; redeemed: bigint | null; reversed: bigint | null } | undefined): BenefitUse => {
  const n = (v: bigint | null | undefined) => Number(v ?? 0n);
  const [a, b, c, d] = [n(r?.reserved), n(r?.released), n(r?.redeemed), n(r?.reversed)];
  return { reserved: a, released: b, redeemed: c, reversed: d, used: a - b - d, held: a - b - c, net: c - d };
};

/**
 * The corporate sponsor-funded benefit (GRW-P4-C), in its OWN append-only ledger `CorporateBenefitEntry`. It is not patient credit (no RewardLot, no RewardLedgerEntry is ever written here) and not provider credit
 * (nothing touches the Clinic wallet). There is no balance: the employer funds a ceiling, a member may use up to a per-member cap against booking deposits, and no operation exists to top up, transfer, gift or cash out.
 * Flow per booking: RESERVE (held, counts against the ceiling and the cap) -> REDEEM (the deposit was captured) or RELEASE (booking died, payment failed); REVERSE after a refund.
 * The ceiling and the cap are enforced by the database (trigger serialising on the account row), so a race between two bookings cannot overspend; the service only sizes the benefit and retries on a lost race.
 * Every method answers "nothing" with the flag `growth.corporate` OFF or without complete account terms, and never throws into a booking (the reserve and quote methods).
 */
@Injectable()
export class CorporateBenefitService implements CorporateBenefitPort {
  private readonly log = new Logger('corporate-benefit');
  constructor(private readonly prisma: PrismaService, private readonly flags: FlagsService) {}

  private on(market: string): Promise<boolean> { return this.flags.isEnabled(CORPORATE_FLAG, { market }).catch(() => false); }

  /** Totals of the ledger for an account, a member or one booking. */
  async use(db: Db, where: { accountId?: string; memberId?: string; bookingId?: string }): Promise<BenefitUse> {
    const cond = [where.accountId ? Prisma.sql`"accountId" = ${where.accountId}` : null, where.memberId ? Prisma.sql`"memberId" = ${where.memberId}` : null, where.bookingId ? Prisma.sql`"bookingId" = ${where.bookingId}` : null].filter(Boolean) as Prisma.Sql[];
    if (!cond.length) throw new RangeError('use() needs a filter');
    const rows = await db.$queryRaw<{ reserved: bigint | null; released: bigint | null; redeemed: bigint | null; reversed: bigint | null }[]>(Prisma.sql`
      SELECT sum(CASE "type" WHEN 'RESERVE' THEN "amountMinor" END) AS reserved, sum(CASE "type" WHEN 'RELEASE' THEN "amountMinor" END) AS released,
             sum(CASE "type" WHEN 'REDEEM' THEN "amountMinor" END) AS redeemed, sum(CASE "type" WHEN 'REVERSE' THEN "amountMinor" END) AS reversed
        FROM "CorporateBenefitEntry" WHERE ${Prisma.join(cond, ' AND ')}`);
    return useOf(rows[0]);
  }

  /** The active membership of a person with its account, or null (the account must be ACTIVE, inside its dates). */
  async activeMembership(sub: string, now = new Date(), db: Db = this.prisma) {
    const m = await db.corporateMember.findFirst({ where: { subHash: memberHashOf(sub), endedAt: null }, include: { account: true } });
    if (!m) return null;
    const a = m.account;
    if (a.status !== 'ACTIVE' || (a.startsAt && a.startsAt > now) || (a.endsAt && a.endsAt <= now)) return null;
    return m;
  }

  private async size(sub: string, bookingId: string, now: Date) {
    const b = await this.prisma.bookingIntent.findFirst({ where: { id: bookingId, sub }, select: { id: true, status: true, depositAmountMinor: true, currency: true, dependantId: true, tenantId: true } });
    if (!b) throw notFound('BOOKING_NOT_FOUND', 'Booking not found');
    const m = await this.activeMembership(sub, now);
    if (!m || b.dependantId || !LIVE_BOOKING.includes(b.status) || b.depositAmountMinor <= 0 || b.currency !== m.account.currency) return null;
    if (!(await this.on(m.account.market))) return null;
    const a = m.account;
    if (a.sponsorCeilingMinor == null || a.coverBp == null) return null;
    const [accUse, memUse] = await Promise.all([this.use(this.prisma, { accountId: a.id }), this.use(this.prisma, { memberId: m.id })]);
    const cap = m.perMemberCapMinor ?? a.perMemberCapMinor ?? 0;
    const amount = benefitFor({ depositMinor: b.depositAmountMinor, coverBp: a.coverBp, perVisitMaxMinor: a.perVisitMaxMinor, memberRemainingMinor: Math.max(0, cap - memUse.used), accountRemainingMinor: Math.max(0, a.sponsorCeilingMinor - accUse.used) });
    return { booking: b, member: m, account: a, amount };
  }

  async quote(sub: string, bookingId: string, now = new Date()): Promise<CorporateBenefitQuoteOut | null> {
    const s = await this.size(sub, bookingId, now);
    if (!s || s.amount <= 0) return null;
    const held = await this.use(this.prisma, { bookingId });
    if (held.used > 0) return { accountRef: s.account.id, amountMinor: held.used, currency: s.account.currency, sponsor: { ar: s.account.displayName, en: s.account.displayName }, endsAt: s.account.endsAt?.toISOString() ?? null };
    return { accountRef: s.account.id, amountMinor: s.amount, currency: s.account.currency, sponsor: { ar: s.account.displayName, en: s.account.displayName }, endsAt: s.account.endsAt?.toISOString() ?? null };
  }

  async reserve(sub: string, bookingId: string, now = new Date()): Promise<{ amountMinor: number; currency: string; reservationRef: string } | null> {
    try {
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const existing = await this.use(this.prisma, { bookingId });
        const first = await this.prisma.corporateBenefitEntry.findFirst({ where: { bookingId, type: 'RESERVE' }, orderBy: { createdAt: 'desc' } });
        if (existing.used > 0 && first) return { amountMinor: existing.used, currency: first.currency, reservationRef: first.id };
        const s = await this.size(sub, bookingId, now);
        if (!s || s.amount <= 0) return null;
        const nth = await this.prisma.corporateBenefitEntry.count({ where: { bookingId, type: 'RESERVE' } });
        try {
          const e = await this.prisma.corporateBenefitEntry.create({ data: { accountId: s.account.id, memberId: s.member.id, type: 'RESERVE', amountMinor: s.amount, currency: s.account.currency, bookingId, idempotencyKey: `corp:rsv:${bookingId}:${nth}`, reasonCode: 'BOOKING_DEPOSIT', actor: 'system:booking' } });
          return { amountMinor: e.amountMinor, currency: e.currency, reservationRef: e.id };
        } catch (e) {
          const msg = (e as Error).message;
          if (/CORPORATE_CEILING_EXCEEDED|CORPORATE_MEMBER_CAP_EXCEEDED/.test(msg)) continue; // lost a race: size again against the new totals
          if (/Unique constraint|CORPORATE_ALREADY_RESERVED/.test(msg)) continue; // a parallel call reserved it: answer with that one
          throw e;
        }
      }
      return null;
    } catch (e) { this.log.warn(`corporate reserve failed for ${bookingId}: ${(e as Error).message}`); return null; }
  }

  private async move(bookingId: string, type: 'REDEEM' | 'RELEASE' | 'REVERSE', reason: string, cap?: number): Promise<number> {
    const u = await this.use(this.prisma, { bookingId });
    const room = type === 'REVERSE' ? u.net : u.held;
    const amount = Math.min(room, cap ?? room);
    if (amount <= 0) return 0;
    const last = await this.prisma.corporateBenefitEntry.findFirst({ where: { bookingId, type: 'RESERVE' }, orderBy: { createdAt: 'desc' } });
    if (!last) return 0;
    const nth = await this.prisma.corporateBenefitEntry.count({ where: { bookingId, type } });
    try {
      await this.prisma.corporateBenefitEntry.create({ data: { accountId: last.accountId, memberId: last.memberId, type, amountMinor: amount, currency: last.currency, bookingId, idempotencyKey: `corp:${type.toLowerCase()}:${bookingId}:${nth}`, reasonCode: reason, actor: 'system:pay' } });
      return amount;
    } catch (e) {
      if (/Unique constraint|CORPORATE_NOTHING_/.test((e as Error).message)) return 0; // a parallel call already moved it
      throw e;
    }
  }
  redeem(bookingId: string, reason = 'DEPOSIT_CAPTURED') { return this.move(bookingId, 'REDEEM', reason); }
  release(bookingId: string, reason = 'BOOKING_NOT_PAID') { return this.move(bookingId, 'RELEASE', reason); }
  reverse(bookingId: string, amountMinor?: number, reason = 'DEPOSIT_REFUNDED') { return this.move(bookingId, 'REVERSE', reason, amountMinor); }

  /** Holds whose booking is over (or older than a day with no capture) go back. Idempotent. */
  async releaseStale(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - 15 * 60_000);
    const rows = await this.prisma.$queryRaw<{ bookingId: string }[]>(Prisma.sql`
      SELECT e."bookingId" FROM "CorporateBenefitEntry" e WHERE e."type" = 'RESERVE' AND e."createdAt" < ${cutoff}
        AND NOT EXISTS (SELECT 1 FROM "PaymentIntent" p WHERE p."bookingId" = e."bookingId" AND p."status" IN ('CAPTURED','PARTIALLY_REFUNDED','REFUNDED'))
        AND (EXISTS (SELECT 1 FROM "BookingIntent" b WHERE b."id" = e."bookingId" AND b."status" IN ('CANCELLED','EXPIRED','NO_SHOW','COMPLETED'))
          OR e."createdAt" < ${new Date(now.getTime() - 24 * 3600_000)})
      GROUP BY e."bookingId" LIMIT 500`);
    let n = 0;
    for (const r of rows) n += await this.release(r.bookingId, 'STALE_RESERVATION') > 0 ? 1 : 0;
    return n;
  }

  /** Ledger reconciliation (money invariants): every booking nets to >= 0 at every step, and the account total equals the sum of its bookings. Returns the problems (empty = clean). */
  async reconcile(accountId?: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ accountId: string; bookingId: string; reserved: bigint; released: bigint; redeemed: bigint; reversed: bigint }[]>(Prisma.sql`
      SELECT "accountId", "bookingId", sum(CASE "type" WHEN 'RESERVE' THEN "amountMinor" ELSE 0 END) AS reserved, sum(CASE "type" WHEN 'RELEASE' THEN "amountMinor" ELSE 0 END) AS released,
             sum(CASE "type" WHEN 'REDEEM' THEN "amountMinor" ELSE 0 END) AS redeemed, sum(CASE "type" WHEN 'REVERSE' THEN "amountMinor" ELSE 0 END) AS reversed
        FROM "CorporateBenefitEntry" ${accountId ? Prisma.sql`WHERE "accountId" = ${accountId}` : Prisma.empty} GROUP BY "accountId", "bookingId"`);
    const out: string[] = [];
    for (const r of rows) { const u = useOf(r); if (u.held < 0 || u.net < 0 || u.used < 0) out.push(`booking ${r.bookingId}: held ${u.held} redeemed ${u.net} used ${u.used}`); }
    const accounts = await this.prisma.corporateAccount.findMany({ where: accountId ? { id: accountId } : {}, select: { id: true, sponsorCeilingMinor: true } });
    for (const a of accounts) { const u = await this.use(this.prisma, { accountId: a.id }); if (a.sponsorCeilingMinor != null && u.used > a.sponsorCeilingMinor) out.push(`account ${a.id}: used ${u.used} above ceiling ${a.sponsorCeilingMinor}`); }
    return out;
  }
}
