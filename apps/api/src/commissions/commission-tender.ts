/**
 * LG-COM-20 (founder, 27 Nov 2026): a direct bank transfer, InstaPay transfer or card-terminal payment made at the clinic is a CASH-TYPE tender for commission accrual and netting
 * (Kiorex cannot net it from that visit's payout, so it accrues and is netted in the next bank payout) AND is recorded as its own kind, `CASH_TRANSFER`, so Ops, providers and the statement
 * can tell it apart from plain cash. The wire `tender` stays CASH | ONLINE (contracts 1.13.0 is not changed): the kind travels in two additive optional fields,
 *   tenderMethod  CASH | CASH_TRANSFER   (only meaningful with tender CASH)
 *   tenderDetail  BANK_TRANSFER | INSTAPAY | CARD_TERMINAL   (only with CASH_TRANSFER)
 * An older client sends neither: its CASH reads as plain cash. A visit whose tender is not reported stays unknown; nothing is guessed.
 */
export const TENDERS = ['CASH', 'ONLINE'] as const;
export const TENDER_METHODS = ['CASH', 'CASH_TRANSFER'] as const;
export const TENDER_DETAILS = ['BANK_TRANSFER', 'INSTAPAY', 'CARD_TERMINAL'] as const;
export type Tender = (typeof TENDERS)[number];
export type TenderMethod = (typeof TENDER_METHODS)[number];
export type TenderDetail = (typeof TENDER_DETAILS)[number];
export type TenderFields = { tender: Tender | null; tenderMethod: TenderMethod | null; tenderDetail: TenderDetail | null };

const up = (v: unknown) => (typeof v === 'string' ? v.trim().toUpperCase() : '');
const pick = <T extends string>(list: readonly T[], v: unknown): T | null => (list as readonly string[]).includes(up(v)) ? (up(v) as T) : null;

/** Additive, lenient intake: unknown values are dropped (never rejected, never guessed); a method or detail is kept only when it agrees with the wire tender. */
export function parseTenderFields(data: { tender?: unknown; tenderMethod?: unknown; tenderDetail?: unknown }): TenderFields {
  const tender = pick(TENDERS, data.tender);
  if (tender !== 'CASH') return { tender, tenderMethod: null, tenderDetail: null };
  const tenderMethod = pick(TENDER_METHODS, data.tenderMethod);
  const tenderDetail = tenderMethod === 'CASH_TRANSFER' ? pick(TENDER_DETAILS, data.tenderDetail) : null;
  return { tender, tenderMethod, tenderDetail };
}

/** Kind of a cash-type claim for the statement: an explicit CASH_TRANSFER is its own kind, everything else that is CASH (including an older client with no method) is plain cash. */
export const isCashTransfer = (c: { tender: string | null; tenderMethod?: string | null }) => c.tender === 'CASH' && c.tenderMethod === 'CASH_TRANSFER';
