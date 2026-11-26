/**
 * COM-3 settlement statement: pure arithmetic (no I/O). One statement per organisation and period, the same figures for Kiorex finance and for the provider.
 * Kiorex pays providers in Egypt by bank transfer only and never holds or pays out cash: a commission on a cash-paid visit is ACCRUED, shown to both sides and netted in the provider's next settlement (or invoiced when no payout is due).
 */
export type ReconStatus = 'MATCHED' | 'UNMATCHED' | 'DISPUTED';
export interface PayoutFacts { payoutRef: string; paidAt: Date; cashMinor: number; commissionDeductedMinor: number; bankReference: string | null; lines: { matched: boolean }[] }
export interface Totals { onlineCollectionsMinor: number; commissionDeductedMinor: number; refundsMinor: number; chargebacksMinor: number; netPayableMinor: number; paidMinor: number }

/** net payable = online collections released to the provider - commission netted - refunds - chargebacks (never below the cash actually paid out by bank transfer is not assumed: both are reported). */
export function settlementTotals(p: { payouts: PayoutFacts[]; refundsMinor: number; chargebacksMinor: number }): Totals {
  const online = p.payouts.reduce((s, x) => s + x.cashMinor + x.commissionDeductedMinor, 0);
  const ded = p.payouts.reduce((s, x) => s + x.commissionDeductedMinor, 0);
  return { onlineCollectionsMinor: online, commissionDeductedMinor: ded, refundsMinor: p.refundsMinor, chargebacksMinor: p.chargebacksMinor, netPayableMinor: online - ded - p.refundsMinor - p.chargebacksMinor, paidMinor: p.payouts.reduce((s, x) => s + x.cashMinor, 0) };
}

/** A payout is MATCHED when the bank / vendor settlement report carries its bank reference and every line is matched; DISPUTED when a commission claim of the period is under open dispute; else UNMATCHED. */
export function reconStatus(p: PayoutFacts, openDisputes: number): ReconStatus {
  if (openDisputes > 0) return 'DISPUTED';
  return p.bankReference && p.lines.length > 0 && p.lines.every((l) => l.matched) ? 'MATCHED' : 'UNMATCHED';
}
