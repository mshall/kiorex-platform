/**
 * COM-1 commission collection: pure domain (no I/O). Everything here is deterministic and unit-tested.
 *
 * Founder decision (binding): Kiorex collects the commissions it is owed and settles them automatically through the payment provider each organisation chose, with full
 * transparency on both sides. Kiorly never holds funds in the design: money moves on licensed provider rails only (counsel decides the funds flow, LG-COM-3).
 *
 * Rules enforced here:
 *  - cycle, cut-off, grace, retry days, minimum, invoice due days, mode are CONFIG. No value is shipped: `null` = NOT CONFIGURED (NEEDS_HUMAN, LG-COM-1) and automatic collection does not run.
 *  - a claim is never written off: whatever cannot be collected rolls into an invoice (safe fallback) or into the next period; collection NEVER blocks patient care (this module has no pause, no listing, no gate).
 *  - the claims of a period are exactly the CONFIRMED, undisputed, past-dispute-window, uncollected claims up to the cut-off (earlier uncollected ones carry over).
 */

export const COLLECTION_MODES = ['NET_FROM_PAYOUT', 'AUTO_CHARGE_SAVED_METHOD', 'INVOICE_AND_COLLECT'] as const;
export type CollectionMode = (typeof COLLECTION_MODES)[number];
export const CYCLES = ['WEEKLY', 'MONTHLY'] as const;
export type Cycle = (typeof CYCLES)[number];

export interface CollectionSettings {
  mode: CollectionMode | null;
  cycle: Cycle | null;
  /** MONTHLY: day of month 1..28 on which a period is cut. WEEKLY: ISO weekday 1 (Mon)..7 (Sun). Cut-off is 00:00 UTC of that day. */
  cutoffDay: number | null;
  /** Days after the cut-off before the first collection attempt (late disputes and reversals settle first). */
  graceDays: number | null;
  /** Dunning: days after the first failed attempt for each retry, ascending (e.g. a placeholder list set in the console). After the last one the run falls back to an invoice. */
  retryDays: number[] | null;
  /** Below this total a period's claims roll to the next period (never lost). 0 = collect any amount. */
  minCollectMinor: number | null;
  /** Days a fallback or INVOICE_AND_COLLECT invoice stays payable before it ages as overdue. */
  invoiceDueDays: number | null;
}

export const EMPTY_SETTINGS: CollectionSettings = { mode: null, cycle: null, cutoffDay: null, graceDays: null, retryDays: null, minCollectMinor: null, invoiceDueDays: null };

const int = (v: unknown, min: number, max: number): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null);

/** Strict parse of a stored or submitted settings object; unknown keys are dropped, invalid values become null (and are reported by settingsProblems on the raw input). */
export function parseSettings(raw: unknown): CollectionSettings {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const retry = Array.isArray(o.retryDays) && o.retryDays.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 60) && o.retryDays.every((n, i, a) => i === 0 || n > (a[i - 1] as number)) && o.retryDays.length <= 6 ? (o.retryDays as number[]) : null;
  const cycle = CYCLES.includes(o.cycle as Cycle) ? (o.cycle as Cycle) : null;
  return {
    mode: COLLECTION_MODES.includes(o.mode as CollectionMode) ? (o.mode as CollectionMode) : null,
    cycle,
    cutoffDay: cycle === 'WEEKLY' ? int(o.cutoffDay, 1, 7) : cycle === 'MONTHLY' ? int(o.cutoffDay, 1, 28) : int(o.cutoffDay, 1, 28),
    graceDays: int(o.graceDays, 0, 30),
    retryDays: retry,
    minCollectMinor: int(o.minCollectMinor, 0, 100_000_000),
    invoiceDueDays: int(o.invoiceDueDays, 1, 90),
  };
}

/** Problems with a submitted settings object (field names and reasons only, never values of secrets: there are none). Null values are allowed (not configured). */
export function settingsProblems(raw: unknown): string[] {
  const out: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ['settings must be an object'];
  const o = raw as Record<string, unknown>;
  const known = new Set(Object.keys(EMPTY_SETTINGS));
  for (const k of Object.keys(o)) if (!known.has(k)) out.push(`unknown setting ${k}`);
  const p = parseSettings(o);
  for (const k of Object.keys(EMPTY_SETTINGS) as (keyof CollectionSettings)[]) if (o[k] !== undefined && o[k] !== null && p[k] === null) out.push(`${k} is invalid`);
  if (o.cutoffDay != null && p.cycle === null && o.cycle == null) out.push('cutoffDay needs a cycle');
  return out;
}

