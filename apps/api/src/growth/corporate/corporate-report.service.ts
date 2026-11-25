import { Injectable } from '@nestjs/common';
import { Prisma } from '../../prisma/generated/client';
import { notFound } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { CorporateConfigService } from './corporate-config';
import { effectiveK, maskBreakdown, maskCount, maskTotal } from './corporate-privacy';
import { reportToCsv, reportToPdf, type ExportReport } from './corporate-report-export';

/**
 * The only report the corporate programme produces (GRW-P4-C): ENROLMENT and UTILISATION counts and the total sponsored value, every cell masked below k (at least 10, set in CORPORATE_POLICY,
 * never lower). It is the shape an employer would be given (no employer login exists in this phase: ops hands the figures over) and the shape ops sees. There is no per-member row, no booking,
 * no provider, no specialty, no date of a single visit and no export of identities anywhere in this file: the queries below select counts and sums over the ledger and the member table only.
 * A masked cell is `null` and `suppressed` lists the masked keys; a breakdown with exactly one hidden cell also hides its smallest visible sibling so a subtraction cannot recover it.
 */
@Injectable()
export class CorporateReportService {
  constructor(private readonly prisma: PrismaService, private readonly config: CorporateConfigService) {}

  async report(accountId: string, now = new Date()) {
    const a = await this.prisma.corporateAccount.findUnique({ where: { id: accountId } });
    if (!a) throw notFound('CORPORATE_ACCOUNT_NOT_FOUND', 'Corporate account not found');
    const k = effectiveK((await this.config.get(a.market, now)).minAggregateK);
    const [enrolled, active, ways, users, spend, perMonth] = await Promise.all([
      this.prisma.corporateMember.count({ where: { accountId } }),
      this.prisma.corporateMember.count({ where: { accountId, endedAt: null } }),
      this.prisma.corporateMember.groupBy({ by: ['verifiedBy'], where: { accountId }, _count: { _all: true } }),
      this.prisma.$queryRaw<{ users: bigint; visits: bigint }[]>(Prisma.sql`SELECT count(DISTINCT "memberId") AS users, count(DISTINCT "bookingId") AS visits FROM "CorporateBenefitEntry" WHERE "accountId" = ${accountId} AND "type" = 'REDEEM'`),
      this.prisma.$queryRaw<{ s: bigint | null }[]>(Prisma.sql`SELECT sum(CASE "type" WHEN 'REDEEM' THEN "amountMinor" WHEN 'REVERSE' THEN -"amountMinor" END) AS s FROM "CorporateBenefitEntry" WHERE "accountId" = ${accountId} AND "type" IN ('REDEEM','REVERSE')`),
      this.prisma.$queryRaw<{ m: string; users: bigint; s: bigint | null }[]>(Prisma.sql`SELECT to_char("createdAt", 'YYYY-MM') AS m, count(DISTINCT "memberId") AS users, sum(CASE "type" WHEN 'REDEEM' THEN "amountMinor" WHEN 'REVERSE' THEN -"amountMinor" END) AS s FROM "CorporateBenefitEntry" WHERE "accountId" = ${accountId} AND "type" IN ('REDEEM','REVERSE') GROUP BY 1 ORDER BY 1 DESC LIMIT 24`),
    ]);
    const utilisers = Number(users[0]?.users ?? 0n); const visits = Number(users[0]?.visits ?? 0n); const total = Math.max(0, Number(spend[0]?.s ?? 0n));
    const byWay = maskBreakdown({ CODE: ways.find((w) => w.verifiedBy === 'CODE')?._count._all ?? 0, HR_LIST: ways.find((w) => w.verifiedBy === 'HR_LIST')?._count._all ?? 0, DOMAIN_EMAIL: ways.find((w) => w.verifiedBy === 'DOMAIN_EMAIL')?._count._all ?? 0 }, k);
    const out = {
      accountId, k, currency: a.currency,
      enrolment: { enrolled: maskCount(enrolled, k), active: maskCount(active, k), byVerification: byWay },
      utilisation: { membersWhoUsedBenefit: maskCount(utilisers, k), sponsoredVisits: utilisers >= k ? maskCount(visits, k) : null, sponsoredValueMinor: maskTotal(total, utilisers, k) },
      byMonth: perMonth.map((r) => ({ month: r.m, membersWhoUsedBenefit: maskCount(Number(r.users), k), sponsoredValueMinor: maskTotal(Math.max(0, Number(r.s ?? 0n)), Number(r.users), k) })),
      suppressed: [] as string[],
    };
    const walk = (o: unknown, path: string) => { if (o && typeof o === 'object') for (const [key, v] of Object.entries(o)) { if (v === null) out.suppressed.push(`${path}${key}`); else walk(v, `${path}${key}.`); } };
    walk({ enrolment: out.enrolment, utilisation: out.utilisation }, '');
    return out;
  }

  /**
   * The report as a CSV or a PDF file that ops hands to the employer (no employer login exists). It is exactly the masked report (never more), and the export itself is an audit row with the actor,
   * the account and the format (never the figures). The file name carries no personal data.
   */
  async exportFile(accountId: string, format: 'csv' | 'pdf', actor: string, now = new Date()): Promise<{ filename: string; contentType: string; body: Buffer }> {
    const a = await this.prisma.corporateAccount.findUnique({ where: { id: accountId }, select: { displayName: true } });
    if (!a) throw notFound('CORPORATE_ACCOUNT_NOT_FOUND', 'Corporate account not found');
    const report = (await this.report(accountId, now)) as unknown as ExportReport;
    const meta = { company: a.displayName, generatedAt: now };
    await this.prisma.auditLog.create({ data: { actor, action: 'growth.corporate.report_exported', resource: 'CorporateAccount', resourceId: accountId, metadata: { format, k: report.k } } });
    const stamp = now.toISOString().slice(0, 10);
    return format === 'pdf'
      ? { filename: `employer-benefit-report-${stamp}.pdf`, contentType: 'application/pdf', body: reportToPdf(report, meta) }
      : { filename: `employer-benefit-report-${stamp}.csv`, contentType: 'text/csv; charset=utf-8', body: Buffer.from(reportToCsv(report, meta), 'utf8') };
  }

  /** The invoice basis for ops finance: the sponsor spend of one month as the ledger shows it (REDEEM minus REVERSE). The total is what the sponsor owes, so it is not masked here; who produced it never is shown. */
  async monthlyStatement(accountId: string, month: string) {
    const [y, m] = month.split('-').map(Number); const from = new Date(Date.UTC(y, m - 1, 1)); const to = new Date(Date.UTC(y, m, 1));
    const r = await this.prisma.$queryRaw<{ s: bigint | null; n: bigint }[]>(Prisma.sql`SELECT sum(CASE "type" WHEN 'REDEEM' THEN "amountMinor" WHEN 'REVERSE' THEN -"amountMinor" END) AS s, count(*) AS n FROM "CorporateBenefitEntry" WHERE "accountId" = ${accountId} AND "type" IN ('REDEEM','REVERSE') AND "createdAt" >= ${from} AND "createdAt" < ${to}`);
    return { accountId, month, sponsorSpendMinor: Math.max(0, Number(r[0]?.s ?? 0n)), ledgerEntries: Number(r[0]?.n ?? 0n) };
  }
}
