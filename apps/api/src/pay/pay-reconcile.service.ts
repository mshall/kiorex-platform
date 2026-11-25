import { Inject, Injectable, Optional } from '@nestjs/common';
import { cfg } from '../common/config';
import { badRequest } from '../common/errors';
import { CORPORATE_BENEFIT_PORT, type CorporateBenefitPort } from '../growth/growth-ports-public';
import { Prisma } from '../prisma/generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { A } from './ledger';
import { PSP_NAMES } from './psp-config';
import { PspConfigService } from './psp-config.service';
import { baseRef, expectedNet, parseSettlement, type SettlementKind, type SettlementLineIn } from './settlement-import';

export interface Discrepancy { type: string; ref: string; psp?: string; detail?: unknown }
const DAY = 86_400_000;
const day = (d: Date) => new Date(d.toISOString().slice(0, 10));
const AUTH_EXPIRY_WARN_DAYS = 6; // card authorisations commonly lapse after ~7 days (NEEDS_HUMAN: take the figure from each merchant agreement)

/**
 * Settlement reconciliation (KXM-PAY-05, PAY-READY): vendor report files (CSV / JSON) are imported once (idempotent on the file hash), then matched to the Pay ledger every day:
 * captures (amount and fee), refunds, chargebacks, payout batches, plus the internal invariants (balanced transactions, sponsored and corporate shares, held reviews, 3DS tripwire,
 * authorisations about to lapse, disputes with evidence due). Every mismatch is a typed row in the run (the "mismatch report", also as CSV); nothing here moves money.
 */
@Injectable()
export class PayReconcileService {
  constructor(private readonly prisma: PrismaService, private readonly config: PspConfigService, @Optional() @Inject(CORPORATE_BENEFIT_PORT) private readonly corporate?: CorporateBenefitPort) {}

  async importSettlementLines(lines: { psp: string; pspRef: string; kind: SettlementKind; amountMinor: number; feeMinor?: number; date: string; currency?: string; payoutRef?: string; fileId?: string }[]) {
    for (const l of lines) await this.prisma.pspSettlementLine.upsert({ where: { psp_pspRef_kind: { psp: l.psp, pspRef: l.pspRef, kind: l.kind } }, create: { psp: l.psp, pspRef: l.pspRef, kind: l.kind, amountMinor: l.amountMinor, feeMinor: l.feeMinor ?? 0, date: new Date(l.date), currency: l.currency ?? 'EGP', payoutRef: l.payoutRef, fileId: l.fileId }, update: { amountMinor: l.amountMinor, feeMinor: l.feeMinor ?? 0, ...(l.payoutRef ? { payoutRef: l.payoutRef } : {}) } });
    return { imported: lines.length };
  }

  /** One vendor report file. Idempotent: the same bytes for the same PSP import nothing the second time. Unreadable rows are rejected with a reason and never guessed. */
  async importFile(i: { psp: string; filename: string; content: string; actor: string; format?: 'CSV' | 'JSON'; mode?: 'sandbox' | 'live' }) {
    if (!PSP_NAMES.includes(i.psp as never)) throw badRequest('UNKNOWN_PSP', 'Unknown payment provider');
    if (!i.content || i.content.length > 8_000_000) throw badRequest('FILE_TOO_LARGE', 'The settlement file is empty or larger than 8 MB');
    const s = await this.config.settingsFor(i.psp as never);
    const parsed = parseSettlement(i.content, { format: i.format, mapping: s.settlement });
    const dup = await this.prisma.pspSettlementFile.findUnique({ where: { psp_sha256: { psp: i.psp, sha256: parsed.sha256 } } });
    if (dup) return { fileId: dup.id, duplicate: true, imported: 0, rejected: [] as SettlementParseRejected[], chargebacks: [] as SettlementLineIn[], totals: dup.totals };
    const totals = { captures: sum(parsed.lines, 'CAPTURE'), refunds: sum(parsed.lines, 'REFUND'), chargebacks: sum(parsed.lines, 'CHARGEBACK'), fees: parsed.lines.reduce((t, l) => t + l.feeMinor, 0), payouts: sum(parsed.lines, 'PAYOUT'), expectedNetMinor: expectedNet(parsed.lines.filter((l) => l.kind !== 'PAYOUT')) };
    const file = await this.prisma.pspSettlementFile.create({ data: { psp: i.psp, format: parsed.format, filename: i.filename.slice(0, 200), sha256: parsed.sha256, lineCount: parsed.lines.length, rejected: parsed.rejected.length, totals: totals as never, mode: i.mode ?? s.mode, importedBy: i.actor } });
    await this.importSettlementLines(parsed.lines.map((l) => ({ psp: i.psp, ...l, fileId: file.id })));
    await this.prisma.auditLog.create({ data: { actor: i.actor, action: 'pay.settlement_imported', resource: 'PspSettlementFile', resourceId: file.id, metadata: { psp: i.psp, lines: parsed.lines.length, rejected: parsed.rejected.length } } });
    return { fileId: file.id, duplicate: false, imported: parsed.lines.length, rejected: parsed.rejected, chargebacks: parsed.lines.filter((l) => l.kind === 'CHARGEBACK'), totals };
  }

