import { createHash } from 'node:crypto';
import { decimalsOf, fromMajor } from '../common/providers/vendors/money';
import type { SettlementFormat } from './psp-config';

/**
 * Settlement / report file import (PAY-READY). A vendor settlement or transactions report (CSV or JSON) becomes normalised lines; reconciliation matches them to the Pay ledger.
 * The exact column names of each vendor's export are NOT assumed in code: the built-in header aliases below cover the usual names, and ANY vendor file is mapped without a deploy with
 * the PSP's `settlement` setting (column names, major/minor unit, kind words) once the first real sandbox export is in hand (runbook step "reconciliation check"). A row that cannot be read
 * is REJECTED with a reason and counted, never guessed. Amounts are parsed exactly (no float rounding): "150.5" with 2 decimals is 15050, "150.555" is rejected.
 */
export type SettlementKind = 'CAPTURE' | 'REFUND' | 'CHARGEBACK' | 'PAYOUT' | 'FEE_ADJUST';
export interface SettlementLineIn { pspRef: string; kind: SettlementKind; amountMinor: number; feeMinor: number; date: string; currency: string; payoutRef?: string }
export interface SettlementParse { lines: SettlementLineIn[]; rejected: Array<{ row: number; reason: string }>; format: 'CSV' | 'JSON'; sha256: string }

const ALIASES: Record<string, string[]> = {
  pspRef: ['orderid', 'merchantrefnumber', 'merchantreference', 'merchantorderid', 'orderreference', 'reference', 'pspref', 'paymentref', 'paymentid', 'transactionreference'],
  amount: ['amount', 'amountcents', 'amountminor', 'paymentamount', 'grossamount', 'transactionamount', 'amountegp'],
  fee: ['fee', 'fees', 'feeamount', 'feeminor', 'fawryfees', 'commission', 'mdr'],
  kind: ['type', 'transactiontype', 'kind', 'operation', 'transactionkind', 'entrytype'],
  date: ['settlementdate', 'settledat', 'date', 'transactiondate', 'paymentdate', 'createdat', 'processedat'],
  payoutRef: ['payoutid', 'payoutref', 'settlementid', 'settlementref', 'batchid', 'batchref', 'transferid'],
  currency: ['currency', 'currencycode', 'ccy'],
  status: ['status', 'state', 'result', 'transactionstatus'],
};
const KIND_WORDS: Record<string, SettlementKind> = {
  sale: 'CAPTURE', payment: 'CAPTURE', purchase: 'CAPTURE', capture: 'CAPTURE', captured: 'CAPTURE', paid: 'CAPTURE', charge: 'CAPTURE', auth_capture: 'CAPTURE',
  refund: 'REFUND', refunded: 'REFUND', partial_refund: 'REFUND', partialrefund: 'REFUND', void_refund: 'REFUND',
  chargeback: 'CHARGEBACK', dispute: 'CHARGEBACK', cb: 'CHARGEBACK', chargeback_lost: 'CHARGEBACK',
  payout: 'PAYOUT', settlement: 'PAYOUT', transfer: 'PAYOUT', disbursement: 'PAYOUT',
  fee: 'FEE_ADJUST', fee_adjustment: 'FEE_ADJUST', adjustment: 'FEE_ADJUST',
};
const DEFAULT_SKIP = ['failed', 'declined', 'error', 'voided', 'void', 'pending', 'cancelled', 'canceled', 'expired', 'rejected'];
const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

/** RFC 4180 CSV: quoted fields, doubled quotes, CRLF / LF, BOM; blank lines skipped. */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, '');
  const rows: string[][] = []; let row: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((x) => x.trim() !== '')) rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur); if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

const isoDate = (v: unknown): string | null => {
  const s = String(v ?? '').trim(); if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s) ?? /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (m) { const [y, mo, d] = m[1].length === 4 ? [m[1], m[2], m[3]] : [m[3], m[2], m[1]]; const dt = new Date(`${y}-${mo}-${d}T00:00:00Z`); return Number.isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10); }
  const dt = new Date(s); return Number.isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
};