/** Org settings win field by field over the market defaults; null/undefined in the override means "inherit". */
export function resolveSettings(market: CollectionSettings | null | undefined, org: Partial<CollectionSettings> | null | undefined): CollectionSettings {
  const m = market ?? EMPTY_SETTINGS;
  const pick = <K extends keyof CollectionSettings>(k: K): CollectionSettings[K] => (org && org[k] !== undefined && org[k] !== null ? (org[k] as CollectionSettings[K]) : m[k]);
  return { mode: pick('mode'), cycle: pick('cycle'), cutoffDay: pick('cutoffDay'), graceDays: pick('graceDays'), retryDays: pick('retryDays'), minCollectMinor: pick('minCollectMinor'), invoiceDueDays: pick('invoiceDueDays') };
}

/** What is still missing before automatic collection can run. Empty = configured. */
export function missingSettings(s: CollectionSettings): (keyof CollectionSettings)[] {
  return (Object.keys(EMPTY_SETTINGS) as (keyof CollectionSettings)[]).filter((k) => s[k] === null && !(k === 'invoiceDueDays' && s.mode === 'NET_FROM_PAYOUT'));
}

// ───────────────────────── periods ─────────────────────────
const DAY = 86_400_000;
export const utcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
export const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** The most recent cut-off at or before `now`. */
export function latestCutoff(now: Date, cycle: Cycle, cutoffDay: number): Date {
  const today = utcDay(now);
  if (cycle === 'WEEKLY') {
    const wd = today.getUTCDay() === 0 ? 7 : today.getUTCDay();
    return new Date(today.getTime() - ((wd - cutoffDay + 7) % 7) * DAY);
  }
  const thisMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), cutoffDay));
  return thisMonth.getTime() <= today.getTime() ? thisMonth : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, cutoffDay));
}
export function previousCutoff(cutoff: Date, cycle: Cycle, cutoffDay: number): Date {
  return cycle === 'WEEKLY' ? new Date(cutoff.getTime() - 7 * DAY) : new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() - 1, cutoffDay));
}
export const periodKeyOf = (cutoff: Date) => dayKey(cutoff);
export const collectAtOf = (cutoff: Date, graceDays: number) => new Date(cutoff.getTime() + graceDays * DAY);

/** The cut-off of the newest period whose collection time has arrived, or null when the settings are not configured / the grace has not passed yet. */
export function duePeriod(now: Date, s: CollectionSettings): { cutoff: Date; periodKey: string; collectAt: Date; periodStart: Date } | null {
  if (!s.cycle || s.cutoffDay === null || s.graceDays === null) return null;
  let cutoff = latestCutoff(now, s.cycle, s.cutoffDay);
  let collectAt = collectAtOf(cutoff, s.graceDays);
  if (collectAt.getTime() > now.getTime()) { cutoff = previousCutoff(cutoff, s.cycle, s.cutoffDay); collectAt = collectAtOf(cutoff, s.graceDays); }
  if (collectAt.getTime() > now.getTime()) return null;
  return { cutoff, periodKey: periodKeyOf(cutoff), collectAt, periodStart: previousCutoff(cutoff, s.cycle, s.cutoffDay) };
}

// ───────────────────────── eligibility ─────────────────────────
export interface ClaimLite { id: string; amountMinor: number; decisionAmountMinor: number | null; chargeStatus: string; collectionStatus: string; confirmedAt: Date | null; disputeDeadline: Date | null; disputeStatus: string | null; currency: string }

/** A claim enters the run of the period closing at `cutoff` only when confirmed, never disputed-open, past its dispute window, and not collected already. Earlier uncollected claims carry over. */
export function eligibleForRun(c: ClaimLite, cutoff: Date): boolean {
  if (c.collectionStatus !== 'UNCOLLECTED') return false;
  if (c.chargeStatus !== 'CONFIRMED') return false;
  if (c.disputeStatus === 'OPEN') return false;
  if (!c.confirmedAt || c.confirmedAt.getTime() >= cutoff.getTime()) return false;
  if (c.disputeDeadline && c.disputeDeadline.getTime() > cutoff.getTime()) return false;
  return c.amountMinor > 0;
}

// ───────────────────────── mode and fallback ─────────────────────────
export interface OrgFacts { provider: string | null; hasSavedMethod: boolean; payableMinor: number }
export type FallbackReason = 'NO_PROVIDER_CHOSEN' | 'NO_SAVED_METHOD' | 'NOT_CONFIGURED' | 'NET_SHORTFALL' | 'RETRIES_EXHAUSTED' | 'RAIL_NOT_APPROVED';

