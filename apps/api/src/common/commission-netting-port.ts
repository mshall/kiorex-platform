/**
 * COM-1: how Pay's payout run reaches the commission collection (net-from-payout). Pay calls the port when it builds a payout; the commissions module provides it.
 * Neither imports the other (shared kernel only). No provider registered = no netting = payouts are exactly as before.
 */
export const COMMISSION_NETTING_PORT = 'COMMISSION_NETTING_PORT';
export interface CommissionNettingPort {
  /** Commission to keep out of this payout (0 .. grossMinor). Records the deduction (idempotent on payoutId). Called inside the payout transaction. */
  reserveForPayout(tx: unknown, i: { clinicId: string; payoutId: string; payoutRef: string; grossMinor: number; currency: string }): Promise<number>;
}
