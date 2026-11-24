import { Injectable } from '@nestjs/common';
import { Prisma } from '../../prisma/generated/client';
import { ApiError } from '../../common/errors';
import { newId } from '../../common/ids';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { entryKey } from './reward-math';

export type Db = Tx | PrismaService;
export type EntryType = 'ISSUE' | 'HOLD' | 'RELEASE_HOLD' | 'RESERVE' | 'UNRESERVE' | 'REDEEM' | 'REVERSE' | 'EXPIRE';

export interface NewEntry {
  lotId: string; type: EntryType; amountMinor: number; idempotencyKey: string; ruleVersionId: string; reasonCode: string; actor: string;
  currency?: string; bookingId?: string | null; payLinkId?: string | null; relationshipId?: string | null; refundId?: string | null;
}
export interface LotBalance { available: number; held: number; reserved: number }
export interface LotTotals extends LotBalance { issued: number; redeemed: number; reversed: number; expired: number }
export interface OpenLot { id: string; kind: string; mode: string; sub: string; ownerSub: string | null; funding: string; scope: Record<string, unknown>; campaignId: string | null; expiresAt: Date; amountMinor: number; status: string; availableMinor: number; reservedMinor: number; qualifyingBookingId: string | null; createdAt: Date; couponCodeHash: string | null }

/**
 * The append-only reward ledger (GRW-P2-B2), the only writer of RewardLedgerEntry. Rules it enforces in code AND the database enforces underneath (so a bug here cannot move value):
 *  - entries are inserted with ON CONFLICT (idempotencyKey) DO NOTHING: a retry is a no-op and never an error inside a transaction;
 *  - the lot row is locked (SELECT ... FOR UPDATE, in id order) before a balance is read, so 20 parallel redeems of one lot are serialised and exactly the ones that fit succeed;
 *  - the deferred constraint trigger reward_ledger_balance refuses any commit that leaves available, held or reserved negative, even if this code is bypassed;
 *  - `RewardLot.status` is a cache refreshed here in the same transaction; the ledger is the truth.
 * Nothing in this file imports payout or pay code: there is no path from the ledger to cash (S2).
 */