/** The mode a run really starts with. The configured mode when its prerequisites hold; else the safe fallback INVOICE_AND_COLLECT with the reason (never a silent skip, never a write-off). */
export function startingMode(s: CollectionSettings, f: OrgFacts): { mode: CollectionMode; requested: CollectionMode | null; fallbackReason?: FallbackReason } {
  const requested = s.mode;
  if (!requested) return { mode: 'INVOICE_AND_COLLECT', requested, fallbackReason: 'NOT_CONFIGURED' };
  if (requested === 'AUTO_CHARGE_SAVED_METHOD') {
    if (!f.provider) return { mode: 'INVOICE_AND_COLLECT', requested, fallbackReason: 'NO_PROVIDER_CHOSEN' };
    if (!f.hasSavedMethod) return { mode: 'INVOICE_AND_COLLECT', requested, fallbackReason: 'NO_SAVED_METHOD' };
  }
  return { mode: requested, requested };
}

/** Split of a total across what payouts can absorb and the invoiced remainder: net-from-payout never takes more than the payable, the rest is invoiced (partial). */
export function netSplit(totalMinor: number, payableMinor: number): { netMinor: number; invoiceMinor: number } {
  const net = Math.max(0, Math.min(totalMinor, payableMinor));
  return { netMinor: net, invoiceMinor: totalMinor - net };
}

// ───────────────────────── dunning ─────────────────────────
export type AfterFailure = { action: 'RETRY'; at: Date; attemptNo: number } | { action: 'FALL_BACK_TO_INVOICE' };

/** After attempt `attemptNo` (1-based) failed at `failedAt`: retry per the configured days counted from the FIRST attempt, else fall back to an invoice. A non-retryable failure falls back at once. */
export function afterFailure(attemptNo: number, firstAttemptAt: Date, failedAt: Date, retryDays: number[] | null, retryable: boolean): AfterFailure {
  if (!retryable || !retryDays || attemptNo > retryDays.length) return { action: 'FALL_BACK_TO_INVOICE' };
  const at = new Date(firstAttemptAt.getTime() + retryDays[attemptNo - 1]! * DAY);
  return { action: 'RETRY', at: at.getTime() > failedAt.getTime() ? at : new Date(failedAt.getTime() + DAY), attemptNo: attemptNo + 1 };
}

// ───────────────────────── aging ─────────────────────────
export const AGING_BUCKETS = ['CURRENT', 'D1_30', 'D31_60', 'D61_90', 'D90_PLUS'] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];
/** Days past due of an open item (due date null = not yet invoiced = counted from its collect-at). */
export function agingBucket(dueAt: Date, now: Date): AgingBucket {
  const d = Math.floor((utcDay(now).getTime() - utcDay(dueAt).getTime()) / DAY);
  return d <= 0 ? 'CURRENT' : d <= 30 ? 'D1_30' : d <= 60 ? 'D31_60' : d <= 90 ? 'D61_90' : 'D90_PLUS';
}

// ───────────────────────── reconciliation ─────────────────────────
export interface Finding { code: string; orgRef: string; periodKey?: string; ref?: string; expectedMinor: number; actualMinor: number; message: string }
export interface ReconRun { id: string; orgRef: string; periodKey: string; claimsMinor: number; claimsCount: number; collectedMinor: number; deductedMinor: number; invoicedMinor: number; paidMinor: number; status: string }
export interface ReconClaim { id: string; runId: string | null; amountMinor: number; decisionAmountMinor: number | null; collectionStatus: string; collectedMinor: number; chargeStatus: string }
export interface ReconAttempt { runId: string; kind: string; status: string; amountMinor: number }

/**
 * The two checks the founder asked for, per organisation and period:
 *  1. commission charged = the decision amounts (a claim whose amount differs from its decision, or that has no decision amount, is a finding);
 *  2. the run's claims = collected + deducted + invoiced (+ nothing silently missing), and every figure of a run equals the sum of its succeeded attempts and its claims.
 */
