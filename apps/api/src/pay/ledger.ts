/**
 * Double-entry ledger domain (KXM-PAY-05). Pure functions; the DB enforces the same invariants
 * (single-sided entries + deferred balanced-transaction trigger). Amounts are integer minor units (piastres).
 *
 * Accounts:  PSP_CLEARING (asset, debit-normal)  ·  HELD:<clinic> (liability: deposit awaiting the visit)
 *            PAYABLE:<clinic> (liability: released, owed to clinic)  ·  REFUND_PAYABLE (liability: owed back to patient)
 *            REVIEW_HOLD:<clinic> (liability: deposit of an unsafe-aborted home visit held for ops review, KXMPAY07)
 *            PSP_FEES (expense, debit-normal)
 * Three ledgers are never commingled: this is the Kiorex Pay ledger only (KX-09 §06).
 */
export interface Posting { account: string; debit: number; credit: number }
export interface LedgerTxInput { key: string; kind: string; postings: Posting[] }

export const A = {
  clearing: 'PSP_CLEARING',
  fees: 'PSP_FEES',
  refundPayable: 'REFUND_PAYABLE',
  held: (clinic: string) => `HELD:${clinic}`,
  payable: (clinic: string) => `PAYABLE:${clinic}`,
  /** KXMPAY07 'hold-for-review': a captured deposit parked here is neither refunded nor forfeited until an ops decision. */
  reviewHold: (clinic: string) => `REVIEW_HOLD:${clinic}`,
  /** Kiorex's own marketplace take on vertical orders (credit-normal revenue). NEEDS_HUMAN rate; VAT only as config on fee statements. */
  marketplaceFees: 'MARKETPLACE_FEES',
  /** GRW-P2-B2: the patient's OWN refunded money kept as credit (liability, credit-normal). Moves REFUND_PAYABLE -> here on a refund the patient chose to keep as credit; flows to HELD when spent on a deposit. Never revenue. */
  patientRefundCredit: 'PATIENT_REFUND_CREDIT',
  /** GRW-P2-B2: promotional credit applied to a deposit, posted only when REWARD_RULES.postToPayLedger is true (finance decision). Debit-normal like an expense: it is Kiorex's marketing cost, never the provider's. */
  promoFunded: 'PROMO_FUNDED:rewards',
  /** GRW-P2-S: the provider-funded part of a deposit (sponsored discount) posted into HELD, only when REWARD_RULES.postToPayLedger is true (finance H-25, default false). Debit-normal: a receivable settled by the Clinic's wallet DEBIT (Kiorly side), never Kiorex revenue or expense; the payout gate holds it until that DEBIT exists. */
  sponsorFunded: 'SPONSOR_FUNDED:clinicCredit',
};

const dr = (account: string, n: number): Posting => ({ account, debit: n, credit: 0 });
const cr = (account: string, n: number): Posting => ({ account, debit: 0, credit: n });