  /** Daily PSP reconciliation + internal ledger integrity. Records a run; discrepancies surface in ops. */
  async reconcileDaily(date = new Date()) {
    const d = day(date); const next = new Date(d.getTime() + DAY);
    const disc: Discrepancy[] = [];
    const mode = (await this.config.settingsFor('paymob')).mode;
    const captured = await this.prisma.paymentIntent.findMany({ where: { capturedAt: { gte: d, lt: next }, OR: [{ pspMode: null }, { pspMode: mode }] } });
    let lines = await this.prisma.pspSettlementLine.findMany({ where: { date: d } });
    if (!lines.some((l) => l.kind === 'CAPTURE') && cfg().pspMode === 'sandbox-fake') {
      // sandbox: the fake PSP's settlement report mirrors its own captures
      await this.importSettlementLines(captured.map((p) => ({ psp: p.psp, pspRef: p.pspRef ?? p.id, kind: 'CAPTURE' as const, amountMinor: p.amountMinor, feeMinor: p.feeMinor, date: d.toISOString() })));
      lines = await this.prisma.pspSettlementLine.findMany({ where: { date: d } });
    }
    const capLines = lines.filter((l) => l.kind === 'CAPTURE');
    const byRef = new Map(capLines.map((l) => [`${l.psp}|${baseRef(l.pspRef)}`, l]));
    const matched = new Set<string>();
    for (const p of captured) {
      const l = byRef.get(`${p.psp}|${p.pspRef ?? p.id}`);
      if (!l) { disc.push({ type: 'MISSING_AT_PSP', ref: p.id, psp: p.psp }); continue; }
      matched.add(l.id);
      if (l.amountMinor !== p.amountMinor) disc.push({ type: 'AMOUNT_MISMATCH', ref: p.id, psp: p.psp, detail: { ours: p.amountMinor, psp: l.amountMinor } });
      if (l.feeMinor > 0 && l.feeMinor !== p.feeMinor) disc.push({ type: 'FEE_MISMATCH', ref: p.id, psp: p.psp, detail: { ours: p.feeMinor, psp: l.feeMinor } });
      await this.prisma.pspSettlementLine.update({ where: { id: l.id }, data: { matched: true } });
    }
    for (const l of capLines) if (!matched.has(l.id)) disc.push({ type: 'UNKNOWN_AT_PSP', ref: baseRef(l.pspRef), psp: l.psp, detail: { amountMinor: l.amountMinor } });

    // refunds settled that day vs REFUND lines
    const refunds = await this.prisma.refund.findMany({ where: { status: 'SETTLED', settledAt: { gte: d, lt: next }, reason: { not: { startsWith: 'CHARGEBACK' } } }, include: { payment: { select: { psp: true, pspRef: true, id: true } } } });
    const refLines = lines.filter((l) => l.kind === 'REFUND'); const usedRef = new Set<string>();
    if (refLines.length || refunds.some((r) => r.payment.psp)) for (const r of refunds) {
      if (cfg().pspMode === 'sandbox-fake') break; // the fake PSP has no refund report
      const l = refLines.find((x) => !usedRef.has(x.id) && x.psp === r.payment.psp && baseRef(x.pspRef) === (r.payment.pspRef ?? r.payment.id) && x.amountMinor === r.amountMinor);
      if (!l) { disc.push({ type: 'REFUND_MISSING_AT_PSP', ref: r.id, psp: r.payment.psp, detail: { amountMinor: r.amountMinor } }); continue; }
      usedRef.add(l.id); await this.prisma.pspSettlementLine.update({ where: { id: l.id }, data: { matched: true } });
    }
    for (const l of refLines) if (!usedRef.has(l.id) && cfg().pspMode !== 'sandbox-fake') disc.push({ type: 'UNKNOWN_REFUND_AT_PSP', ref: baseRef(l.pspRef), psp: l.psp, detail: { amountMinor: l.amountMinor } });

    // chargebacks reported by the PSP must be tracked as disputes
    for (const l of lines.filter((x) => x.kind === 'CHARGEBACK')) {
      const pay = await this.prisma.paymentIntent.findFirst({ where: { psp: l.psp, pspRef: baseRef(l.pspRef) }, select: { id: true } });
      const tracked = pay ? await this.prisma.paymentDispute.findFirst({ where: { paymentId: pay.id }, select: { id: true } }) : null;
      if (!tracked) disc.push({ type: 'CHARGEBACK_NOT_RECORDED', ref: baseRef(l.pspRef), psp: l.psp, detail: { amountMinor: l.amountMinor } }); else await this.prisma.pspSettlementLine.update({ where: { id: l.id }, data: { matched: true } });
    }
    // payout batches: the bank transfer must equal captures - fees - refunds - chargebacks of its lines
    const batches = new Map<string, { psp: string; payout: number | null; items: SettlementLineIn[] }>();
    for (const l of lines) { if (!l.payoutRef) continue; const b = batches.get(`${l.psp}|${l.payoutRef}`) ?? { psp: l.psp, payout: null, items: [] }; if (l.kind === 'PAYOUT') b.payout = l.amountMinor; else b.items.push({ pspRef: l.pspRef, kind: l.kind as SettlementKind, amountMinor: l.amountMinor, feeMinor: l.feeMinor, date: '', currency: l.currency }); batches.set(`${l.psp}|${l.payoutRef}`, b); }
    for (const [k, b] of batches) if (b.payout !== null && b.items.length && b.payout !== expectedNet(b.items)) disc.push({ type: 'PAYOUT_MISMATCH', ref: k.split('|')[1], psp: b.psp, detail: { payoutMinor: b.payout, expectedMinor: expectedNet(b.items) } });

    await this.invariantChecks(disc);
    const run = await this.prisma.reconciliationRun.create({ data: { kind: 'PSP_DAILY', status: disc.length ? 'DISCREPANCIES' : 'OK', discrepancies: disc as never, stats: { captured: captured.length, lines: lines.length, refunds: refunds.length, date: d.toISOString().slice(0, 10), mode } } });
    return run;
  }