export function parseSettlement(content: string, o: { format?: 'CSV' | 'JSON'; defaultCurrency?: string; mapping?: SettlementFormat | null } = {}): SettlementParse {
  const sha256 = createHash('sha256').update(content, 'utf8').digest('hex');
  const trimmed = content.trimStart();
  const format = o.format ?? (trimmed.startsWith('[') || trimmed.startsWith('{') ? 'JSON' : 'CSV');
  let records: Array<Record<string, unknown>> = [];
  const rejected: SettlementParse['rejected'] = [];
  if (format === 'JSON') {
    let j: any; try { j = JSON.parse(content); } catch { return { lines: [], rejected: [{ row: 0, reason: 'NOT_VALID_JSON' }], format, sha256 }; }
    const arr = Array.isArray(j) ? j : Array.isArray(j?.transactions) ? j.transactions : Array.isArray(j?.data) ? j.data : Array.isArray(j?.lines) ? j.lines : null;
    if (!arr) return { lines: [], rejected: [{ row: 0, reason: 'NO_ROWS_ARRAY' }], format, sha256 };
    records = arr.filter((r: unknown) => r && typeof r === 'object');
  } else {
    const rows = parseCsv(content);
    if (rows.length < 2) return { lines: [], rejected: [{ row: 0, reason: 'NO_DATA_ROWS' }], format, sha256 };
    const head = rows[0].map((h) => h.trim());
    records = rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
  }
  const m = o.mapping ?? null;
  let lastKey = '';
  const pick = (rec: Record<string, unknown>, field: string): unknown => {
    const forced = m?.columns?.[field as keyof SettlementFormat['columns']];
    const keys = Object.keys(rec);
    lastKey = '';
    if (forced) { const k = keys.find((x) => x.trim().toLowerCase() === forced.toLowerCase()); if (k !== undefined) lastKey = k; return k === undefined ? undefined : rec[k]; }
    for (const a of ALIASES[field]) { const k = keys.find((x) => norm(x) === a); if (k !== undefined && rec[k] !== '' && rec[k] !== null && rec[k] !== undefined) { lastKey = k; return rec[k]; } }
    return undefined;
  };
  const MINOR_KEYS = new Set(['amountcents', 'amountminor', 'feeminor', 'feecents']);
  const minorUnit = m?.amountUnit === 'minor';
  const skip = new Set([...(m?.skipStatuses ?? DEFAULT_SKIP)]);
  const lines: SettlementLineIn[] = []; const seen = new Map<string, number>();
  records.forEach((rec, idx) => {
    const row = idx + 1; const bad = (reason: string) => rejected.push({ row, reason });
    const status = String(pick(rec, 'status') ?? '').trim().toLowerCase();
    if (status && skip.has(status)) return; // not a money movement
    const kindWord = String(pick(rec, 'kind') ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    const kind = m?.kindMap?.[kindWord] ?? KIND_WORDS[kindWord] ?? (kindWord ? undefined : 'CAPTURE');
    if (!kind) return bad(`UNKNOWN_KIND:${kindWord.slice(0, 30)}`);
    const currency = String(pick(rec, 'currency') ?? o.defaultCurrency ?? 'EGP').toUpperCase();
    const dec = decimalsOf(currency);
    const rawAmt = String(pick(rec, 'amount') ?? '').replace(/^-/, '').replace(/,/g, '');
    const amtMinor = minorUnit || MINOR_KEYS.has(norm(lastKey)); // a column NAMED cents / minor is minor units whatever the file-level unit
    const amount = amtMinor ? (/^\d+$/.test(rawAmt) ? Number(rawAmt) : null) : fromMajor(rawAmt, dec);
    if (amount === null || !Number.isSafeInteger(amount)) return bad('BAD_AMOUNT');
    const rawFee = String(pick(rec, 'fee') ?? '').replace(/^-/, '').replace(/,/g, '');
    const feeMinor = minorUnit || MINOR_KEYS.has(norm(lastKey));
    const fee = rawFee === '' ? 0 : feeMinor ? (/^\d+$/.test(rawFee) ? Number(rawFee) : null) : fromMajor(rawFee, dec);
    if (fee === null) return bad('BAD_FEE');
    const date = isoDate(pick(rec, 'date')); if (!date) return bad('BAD_DATE');
    const payoutRef = String(pick(rec, 'payoutRef') ?? '').trim();
    let ref = String(pick(rec, 'pspRef') ?? '').trim() || (kind === 'PAYOUT' ? payoutRef : ''); if (!ref) return bad('NO_REFERENCE');
    const n = (seen.get(`${ref}|${kind}`) ?? 0) + 1; seen.set(`${ref}|${kind}`, n); if (n > 1) ref = `${ref}#${n}`; // several refunds / chargebacks of one order stay distinct lines
    lines.push({ pspRef: ref, kind, amountMinor: amount, feeMinor: fee, date, currency, ...(payoutRef ? { payoutRef } : {}) });
  });
  return { lines, rejected, format, sha256 };
}

/** The order reference of a stored line (`ABC#2` -> `ABC`). */
export const baseRef = (pspRef: string) => pspRef.replace(/#\d+$/, '');

/** The Pay-side expected net of one settlement batch: captures minus fees minus refunds minus chargebacks. */
export const expectedNet = (lines: SettlementLineIn[]): number => lines.reduce((s, l) => s + (l.kind === 'CAPTURE' ? l.amountMinor - l.feeMinor : l.kind === 'REFUND' || l.kind === 'CHARGEBACK' ? -l.amountMinor : l.kind === 'FEE_ADJUST' ? -l.amountMinor : 0), 0);
