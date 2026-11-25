import { ledger } from '../pay/pay-public';
type Posting = ledger.Posting;

/** COM-1 ledger accounts and postings. Kiorex's commission income is credit-normal like MARKETPLACE_FEES; money only ever arrives through the provider's rails (PSP_CLEARING) or is kept from a payout. */
export const COMMISSION_FEES = 'COMMISSION_FEES';
const dr = (account: string, n: number): Posting => ({ account, debit: n, credit: 0 });
const cr = (account: string, n: number): Posting => ({ account, debit: 0, credit: n });
/** Commission kept out of the provider's released deposits (NET_FROM_PAYOUT). */
export const commissionNet = (clinic: string, n: number): Posting[] => [dr(ledger.A.payable(clinic), n), cr(COMMISSION_FEES, n)];
/** Commission arrived through the provider's rail (saved-method charge or invoice payment). */
export const commissionReceived = (n: number): Posting[] => [dr(ledger.A.clearing, n), cr(COMMISSION_FEES, n)];
