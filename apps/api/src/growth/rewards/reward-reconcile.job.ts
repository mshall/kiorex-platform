import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '../../prisma/generated/client';
import { cfg } from '../../common/config';
import { PrismaService } from '../../prisma/prisma.service';
import { linesBalance, type CheckoutLine } from './checkout-lines';
import { GROWTH_DEFAULT_MARKET } from '../growth-flags';

export interface ReconcileCheck { id: string; name: string; ok: boolean; count: number; sample: string[] }
export interface ReconcileResult { ok: boolean; checks: ReconcileCheck[]; ranAt: string }

/**
 * Daily reconciliation of the patient reward ledger (RC-1 to RC-7, GRW-P2-B2). It reads, compares and records a RewardReconcileRun. It NEVER corrects anything: a failed check writes an audit row
 * (the case reference) for finance, and the ledger stays exactly as it is. Every check is a query over the committed tables, independent of the code paths that wrote them.
 */
@Injectable()
export class RewardReconcileJob implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('reward-reconcile');
  private timer?: NodeJS.Timeout;
  constructor(private readonly prisma: PrismaService) {}
  onModuleInit() {
    if (!cfg().jobsEnabled) return;
    this.timer = setInterval(() => { if (new Date().getUTCHours() === 3) void this.run().catch((e) => this.log.warn(`reward reconcile failed: ${(e as Error).message}`)); }, 3600_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private async check(id: string, name: string, q: Prisma.Sql): Promise<ReconcileCheck> {
    const rows = await this.prisma.$queryRaw<{ ref: string }[]>(q);
    return { id, name, ok: rows.length === 0, count: rows.length, sample: rows.slice(0, 10).map((r) => r.ref) };
  }

  async run(now = new Date()): Promise<ReconcileResult> {
    const checks: ReconcileCheck[] = [];
    // RC-1: no lot has a negative available, held or reserved balance
    checks.push(await this.check('RC-1', 'lot balances never negative', Prisma.sql`SELECT l."id" AS ref FROM "RewardLot" l CROSS JOIN LATERAL reward_lot_balance(l."id") b WHERE b."available" < 0 OR b."held" < 0 OR b."reserved" < 0`));
    // RC-2: the sum of lot balances per market and currency equals the ledger totals (issued - redeemed - reversed - expired), computed a second way
    checks.push(await this.check('RC-2', 'lot balances equal ledger totals per market and currency', Prisma.sql`
      WITH a AS (SELECT l."market", l."currency", SUM(b."available" + b."held" + b."reserved")::bigint AS bal FROM "RewardLot" l CROSS JOIN LATERAL reward_lot_balance(l."id") b GROUP BY 1, 2),
           z AS (SELECT l."market", l."currency", SUM(CASE e."type" WHEN 'ISSUE' THEN e."amountMinor" WHEN 'REDEEM' THEN -e."amountMinor" WHEN 'REVERSE' THEN -e."amountMinor" WHEN 'EXPIRE' THEN -e."amountMinor" ELSE 0 END)::bigint AS bal
                 FROM "RewardLedgerEntry" e JOIN "RewardLot" l ON l."id" = e."lotId" GROUP BY 1, 2)
      SELECT COALESCE(a."market", z."market") || '/' || COALESCE(a."currency", z."currency") AS ref FROM a FULL JOIN z ON a."market" = z."market" AND a."currency" = z."currency" WHERE COALESCE(a.bal, 0) <> COALESCE(z.bal, 0)`));
    // RC-3: per booking, the credit REDEEMed equals the credit line of the latest checkout snapshot, and every snapshot's lines add up to the price
    const redeemed = await this.prisma.$queryRaw<{ bookingId: string; redeemed: bigint }[]>(Prisma.sql`SELECT "bookingId", SUM("amountMinor")::bigint AS redeemed FROM "RewardLedgerEntry" WHERE "type" = 'REDEEM' AND "bookingId" IS NOT NULL GROUP BY "bookingId"`);
    const bad: string[] = [];
    for (const r of redeemed) {
      const snap = await this.prisma.rewardCheckoutLine.findFirst({ where: { bookingId: r.bookingId }, orderBy: { createdAt: 'desc' } });
      const lines = (snap?.lines ?? []) as unknown as CheckoutLine[];
      const credit = -(lines.find((l) => l.code === 'PATIENT_CREDIT')?.amountMinor ?? 0);
      if (!snap || !linesBalance(lines) || credit !== Number(r.redeemed)) bad.push(r.bookingId);
    }
    const snaps = await this.prisma.rewardCheckoutLine.findMany({ select: { id: true, lines: true }, take: 5000 });
    for (const s of snaps) if (!linesBalance(s.lines as unknown as CheckoutLine[])) bad.push(`snapshot:${s.id}`);
    checks.push({ id: 'RC-3', name: 'checkout lines add up and match the credit redeemed', ok: bad.length === 0, count: bad.length, sample: bad.slice(0, 10) });
    // RC-4: credit restored never exceeds the credit paid, and a fully refunded payment restored exactly what it paid
    checks.push(await this.check('RC-4', 'refund allocation: restored credit within credit paid, exact on a full refund', Prisma.sql`
      SELECT p."id" AS ref FROM "PaymentIntent" p LEFT JOIN LATERAL (SELECT COALESCE(SUM("amountMinor"),0)::bigint AS s FROM "RewardLot" WHERE "kind" = 'RESTORED' AND "reasonCode" LIKE 'RESTORED:' || p."id" || '%') r ON true
      WHERE p."rewardMinor" > 0 AND (r.s > p."rewardMinor" OR (p."status" = 'REFUNDED' AND r.s <> p."rewardMinor"))`));
    // RC-5: no ledger row references the provider wallet, a tenant or a Clinic credit entry; no row mixes currencies
    checks.push(await this.check('RC-5', 'separate ledgers: no provider-wallet reference, no mixed currency', Prisma.sql`
      SELECT e."id" AS ref FROM "RewardLedgerEntry" e JOIN "RewardLot" l ON l."id" = e."lotId"
      WHERE e."currency" <> l."currency" OR e."actor" ~* '^(tenant|clinic|org|wallet):' OR e."reasonCode" ~* '^(CR_|WALLET|PROVIDER_CREDIT)' OR e."idempotencyKey" ~* 'tenant|wallet'`));
    // RC-6: refund credit issued equals the refunds whose destination was CREDIT and that completed
    checks.push(await this.check('RC-6', 'refund credit issued equals credited refunds', Prisma.sql`
      SELECT 'total' AS ref WHERE (SELECT COALESCE(SUM(e."amountMinor"),0) FROM "RewardLedgerEntry" e JOIN "RewardLot" l ON l."id" = e."lotId" WHERE e."type" = 'ISSUE' AND l."kind" = 'REFUND_CREDIT')
        <> (SELECT COALESCE(SUM(r."amountMinor"),0) FROM "Refund" r JOIN "RefundDestinationChoice" c ON c."refundId" = r."id" WHERE c."choice" = 'CREDIT' AND r."status" = 'CREDITED')`));
    // RC-7: no value is ever created by a payment capture: no ISSUE carries a pay link, and every ISSUE of refund credit names its refund
    checks.push(await this.check('RC-7', 'no payment creates value', Prisma.sql`
      SELECT e."id" AS ref FROM "RewardLedgerEntry" e JOIN "RewardLot" l ON l."id" = e."lotId" WHERE e."type" = 'ISSUE' AND (e."payLinkId" IS NOT NULL OR (l."kind" = 'REFUND_CREDIT' AND e."refundId" IS NULL) OR e."reasonCode" ILIKE '%TOPUP%' OR e."reasonCode" ILIKE '%LOAD%')`));
    const ok = checks.every((c) => c.ok);
    let caseRef: string | null = null;
    if (!ok) {
      const a = await this.prisma.auditLog.create({ data: { actor: 'system:reward-reconcile', action: 'growth.reward_reconcile_failed', resource: 'RewardReconcileRun', metadata: { failed: checks.filter((c) => !c.ok).map((c) => ({ id: c.id, count: c.count })) } } });
      caseRef = a.id; this.log.error(`reward reconcile failed: ${checks.filter((c) => !c.ok).map((c) => c.id).join(', ')} (case ${a.id})`);
    }
    await this.prisma.rewardReconcileRun.create({ data: { market: GROWTH_DEFAULT_MARKET, ranAt: now, results: checks as unknown as Prisma.InputJsonValue, ok, caseRef } });
    return { ok, checks, ranAt: now.toISOString() };
  }

  latest(take = 30) { return this.prisma.rewardReconcileRun.findMany({ orderBy: { ranAt: 'desc' }, take }); }
}