  private async invariantChecks(disc: Discrepancy[]) {
    const unbalanced = await this.prisma.$queryRaw<{ txId: string }[]>`SELECT "txId" FROM "LedgerEntry" GROUP BY "txId" HAVING SUM("debitMinor") <> SUM("creditMinor")`;
    for (const u of unbalanced) disc.push({ type: 'LEDGER_UNBALANCED', ref: u.txId });
    const stale = await this.prisma.refund.findMany({ where: { status: 'REQUESTED', createdAt: { lt: new Date(Date.now() - DAY) } } });
    for (const r of stale) disc.push({ type: 'REFUND_NOT_SETTLED', ref: r.id });
    for (const r of await this.prisma.refund.findMany({ where: { status: 'FAILED' }, take: 200 })) disc.push({ type: 'REFUND_FAILED', ref: r.id, detail: { code: r.failureCode } });
    const noLedger = await this.prisma.$queryRaw<{ id: string }[]>`SELECT p.id FROM "PaymentIntent" p WHERE p.status IN ('CAPTURED','PARTIALLY_REFUNDED','REFUNDED') AND NOT EXISTS (SELECT 1 FROM "LedgerTx" t WHERE t."idempotencyKey" = 'capture:' || p.id)`;
    for (const n of noLedger) disc.push({ type: 'CAPTURE_WITHOUT_LEDGER', ref: n.id });
    const heldNoLedger = await this.prisma.$queryRaw<{ id: string }[]>`SELECT p.id FROM "PaymentIntent" p WHERE p."reviewState" = 'HELD_FOR_REVIEW' AND NOT EXISTS (SELECT 1 FROM "LedgerTx" t WHERE t."idempotencyKey" = 'hold-review:' || p.id)`;
    for (const n of heldNoLedger) disc.push({ type: 'REVIEW_HOLD_WITHOUT_LEDGER', ref: n.id });
    // GRW-P2-S RC-S4 (Pay side): the SPONSOR_FUNDED account moved for a payment equals what the intent says is still posted
    const sponsorDrift = await this.prisma.$queryRaw<{ id: string }[]>`SELECT p.id FROM "PaymentIntent" p WHERE p."sponsoredMinor" > 0 AND (SELECT COALESCE(SUM(e."debitMinor" - e."creditMinor"), 0) FROM "LedgerEntry" e JOIN "LedgerTx" t ON t.id = e."txId" WHERE t."paymentId" = p.id AND e.account = ${A.sponsorFunded}) <> p."sponsoredPostedMinor"`;
    for (const n of sponsorDrift) disc.push({ type: 'SPONSORED_LEDGER_MISMATCH', ref: n.id });
    // PAY-READY: the same for the corporate share (CORPORATE_FUNDED moved for a payment == what the intent says is still posted)
    const corpDrift = await this.prisma.$queryRaw<{ id: string }[]>`SELECT p.id FROM "PaymentIntent" p WHERE p."corporateMinor" > 0 AND (SELECT COALESCE(SUM(e."debitMinor" - e."creditMinor"), 0) FROM "LedgerEntry" e JOIN "LedgerTx" t ON t.id = e."txId" WHERE t."paymentId" = p.id AND e.account = ${A.corporateFunded}) <> p."corporatePostedMinor"`;
    for (const n of corpDrift) disc.push({ type: 'CORPORATE_POSTED_MISMATCH', ref: n.id });
    // vertical orders: once released nothing may stay HELD for that payment
    const heldAfterRelease = await this.prisma.$queryRaw<{ id: string }[]>`SELECT p.id FROM "PaymentIntent" p WHERE p.purpose <> 'DEPOSIT' AND p."releasedAt" IS NOT NULL AND (SELECT COALESCE(SUM(e."creditMinor" - e."debitMinor"), 0) FROM "LedgerEntry" e JOIN "LedgerTx" t ON t.id = e."txId" WHERE t."paymentId" = p.id AND e.account LIKE 'HELD:%') <> 0`;
    for (const n of heldAfterRelease) disc.push({ type: 'ORDER_HELD_AFTER_RELEASE', ref: n.id });
    // PAY-READY corporate: the corporate ledger of every captured booking nets to what the intent says (corporateMinor - corporateVoidedMinor); allow the outbox an hour to catch up
    if (this.corporate) {
      const rows = await this.prisma.paymentIntent.findMany({ where: { corporateMinor: { gt: 0 }, status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED'] }, capturedAt: { lt: new Date(Date.now() - 3600_000) }, bookingId: { not: null } }, select: { id: true, bookingId: true, corporateMinor: true, corporateVoidedMinor: true }, take: 500 });
      for (const p of rows) { const u = await this.corporate.bookingUse(p.bookingId!); const want = p.corporateMinor - p.corporateVoidedMinor; if (u.net !== want || u.held !== 0) disc.push({ type: 'CORPORATE_LEDGER_MISMATCH', ref: p.id, detail: { expectedNet: want, ledgerNet: u.net, stillHeld: u.held } }); }
    }
    // PAY-READY: 3DS tripwire (the vendor integration enforces it; this proves it), authorisations about to lapse, disputes with evidence due
    const noThreeDs = await this.prisma.paymentIntent.findMany({ where: { status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED'] }, cardBrand: { not: null }, threeDsStatus: { notIn: ['PASSED'] }, capturedAt: { gt: new Date(Date.now() - 7 * DAY) } }, select: { id: true, psp: true, threeDsStatus: true }, take: 200 });
    for (const p of noThreeDs) { const s = await this.config.settingsFor(p.psp as never); if (s.threeDsMode === 'REQUIRED') disc.push({ type: 'THREE_DS_NOT_ENFORCED', ref: p.id, psp: p.psp, detail: { threeDs: p.threeDsStatus } }); }
    for (const p of await this.prisma.paymentIntent.findMany({ where: { status: 'AUTHORIZED', authorizedAt: { lt: new Date(Date.now() - AUTH_EXPIRY_WARN_DAYS * DAY) } }, select: { id: true, psp: true }, take: 200 })) disc.push({ type: 'AUTHORIZATION_EXPIRING', ref: p.id, psp: p.psp });
    for (const x of await this.prisma.paymentDispute.findMany({ where: { state: 'OPEN', evidenceDueAt: { lt: new Date(Date.now() + 3 * DAY) } }, take: 200 })) disc.push({ type: 'DISPUTE_EVIDENCE_DUE', ref: x.paymentId, psp: x.psp, detail: { dueAt: x.evidenceDueAt?.toISOString(), disputeRef: x.pspDisputeRef } });
  }

  async runs(take = 50) { return this.prisma.reconciliationRun.findMany({ orderBy: { createdAt: 'desc' }, take }); }
  async files(take = 50) { return this.prisma.pspSettlementFile.findMany({ orderBy: { importedAt: 'desc' }, take }); }

  /** The mismatch report of one run as CSV (type, psp, reference, detail): what finance takes to the PSP. Detail never contains personal data. */
  async mismatchCsv(runId: string): Promise<string> {
    const run = await this.prisma.reconciliationRun.findUnique({ where: { id: runId } });
    if (!run) throw badRequest('RUN_NOT_FOUND', 'Reconciliation run not found');
    const esc = (v: unknown) => { const s = v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v); const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; }; // spreadsheet formula injection guard
    const rows = (run.discrepancies as unknown as Discrepancy[]) ?? [];
    return ['type,psp,reference,detail', ...rows.map((r) => [r.type, r.psp ?? '', r.ref, r.detail ?? ''].map(esc).join(','))].join('\n') + '\n';
  }
}
type SettlementParseRejected = { row: number; reason: string };
const sum = (lines: SettlementLineIn[], k: SettlementKind) => lines.filter((l) => l.kind === k).reduce((t, l) => t + l.amountMinor, 0);
void Prisma;