export function reconcileRun(run: ReconRun, claims: ReconClaim[], attempts: ReconAttempt[]): Finding[] {
  const f: Finding[] = [];
  const base = { orgRef: run.orgRef, periodKey: run.periodKey };
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const mine = claims.filter((c) => c.runId === run.id);
  const claimsMinor = sum(mine.map((c) => c.amountMinor));
  if (claimsMinor !== run.claimsMinor || mine.length !== run.claimsCount) f.push({ ...base, code: 'RUN_CLAIMS_MISMATCH', ref: run.id, expectedMinor: run.claimsMinor, actualMinor: claimsMinor, message: `run states ${run.claimsCount} claims / ${run.claimsMinor}, its claims sum to ${mine.length} / ${claimsMinor}` });
  for (const c of mine) {
    if (c.decisionAmountMinor === null) f.push({ ...base, code: 'NO_DECISION_AMOUNT', ref: c.id, expectedMinor: c.amountMinor, actualMinor: 0, message: 'claim has no decision amount to compare with' });
    else if (c.decisionAmountMinor !== c.amountMinor) f.push({ ...base, code: 'CHARGE_NE_DECISION', ref: c.id, expectedMinor: c.decisionAmountMinor, actualMinor: c.amountMinor, message: 'charged amount differs from the decision amount' });
  }
  const ok = (kind: string) => sum(attempts.filter((a) => a.runId === run.id && a.kind === kind && a.status === 'SUCCEEDED').map((a) => a.amountMinor));
  if (ok('CHARGE') !== run.collectedMinor) f.push({ ...base, code: 'COLLECTED_NE_ATTEMPTS', ref: run.id, expectedMinor: run.collectedMinor, actualMinor: ok('CHARGE'), message: 'collected total differs from succeeded charge attempts' });
  if (ok('DEDUCT') !== run.deductedMinor) f.push({ ...base, code: 'DEDUCTED_NE_ATTEMPTS', ref: run.id, expectedMinor: run.deductedMinor, actualMinor: ok('DEDUCT'), message: 'deducted total differs from succeeded payout deductions' });
  if (ok('INVOICE_PAYMENT') !== run.paidMinor) f.push({ ...base, code: 'PAID_NE_ATTEMPTS', ref: run.id, expectedMinor: run.paidMinor, actualMinor: ok('INVOICE_PAYMENT'), message: 'invoice paid total differs from succeeded invoice payments' });
  const settled = run.collectedMinor + run.deductedMinor + run.invoicedMinor;
  if (!['PLANNED', 'COLLECTING', 'RETRYING', 'NOT_CONFIGURED', 'BELOW_MINIMUM', 'NOTHING_DUE'].includes(run.status) && settled !== run.claimsMinor) f.push({ ...base, code: 'RUN_NOT_FULLY_ACCOUNTED', ref: run.id, expectedMinor: run.claimsMinor, actualMinor: settled, message: 'collected + deducted + invoiced must equal the run claims' });
  if (run.paidMinor > run.invoicedMinor) f.push({ ...base, code: 'PAID_GT_INVOICED', ref: run.id, expectedMinor: run.invoicedMinor, actualMinor: run.paidMinor, message: 'invoice paid exceeds invoiced' });
  return f;
}

/** Per-organisation payout check: a payout's gross (cash + deducted commission) equals the released deposits it claimed, and the deducted amount equals the succeeded DEDUCT attempts naming it. */
export function reconcilePayout(p: { payoutRef: string; clinicId: string; amountMinor: number; commissionDeductedMinor: number }, grossReleasedMinor: number, deductAttempts: number[]): Finding[] {
  const f: Finding[] = [];
  if (p.amountMinor + p.commissionDeductedMinor !== grossReleasedMinor) f.push({ orgRef: p.clinicId, code: 'PAYOUT_GROSS_MISMATCH', ref: p.payoutRef, expectedMinor: grossReleasedMinor, actualMinor: p.amountMinor + p.commissionDeductedMinor, message: 'cash paid + commission deducted differs from the released deposits' });
  const d = deductAttempts.reduce((a, b) => a + b, 0);
  if (d !== p.commissionDeductedMinor) f.push({ orgRef: p.clinicId, code: 'PAYOUT_DEDUCTION_MISMATCH', ref: p.payoutRef, expectedMinor: p.commissionDeductedMinor, actualMinor: d, message: 'deduction on the payout differs from the deduction attempts' });
  return f;
}

/** Cursor-free stable CSV (RFC 4180, formula-injection safe: a cell starting with = + - @ gets a leading apostrophe). */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const toCsv = (header: string[], rows: unknown[][]): string => `﻿${[header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
export const major = (minor: number): string => `${minor < 0 ? '-' : ''}${Math.floor(Math.abs(minor) / 100)}.${String(Math.abs(minor) % 100).padStart(2, '0')}`;
