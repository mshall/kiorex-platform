"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LedgerBook = exports.LedgerError = exports.refundCreditExpired = exports.refundToCredit = exports.sponsorVoid = exports.sponsorTender = exports.rewardRestore = exports.rewardTender = exports.payout = exports.refundFromReview = exports.releaseFromReview = exports.holdForReview = exports.releaseOrder = exports.release = exports.refundSettle = exports.refundRequest = exports.pspFee = exports.capture = exports.A = void 0;
exports.assertValid = assertValid;
exports.identityHolds = identityHolds;
exports.A = {
    clearing: 'PSP_CLEARING',
    fees: 'PSP_FEES',
    refundPayable: 'REFUND_PAYABLE',
    held: (clinic) => `HELD:${clinic}`,
    payable: (clinic) => `PAYABLE:${clinic}`,
    reviewHold: (clinic) => `REVIEW_HOLD:${clinic}`,
    marketplaceFees: 'MARKETPLACE_FEES',
    patientRefundCredit: 'PATIENT_REFUND_CREDIT',
    promoFunded: 'PROMO_FUNDED:rewards',
    sponsorFunded: 'SPONSOR_FUNDED:clinicCredit',
};
const dr = (account, n) => ({ account, debit: n, credit: 0 });
const cr = (account, n) => ({ account, debit: 0, credit: n });
const capture = (clinic, gross) => [dr(exports.A.clearing, gross), cr(exports.A.held(clinic), gross)];
exports.capture = capture;
const pspFee = (fee) => [dr(exports.A.fees, fee), cr(exports.A.clearing, fee)];
exports.pspFee = pspFee;
const refundRequest = (clinic, n) => [dr(exports.A.held(clinic), n), cr(exports.A.refundPayable, n)];
exports.refundRequest = refundRequest;
const refundSettle = (n) => [dr(exports.A.refundPayable, n), cr(exports.A.clearing, n)];
exports.refundSettle = refundSettle;
const release = (clinic, n) => [dr(exports.A.held(clinic), n), cr(exports.A.payable(clinic), n)];
exports.release = release;
const releaseOrder = (partner, total, fee) => [dr(exports.A.held(partner), total), cr(exports.A.payable(partner), total - fee), ...(fee > 0 ? [cr(exports.A.marketplaceFees, fee)] : [])];
exports.releaseOrder = releaseOrder;
const holdForReview = (clinic, n) => [dr(exports.A.held(clinic), n), cr(exports.A.reviewHold(clinic), n)];
exports.holdForReview = holdForReview;
const releaseFromReview = (clinic, n) => [dr(exports.A.reviewHold(clinic), n), cr(exports.A.payable(clinic), n)];
exports.releaseFromReview = releaseFromReview;
const refundFromReview = (clinic, n) => [dr(exports.A.reviewHold(clinic), n), cr(exports.A.refundPayable, n)];
exports.refundFromReview = refundFromReview;
const payout = (clinic, n) => [dr(exports.A.payable(clinic), n), cr(exports.A.clearing, n)];
exports.payout = payout;
const rewardTender = (clinic, refundCreditMinor, promoMinor) => [...(refundCreditMinor > 0 ? [dr(exports.A.patientRefundCredit, refundCreditMinor)] : []), ...(promoMinor > 0 ? [dr(exports.A.promoFunded, promoMinor)] : []), cr(exports.A.held(clinic), refundCreditMinor + promoMinor)];
exports.rewardTender = rewardTender;
const rewardRestore = (account, refundCreditMinor, promoMinor) => [dr(account, refundCreditMinor + promoMinor), ...(refundCreditMinor > 0 ? [cr(exports.A.patientRefundCredit, refundCreditMinor)] : []), ...(promoMinor > 0 ? [cr(exports.A.promoFunded, promoMinor)] : [])];
exports.rewardRestore = rewardRestore;
const sponsorTender = (clinic, n) => [dr(exports.A.sponsorFunded, n), cr(exports.A.held(clinic), n)];
exports.sponsorTender = sponsorTender;
const sponsorVoid = (account, n) => [dr(account, n), cr(exports.A.sponsorFunded, n)];
exports.sponsorVoid = sponsorVoid;
const refundToCredit = (n) => [dr(exports.A.refundPayable, n), cr(exports.A.patientRefundCredit, n)];
exports.refundToCredit = refundToCredit;
const refundCreditExpired = (n) => [dr(exports.A.patientRefundCredit, n), cr(exports.A.refundPayable, n)];
exports.refundCreditExpired = refundCreditExpired;
class LedgerError extends Error {
}
exports.LedgerError = LedgerError;
function assertValid(p) {
    if (!p.length)
        throw new LedgerError('empty transaction');
    let d = 0, c = 0;
    for (const e of p) {
        if (!Number.isInteger(e.debit) || !Number.isInteger(e.credit) || e.debit < 0 || e.credit < 0)
            throw new LedgerError('amounts must be non-negative integers');
        if (e.debit > 0 && e.credit > 0)
            throw new LedgerError('entry must be single-sided');
        d += e.debit;
        c += e.credit;
    }
    if (d !== c)
        throw new LedgerError(`unbalanced: debit ${d} credit ${c}`);
    if (d === 0)
        throw new LedgerError('zero-value transaction');
}
const DEBIT_NORMAL = (a) => a === exports.A.clearing || a === exports.A.fees || a === exports.A.promoFunded || a === exports.A.sponsorFunded;
class LedgerBook {
    txs = new Map();
    bal = new Map();
    post(tx) {
        if (this.txs.has(tx.key))
            return false;
        assertValid(tx.postings);
        const next = new Map(this.bal);
        for (const e of tx.postings) {
            const delta = DEBIT_NORMAL(e.account) ? e.debit - e.credit : e.credit - e.debit;
            next.set(e.account, (next.get(e.account) ?? 0) + delta);
        }
        for (const [acct, v] of next) {
            if (!DEBIT_NORMAL(acct) && v < 0)
                throw new LedgerError(`liability ${acct} would go negative (${v})`);
        }
        this.bal = next;
        this.txs.set(tx.key, tx);
        return true;
    }
    balance(account) { return this.bal.get(account) ?? 0; }
    accounts() { return [...this.bal.keys()]; }
    totals() {
        let d = 0, c = 0;
        for (const t of this.txs.values())
            for (const e of t.postings) {
                d += e.debit;
                c += e.credit;
            }
        return { debit: d, credit: c };
    }
    liabilities() { return this.accounts().filter((a) => !DEBIT_NORMAL(a)).reduce((s, a) => s + this.balance(a), 0); }
}
exports.LedgerBook = LedgerBook;
function identityHolds(book) {
    return book.balance(exports.A.clearing) + book.balance(exports.A.fees) + book.balance(exports.A.promoFunded) + book.balance(exports.A.sponsorFunded) === book.liabilities();
}
//# sourceMappingURL=ledger.js.map