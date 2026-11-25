import type { Tx } from '../prisma/prisma.service';
import { assertValid, type LedgerTxInput, type Posting } from './ledger';

/** Idempotent ledger write shared by PayService and the PAY-READY services (disputes, reconciliation): one LedgerTx per idempotency key, balanced and single-sided by construction (and by the database triggers). Returns false for a replay. */
export async function postLedgerTx(tx: Tx, t: LedgerTxInput & { bookingId?: string | null; paymentId?: string; clinicId?: string; memo?: string }): Promise<boolean> {
  assertValid(t.postings);
  const exists = await tx.ledgerTx.findUnique({ where: { idempotencyKey: t.key } });
  if (exists) return false;
  await tx.ledgerTx.create({
    data: { idempotencyKey: t.key, kind: t.kind, bookingId: t.bookingId ?? undefined, paymentId: t.paymentId, clinicId: t.clinicId, memo: t.memo, entries: { create: t.postings.map((p: Posting) => ({ account: p.account, debitMinor: p.debit, creditMinor: p.credit })) } },
  });
  return true;
}