@Injectable()
export class RewardLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async lock(db: Db, lotIds: readonly string[]): Promise<void> {
    if (!lotIds.length) return;
    const ids = [...new Set(lotIds)].sort();
    await db.$queryRaw(Prisma.sql`SELECT "id" FROM "RewardLot" WHERE "id" = ANY(${ids}::text[]) ORDER BY "id" FOR UPDATE`);
  }

  async balance(db: Db, lotId: string): Promise<LotBalance> {
    const r = await db.$queryRaw<{ available: bigint; held: bigint; reserved: bigint }[]>(Prisma.sql`SELECT available, held, reserved FROM reward_lot_balance(${lotId})`);
    return { available: Number(r[0]?.available ?? 0), held: Number(r[0]?.held ?? 0), reserved: Number(r[0]?.reserved ?? 0) };
  }
  /** Balances of many lots in ONE round trip (a list page must not open one query per row: 200 parallel balance queries exhausted the connection pool). */
  async balances(db: Db, lotIds: readonly string[]): Promise<Map<string, LotBalance>> {
    const out = new Map<string, LotBalance>();
    const ids = [...new Set(lotIds)];
    if (!ids.length) return out;
    const rows = await db.$queryRaw<{ id: string; available: bigint; held: bigint; reserved: bigint }[]>(Prisma.sql`SELECT u."id", b.available, b.held, b.reserved FROM unnest(${ids}::text[]) AS u("id") CROSS JOIN LATERAL reward_lot_balance(u."id") b`);
    for (const r of rows) out.set(r.id, { available: Number(r.available ?? 0), held: Number(r.held ?? 0), reserved: Number(r.reserved ?? 0) });
    for (const id of ids) if (!out.has(id)) out.set(id, { available: 0, held: 0, reserved: 0 });
    return out;
  }
  async totals(db: Db, lotId: string): Promise<LotTotals> {
    const [b, rows] = await Promise.all([this.balance(db, lotId), db.$queryRaw<{ type: string; s: bigint }[]>(Prisma.sql`SELECT "type", SUM("amountMinor")::bigint AS s FROM "RewardLedgerEntry" WHERE "lotId" = ${lotId} GROUP BY "type"`)]);
    const t = (k: string) => Number(rows.find((x) => x.type === k)?.s ?? 0);
    return { ...b, issued: t('ISSUE'), redeemed: t('REDEEM'), reversed: t('REVERSE'), expired: t('EXPIRE') };
  }

  /** Append one entry. Returns created:false when the same idempotency key was already written (and checks it was the same operation). */
  async append(db: Db, e: NewEntry): Promise<{ created: boolean; id: string }> {
    if (!Number.isInteger(e.amountMinor) || e.amountMinor <= 0) throw new ApiError(422, 'REWARD_AMOUNT_INVALID', 'A ledger entry needs a positive whole amount in minor units');
    const id = newId('rwe');
    const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
      INSERT INTO "RewardLedgerEntry" ("id","lotId","type","amountMinor","currency","idempotencyKey","ruleVersionId","bookingId","payLinkId","relationshipId","refundId","reasonCode","actor","createdAt")
      VALUES (${id}, ${e.lotId}, ${e.type}, ${e.amountMinor}, ${e.currency ?? 'EGP'}, ${e.idempotencyKey}, ${e.ruleVersionId}, ${e.bookingId ?? null}, ${e.payLinkId ?? null}, ${e.relationshipId ?? null}, ${e.refundId ?? null}, ${e.reasonCode}, ${e.actor}, timezone('UTC', now()))
      ON CONFLICT ("idempotencyKey") DO NOTHING RETURNING "id"`);
    if (rows.length) return { created: true, id: rows[0].id };
    const prev = await db.rewardLedgerEntry.findUnique({ where: { idempotencyKey: e.idempotencyKey } });
    if (!prev || prev.lotId !== e.lotId || prev.type !== e.type || prev.amountMinor !== e.amountMinor) throw new ApiError(409, 'REWARD_IDEMPOTENCY_CONFLICT', 'This idempotency key was already used for a different ledger entry');
    return { created: false, id: prev.id };
  }

  /** Refreshes the cached lot status from the ledger (same transaction as the entries). */
  async refreshStatus(db: Db, lotId: string): Promise<string> {
    const t = await this.totals(db, lotId);
    const lot = await db.rewardLot.findUnique({ where: { id: lotId }, select: { status: true } });
    if (!lot) return 'MISSING';
    const status = t.held > 0 ? 'HELD' : t.expired > 0 && t.available === 0 && t.reserved === 0 ? 'EXPIRED' : t.reversed > 0 && t.available === 0 && t.reserved === 0 && t.redeemed < t.issued ? 'REVERSED' : t.available === 0 && t.reserved === 0 ? 'EXHAUSTED' : 'ACTIVE';
    if (status !== lot.status) await db.rewardLot.update({ where: { id: lotId }, data: { status } });
    return status;
  }

  /** Lots a patient (or an owner and the households they lead) may spend now: unexpired, unheld, with an available balance. */
  async openLots(db: Db, o: { owners: readonly string[]; now: Date; kinds?: readonly string[]; mode?: string }): Promise<OpenLot[]> {
    if (!o.owners.length) return [];
    const rows = await db.$queryRaw<Array<Record<string, any>>>(Prisma.sql`
      SELECT l."id", l."kind", l."mode", l."sub", l."ownerSub", l."funding", l."scope", l."campaignId", l."expiresAt", l."amountMinor", l."status", l."qualifyingBookingId", l."createdAt", l."couponCodeHash", b."available", b."reserved"
      FROM "RewardLot" l CROSS JOIN LATERAL reward_lot_balance(l."id") b
      WHERE COALESCE(l."ownerSub", l."sub") = ANY(${[...o.owners]}::text[]) AND l."expiresAt" > ${o.now} AND l."status" IN ('ACTIVE') AND b."available" > 0
        ${o.mode ? Prisma.sql`AND l."mode" = ${o.mode}` : Prisma.empty}
        ${o.kinds ? Prisma.sql`AND l."kind" = ANY(${[...o.kinds]}::text[])` : Prisma.empty}
      ORDER BY l."expiresAt" ASC, l."id" ASC`);
    return rows.map((r) => ({ id: r.id, kind: r.kind, mode: r.mode, sub: r.sub, ownerSub: r.ownerSub, funding: r.funding, scope: (r.scope ?? {}) as Record<string, unknown>, campaignId: r.campaignId, expiresAt: r.expiresAt, amountMinor: r.amountMinor, status: r.status, availableMinor: Number(r.available), reservedMinor: Number(r.reserved), qualifyingBookingId: r.qualifyingBookingId, createdAt: r.createdAt, couponCodeHash: r.couponCodeHash }));
  }

  /** Open reservations of one booking: the RESERVE entries minus what was already redeemed or released, per lot (reserved = RESERVE - UNRESERVE - REDEEM for that booking). */
  async openReservations(db: Db, bookingId: string): Promise<Array<{ lotId: string; minor: number }>> {
    const rows = await db.$queryRaw<{ lotId: string; minor: bigint }[]>(Prisma.sql`
      SELECT "lotId", SUM(CASE "type" WHEN 'RESERVE' THEN "amountMinor" WHEN 'UNRESERVE' THEN -"amountMinor" WHEN 'REDEEM' THEN -"amountMinor" ELSE 0 END)::bigint AS minor
      FROM "RewardLedgerEntry" WHERE "bookingId" = ${bookingId} AND "type" IN ('RESERVE','UNRESERVE','REDEEM') GROUP BY "lotId" HAVING SUM(CASE "type" WHEN 'RESERVE' THEN "amountMinor" WHEN 'UNRESERVE' THEN -"amountMinor" WHEN 'REDEEM' THEN -"amountMinor" ELSE 0 END) > 0 ORDER BY "lotId"`);
    return rows.map((r) => ({ lotId: r.lotId, minor: Number(r.minor) }));
  }
  /** Value redeemed for a booking per lot (REDEEM minus the REVERSE that took part of it back for that booking, never negative). */
  async redeemedFor(db: Db, bookingId: string): Promise<Array<{ lotId: string; minor: number; funding: string; kind: string; mode: string }>> {
    const rows = await db.$queryRaw<{ lotId: string; minor: bigint; funding: string; kind: string; mode: string }[]>(Prisma.sql`
      SELECT e."lotId", SUM(CASE e."type" WHEN 'REDEEM' THEN e."amountMinor" ELSE 0 END)::bigint AS minor, l."funding", l."kind", l."mode"
      FROM "RewardLedgerEntry" e JOIN "RewardLot" l ON l."id" = e."lotId" WHERE e."bookingId" = ${bookingId} AND e."type" = 'REDEEM' GROUP BY e."lotId", l."funding", l."kind", l."mode" ORDER BY e."lotId"`);
    return rows.map((r) => ({ lotId: r.lotId, minor: Number(r.minor), funding: r.funding, kind: r.kind, mode: r.mode }));
  }
}

export const expireKey = (lotId: string, lastEntryId: string, minor: number) => entryKey('expire', lotId, lastEntryId, minor);
