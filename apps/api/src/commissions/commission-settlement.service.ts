import { Injectable } from '@nestjs/common';
import { badRequest } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { major, toCsv } from './commission-collect';
import { reconStatus, settlementTotals, type PayoutFacts } from './commission-settlement';

/**
 * COM-3 settlement statement per organisation and period (default: the calendar month, UTC). Read only; the same figures serve Kiorex finance / super admin (console) and the provider.
 * Online collections come from the Pay payouts (bank transfer), cash-visit commissions from the claims the product reports with tender CASH, deductions from the payout rows, the bank reference and
 * the match state from the imported vendor / bank settlement lines. Nothing here moves money.
 */
@Injectable()
export class CommissionSettlementService {
  constructor(private readonly prisma: PrismaService) {}

  private range(from?: string, to?: string, now = new Date()) {
    const f = from ? new Date(from) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const t = to ? new Date(to) : new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + 1, 1));
    if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime()) || t <= f) throw badRequest('INVALID_PERIOD', 'from and to must be dates with to after from');
    return { from: f, to: t };
  }

  async statement(orgRef: string, o: { from?: string; to?: string } = {}) {
    if (!/^[A-Za-z0-9_-]{3,64}$/.test(orgRef)) throw badRequest('INVALID_ORG', 'Invalid organisation reference');
    const { from, to } = this.range(o.from, o.to);
    const claimRows = await this.prisma.commissionClaim.findMany({ where: { orgRef, createdAt: { gte: from, lt: to } }, orderBy: { createdAt: 'asc' }, take: 5000 });
    const clinicIds = [...new Set([orgRef, ...claimRows.map((c) => c.clinicId).filter((x): x is string => !!x)])];
    const payoutRows = await this.prisma.payout.findMany({ where: { clinicId: { in: clinicIds }, paidAt: { gte: from, lt: to } }, orderBy: { paidAt: 'asc' } });
    const payouts: (PayoutFacts & { currency: string })[] = [];
    for (const p of payoutRows) {
      const lines = await this.prisma.pspSettlementLine.findMany({ where: { payoutRef: p.payoutRef }, select: { matched: true } });
      payouts.push({ payoutRef: p.payoutRef, paidAt: p.paidAt, cashMinor: p.amountMinor, commissionDeductedMinor: p.commissionDeductedMinor, bankReference: lines.length ? p.payoutRef : null, lines, currency: p.currency });
    }
    const pays = await this.prisma.paymentIntent.findMany({ where: { clinicId: { in: clinicIds }, purpose: 'DEPOSIT', capturedAt: { gte: from, lt: to } }, select: { refundedMinor: true, disputeState: true, amountMinor: true } });
    const refundsMinor = pays.reduce((s, p) => s + p.refundedMinor, 0);
    const chargebacksMinor = pays.filter((p) => p.disputeState === 'LOST').reduce((s, p) => s + p.amountMinor, 0);
    const openDisputes = claimRows.filter((c) => c.disputeStatus === 'OPEN').length;
    const totals = settlementTotals({ payouts, refundsMinor, chargebacksMinor });
    const cash = claimRows.filter((c) => c.tender === 'CASH' && ['CONFIRMED', 'BILLED', 'PENDING', 'DISPUTED'].includes(c.chargeStatus));
    const cashAccruedMinor = cash.reduce((s, c) => s + c.amountMinor, 0);
    const cashNettedMinor = cash.reduce((s, c) => s + c.collectedMinor, 0);
    const commissionMinor = claimRows.filter((c) => !['REVERSED', 'WAIVED'].includes(c.chargeStatus)).reduce((s, c) => s + c.amountMinor, 0);
    const collectedMinor = claimRows.reduce((s, c) => s + c.collectedMinor, 0);
    const statuses = payouts.map((p) => reconStatus(p, openDisputes));
    const status = openDisputes > 0 ? 'DISPUTED' : statuses.length === 0 ? 'NO_PAYOUT' : statuses.every((s) => s === 'MATCHED') ? 'MATCHED' : 'UNMATCHED';
    return {
      orgRef, period: { from: from.toISOString(), to: to.toISOString() }, currency: payouts[0]?.currency ?? claimRows[0]?.currency ?? 'EGP', payoutMethod: 'BANK_TRANSFER',
      onlineCollectionsMinor: totals.onlineCollectionsMinor,
      cashVisitCommissionAccruedMinor: cashAccruedMinor, cashVisitCommissionNettedMinor: cashNettedMinor, cashVisitCommissionOpenMinor: Math.max(0, cashAccruedMinor - cashNettedMinor), cashVisitCharges: cash.length,
      deductions: { commissionMinor: totals.commissionDeductedMinor, feesMinor: null as number | null, refundsMinor: totals.refundsMinor, chargebacksMinor: totals.chargebacksMinor },
      commission: { totalMinor: commissionMinor, collectedMinor, openMinor: Math.max(0, commissionMinor - collectedMinor), disputedOpen: openDisputes },
      netPayableMinor: totals.netPayableMinor, paidByBankTransferMinor: totals.paidMinor,
      payouts: payouts.map((p, i) => ({ payoutRef: p.payoutRef, paidAt: p.paidAt, cashMinor: p.cashMinor, commissionDeductedMinor: p.commissionDeductedMinor, bankReference: p.bankReference, reconciliation: statuses[i] })),
      reconciliation: status,
      notes: { cash: 'Kiorex never holds or pays out cash: a commission on a cash visit is accrued and netted in the next bank-transfer settlement, or invoiced when no payout is due.', fees: 'Marketplace fees apply to Pharmacy and Lab orders and are netted at release; not applicable to Clinic payouts (null).' },
    };
  }

  async exportCsv(orgRef: string, o: { from?: string; to?: string }) {
    const s = await this.statement(orgRef, o);
    const rows: unknown[][] = [
      ['onlineCollections', major(s.onlineCollectionsMinor)], ['cashVisitCommissionAccrued', major(s.cashVisitCommissionAccruedMinor)], ['cashVisitCommissionNetted', major(s.cashVisitCommissionNettedMinor)],
      ['deductionCommission', major(s.deductions.commissionMinor)], ['deductionFees', s.deductions.feesMinor === null ? '' : major(s.deductions.feesMinor)], ['deductionRefunds', major(s.deductions.refundsMinor)], ['deductionChargebacks', major(s.deductions.chargebacksMinor)],
      ['netPayable', major(s.netPayableMinor)], ['paidByBankTransfer', major(s.paidByBankTransferMinor)], ['reconciliation', s.reconciliation],
      ...s.payouts.map((p) => [`payout:${p.payoutRef}`, major(p.cashMinor), major(p.commissionDeductedMinor), p.bankReference ?? '', p.reconciliation]),
    ];
    return { filename: `settlement-${orgRef}-${s.period.from.slice(0, 10)}.csv`, csv: toCsv(['item', 'amount', 'deducted', 'bankReference', 'status'], rows), rows: rows.length };
  }
}
