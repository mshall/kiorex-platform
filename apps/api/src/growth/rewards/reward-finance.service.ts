import { Injectable } from '@nestjs/common';
import { Prisma } from '../../prisma/generated/client';
import { ApiError } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';

export interface FinanceRow { market: string; currency: string; kind: string; funding: string; ruleVersionId: string; campaignId: string | null; issuedMinor: number; redeemedMinor: number; reversedMinor: number; expiredMinor: number }
export interface FinanceReport {
  month: string; rows: FinanceRow[];
  totals: { issuedMinor: number; redeemedMinor: number; reversedMinor: number; expiredMinor: number };
  outstanding: { currency: string; market: string; platformFundedMinor: number; serviceRecoveryMinor: number; refundCreditLiabilityMinor: number; totalMinor: number }[];
  recoverableLossMinor: number;
  /** Always 0: no reward entry is read by any revenue query (S6). The report states facts; the accounting treatment is NEEDS_HUMAN. */
  kiorexRevenueEffectMinor: 0;
  note: string;
}

/** Facts about the patient reward ledger for finance (GRW-P2-B2): issued, redeemed, reversed, expired in a month and what is outstanding now. The liability of the patient's own refunded money is shown apart from platform-funded lots. */
@Injectable()
export class RewardFinanceService {
  constructor(private readonly prisma: PrismaService) {}

  async report(month: string, now = new Date()): Promise<FinanceReport> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ApiError(400, 'GROWTH_INVALID_REQUEST', 'month must be YYYY-MM');
    const from = new Date(`${month}-01T00:00:00Z`); const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
    const rows = await this.prisma.$queryRaw<Array<Record<string, any>>>(Prisma.sql`
      SELECT l."market", l."currency", l."kind", l."funding", l."ruleVersionId", l."campaignId",
        COALESCE(SUM(CASE WHEN e."type" = 'ISSUE' THEN e."amountMinor" END),0)::bigint AS issued, COALESCE(SUM(CASE WHEN e."type" = 'REDEEM' THEN e."amountMinor" END),0)::bigint AS redeemed,
        COALESCE(SUM(CASE WHEN e."type" = 'REVERSE' THEN e."amountMinor" END),0)::bigint AS reversed, COALESCE(SUM(CASE WHEN e."type" = 'EXPIRE' THEN e."amountMinor" END),0)::bigint AS expired
      FROM "RewardLedgerEntry" e JOIN "RewardLot" l ON l."id" = e."lotId" WHERE e."createdAt" >= ${from} AND e."createdAt" < ${to}
      GROUP BY 1,2,3,4,5,6 ORDER BY 1,2,3,4,5`);
    const out: FinanceRow[] = rows.map((r) => ({ market: r.market, currency: r.currency, kind: r.kind, funding: r.funding, ruleVersionId: r.ruleVersionId, campaignId: r.campaignId, issuedMinor: Number(r.issued), redeemedMinor: Number(r.redeemed), reversedMinor: Number(r.reversed), expiredMinor: Number(r.expired) }));
    const sum = (k: keyof FinanceRow) => out.reduce((s, r) => s + (r[k] as number), 0);
    const open = await this.prisma.$queryRaw<Array<Record<string, any>>>(Prisma.sql`
      SELECT l."market", l."currency", l."funding", SUM(b."available" + b."held" + b."reserved")::bigint AS s
      FROM "RewardLot" l CROSS JOIN LATERAL reward_lot_balance(l."id") b WHERE l."expiresAt" > ${now} AND (b."available" + b."held" + b."reserved") > 0 GROUP BY 1,2,3`);
    const keys = new Map<string, FinanceReport['outstanding'][number]>();
    for (const r of open) {
      const k = `${r.market}/${r.currency}`; const cur = keys.get(k) ?? { market: r.market, currency: r.currency, platformFundedMinor: 0, serviceRecoveryMinor: 0, refundCreditLiabilityMinor: 0, totalMinor: 0 };
      const v = Number(r.s);
      if (r.funding === 'PATIENT_REFUND') cur.refundCreditLiabilityMinor += v; else if (r.funding === 'PLATFORM_SERVICE_RECOVERY') cur.serviceRecoveryMinor += v; else cur.platformFundedMinor += v;
      cur.totalMinor += v; keys.set(k, cur);
    }
    const loss = await this.prisma.rewardRecoverableLoss.aggregate({ where: { createdAt: { gte: from, lt: to } }, _sum: { amountMinor: true } });
    return {
      month, rows: out, totals: { issuedMinor: sum('issuedMinor'), redeemedMinor: sum('redeemedMinor'), reversedMinor: sum('reversedMinor'), expiredMinor: sum('expiredMinor') }, outstanding: [...keys.values()],
      recoverableLossMinor: loss._sum.amountMinor ?? 0, kiorexRevenueEffectMinor: 0,
      note: 'Facts only. Outstanding is a liability proxy of unexpired lots; refund credit is the patient\'s own money and is never revenue. The accounting treatment is NEEDS_HUMAN (finance and counsel, H-23).',
    };
  }

  csv(r: FinanceReport): string {
    const esc = (v: unknown) => { const s = String(v ?? ''); return /^[=+\-@\t\r]/.test(s) ? `'${s}` : /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }; // formula-injection safe like the other exports
    const head = ['month', 'market', 'currency', 'kind', 'funding', 'ruleVersionId', 'campaignId', 'issuedMinor', 'redeemedMinor', 'reversedMinor', 'expiredMinor'];
    return '﻿' + [head.join(','), ...r.rows.map((x) => [r.month, x.market, x.currency, x.kind, x.funding, x.ruleVersionId, x.campaignId ?? '', x.issuedMinor, x.redeemedMinor, x.reversedMinor, x.expiredMinor].map(esc).join(','))].join('\n') + '\n';
  }
}