export const capture = (clinic: string, gross: number): Posting[] => [dr(A.clearing, gross), cr(A.held(clinic), gross)];
export const pspFee = (fee: number): Posting[] => [dr(A.fees, fee), cr(A.clearing, fee)];
export const refundRequest = (clinic: string, n: number): Posting[] => [dr(A.held(clinic), n), cr(A.refundPayable, n)];
export const refundSettle = (n: number): Posting[] => [dr(A.refundPayable, n), cr(A.clearing, n)];
export const release = (clinic: string, n: number): Posting[] => [dr(A.held(clinic), n), cr(A.payable(clinic), n)];
/** Vertical order fulfilled: held goods money -> partner payable, minus Kiorex's take (fee may be 0 while the rate is unset). */
export const releaseOrder = (partner: string, total: number, fee: number): Posting[] => [dr(A.held(partner), total), cr(A.payable(partner), total - fee), ...(fee > 0 ? [cr(A.marketplaceFees, fee)] : [])];
/** Unsafe-aborted home visit (BR61): HELD -> REVIEW_HOLD. Never auto-forfeit, never a no-show charge. */
export const holdForReview = (clinic: string, n: number): Posting[] => [dr(A.held(clinic), n), cr(A.reviewHold(clinic), n)];
/** Ops decision after review: release to the provider payable (forfeit) ... */
export const releaseFromReview = (clinic: string, n: number): Posting[] => [dr(A.reviewHold(clinic), n), cr(A.payable(clinic), n)];
/** ... or refund the patient (the refund then settles through REFUND_PAYABLE like any other refund). */
export const refundFromReview = (clinic: string, n: number): Posting[] => [dr(A.reviewHold(clinic), n), cr(A.refundPayable, n)];
export const payout = (clinic: string, n: number): Posting[] => [dr(A.payable(clinic), n), cr(A.clearing, n)];
/** GRW-P2-B2 deposit paid partly with credit: the credit part reaches the clinic's HELD from the account that funds it (the patient's refund credit liability, and the promo account when it is posted). Balanced by construction. */
export const rewardTender = (clinic: string, refundCreditMinor: number, promoMinor: number): Posting[] => [...(refundCreditMinor > 0 ? [dr(A.patientRefundCredit, refundCreditMinor)] : []), ...(promoMinor > 0 ? [dr(A.promoFunded, promoMinor)] : []), cr(A.held(clinic), refundCreditMinor + promoMinor)];
/** The reverse of rewardTender when the credit comes back to the patient (a refund of a credit-paid deposit). `account` is HELD, or REVIEW_HOLD for a deposit under review. */
export const rewardRestore = (account: string, refundCreditMinor: number, promoMinor: number): Posting[] => [dr(account, refundCreditMinor + promoMinor), ...(refundCreditMinor > 0 ? [cr(A.patientRefundCredit, refundCreditMinor)] : []), ...(promoMinor > 0 ? [cr(A.promoFunded, promoMinor)] : [])];
/** GRW-P2-S: the sponsored part of a deposit reaches the clinic's HELD from SPONSOR_FUNDED (balanced by construction). */
export const sponsorTender = (clinic: string, n: number): Posting[] => [dr(A.sponsorFunded, n), cr(A.held(clinic), n)];
/** GRW-P2-S: the sponsored share is voided (refund of the deposit, or a forfeited deposit where no discount was earned): the exact reverse of sponsorTender. `account` is HELD, or REVIEW_HOLD for a deposit under review. */
export const sponsorVoid = (account: string, n: number): Posting[] => [dr(account, n), cr(A.sponsorFunded, n)];
/** A refund the patient chose to keep as credit: the money stays at Kiorex, the liability moves from "owed back by card" to "refund credit". */
export const refundToCredit = (n: number): Posting[] => [dr(A.refundPayable, n), cr(A.patientRefundCredit, n)];
/** A refund-credit lot expired and its unspent rest goes back to the ORIGINAL payment method: the liability returns to "owed back by card". */
export const refundCreditExpired = (n: number): Posting[] => [dr(A.patientRefundCredit, n), cr(A.refundPayable, n)];

export class LedgerError extends Error {}

export function assertValid(p: Posting[]): void {
  if (!p.length) throw new LedgerError('empty transaction');
  let d = 0, c = 0;
  for (const e of p) {
    if (!Number.isInteger(e.debit) || !Number.isInteger(e.credit) || e.debit < 0 || e.credit < 0) throw new LedgerError('amounts must be non-negative integers');
    if (e.debit > 0 && e.credit > 0) throw new LedgerError('entry must be single-sided');
    d += e.debit; c += e.credit;
  }
  if (d !== c) throw new LedgerError(`unbalanced: debit ${d} credit ${c}`);
  if (d === 0) throw new LedgerError('zero-value transaction');
}

const DEBIT_NORMAL = (a: string) => a === A.clearing || a === A.fees || a === A.promoFunded || a === A.sponsorFunded;

/** In-memory book used by property tests and by the reconciliation invariant checker. */
export class LedgerBook {
  private txs = new Map<string, LedgerTxInput>();
  private bal = new Map<string, number>(); // signed: debit-normal => debit-credit, credit-normal => credit-debit

  /** Idempotent on key: replays are ignored and return false. */
  post(tx: LedgerTxInput): boolean {
    if (this.txs.has(tx.key)) return false;
    assertValid(tx.postings);
    const next = new Map(this.bal);
    for (const e of tx.postings) {
      const delta = DEBIT_NORMAL(e.account) ? e.debit - e.credit : e.credit - e.debit;
      next.set(e.account, (next.get(e.account) ?? 0) + delta);
    }
    for (const [acct, v] of next) {
      if (!DEBIT_NORMAL(acct) && v < 0) throw new LedgerError(`liability ${acct} would go negative (${v})`);
    }
    this.bal = next;
    this.txs.set(tx.key, tx);
    return true;
  }
  balance(account: string): number { return this.bal.get(account) ?? 0; }
  accounts(): string[] { return [...this.bal.keys()]; }
  totals() {
    let d = 0, c = 0;
    for (const t of this.txs.values()) for (const e of t.postings) { d += e.debit; c += e.credit; }
    return { debit: d, credit: c };
  }
  liabilities(): number { return this.accounts().filter((a) => !DEBIT_NORMAL(a)).reduce((s, a) => s + this.balance(a), 0); }
}

/** Accounting identity: debit-normal accounts (clearing, fees, promo funded) == liabilities. */
export function identityHolds(book: LedgerBook): boolean {
  return book.balance(A.clearing) + book.balance(A.fees) + book.balance(A.promoFunded) + book.balance(A.sponsorFunded) === book.liabilities();
}
