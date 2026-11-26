import { Injectable } from '@nestjs/common';
import { badRequest, notFound } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { reconcileClaimRates } from './commission-rate';
import { agingBucketList, type Finding, agingBucket, major, reconcilePayout, reconcileRun, toCsv } from './commission-collect';
import { CommissionConfigService } from './commission-config.service';
import { buildBilingualPdf, type PdfRow } from './bilingual-pdf';

export interface Page { page?: number; pageSize?: number }
const pg = (p: Page) => { const pageSize = Math.min(Math.max(Math.floor(p.pageSize ?? 50), 1), 200); const page = Math.max(Math.floor(p.page ?? 1), 1); return { skip: (page - 1) * pageSize, take: pageSize, page, pageSize }; };
const RE_ORG = /^[A-Za-z0-9_-]{3,64}$/;
const RE_DAY = /^\d{4}-\d{2}-\d{2}$/;
export const EXPORT_VIEWS = ['claims', 'runs', 'deductions', 'aging', 'disputes', 'reconciliation', 'timeline'] as const;
export type ExportView = (typeof EXPORT_VIEWS)[number];

export interface Filter { orgRef?: string; market?: string; status?: string; collectionStatus?: string; periodKey?: string; from?: string; to?: string }

/**
 * COM-1 read side shared by the platform finance console (all organisations) and the provider-side statement (ONE organisation, the `orgRef` forced by the caller, never taken from the request).
 * Every figure is a sum of rows that the drill-down lists: claims -> run -> attempts -> payout / invoice -> timeline.
 */
@Injectable()
export class CommissionQueryService {
  constructor(private readonly prisma: PrismaService, private readonly config: CommissionConfigService) {}

  private claimWhere(f: Filter) {
    if (f.orgRef && !RE_ORG.test(f.orgRef)) throw badRequest('INVALID_ORG', 'Invalid organisation reference');
    return {
      ...(f.orgRef ? { orgRef: f.orgRef } : {}), ...(f.market ? { market: f.market.toUpperCase() } : {}),
      ...(f.status ? { chargeStatus: f.status } : {}), ...(f.collectionStatus ? { collectionStatus: f.collectionStatus } : {}),
      ...(f.from || f.to ? { createdAt: { ...(f.from && RE_DAY.test(f.from) ? { gte: new Date(`${f.from}T00:00:00Z`) } : {}), ...(f.to && RE_DAY.test(f.to) ? { lt: new Date(new Date(`${f.to}T00:00:00Z`).getTime() + 86_400_000) } : {}) } } : {}),
    };
  }
  private runWhere(f: Filter) { return { ...(f.orgRef ? { orgRef: f.orgRef } : {}), ...(f.market ? { market: f.market.toUpperCase() } : {}), ...(f.status ? { status: f.status } : {}), ...(f.periodKey ? { periodKey: f.periodKey } : {}) }; }

  async summary(f: Filter, now = new Date()) {
    const claimWhere = this.claimWhere(f);
    const LIVE_CHARGE = ['CONFIRMED', 'BILLED', 'PENDING', 'DISPUTED'];
    const [byCharge, byColl, runs, disputed, reversed, unknownTender, cashTransfer] = await Promise.all([
      this.prisma.commissionClaim.groupBy({ by: ['chargeStatus', 'currency'], where: claimWhere, _sum: { amountMinor: true }, _count: true }),
      this.prisma.commissionClaim.groupBy({ by: ['collectionStatus', 'currency'], where: { ...claimWhere, chargeStatus: { notIn: ['REVERSED', 'WAIVED'] } }, _sum: { amountMinor: true, collectedMinor: true }, _count: true }),
      this.prisma.commissionRun.findMany({ where: this.runWhere(f), select: { currency: true, claimsMinor: true, collectedMinor: true, deductedMinor: true, invoicedMinor: true, paidMinor: true, status: true, invoiceDueAt: true } }),
      this.prisma.commissionClaim.aggregate({ where: { ...claimWhere, disputeStatus: 'OPEN' }, _sum: { amountMinor: true }, _count: true }),
      this.prisma.commissionClaim.aggregate({ where: { ...claimWhere, reversedAfterCollection: true }, _sum: { collectedMinor: true }, _count: true }),
      // LG-COM-20: live claims whose tender was not reported (an exception for Ops, never guessed) and cash transfers (cash-type, their own kind)
      this.prisma.commissionClaim.aggregate({ where: { ...claimWhere, tender: null, chargeStatus: { in: LIVE_CHARGE } }, _sum: { amountMinor: true }, _count: true }),
      this.prisma.commissionClaim.aggregate({ where: { ...claimWhere, tender: 'CASH', tenderMethod: 'CASH_TRANSFER', chargeStatus: { in: LIVE_CHARGE } }, _sum: { amountMinor: true }, _count: true }),
    ]);
    const sum = (k: 'collectedMinor' | 'deductedMinor' | 'invoicedMinor' | 'paidMinor' | 'claimsMinor') => runs.reduce((s, r) => s + r[k], 0);
    const overdue = runs.filter((r) => r.status === 'INVOICE_OPEN' && r.invoiceDueAt && r.invoiceDueAt < now).reduce((s, r) => s + (r.invoicedMinor - r.paidMinor), 0);
    return {
      figures: { claimsInRunsMinor: sum('claimsMinor'), collectedMinor: sum('collectedMinor'), deductedMinor: sum('deductedMinor'), invoicedMinor: sum('invoicedMinor'), invoicePaidMinor: sum('paidMinor'), invoiceOpenMinor: sum('invoicedMinor') - sum('paidMinor'), overdueMinor: overdue, disputedOpenMinor: disputed._sum.amountMinor ?? 0, creditDueMinor: reversed._sum.collectedMinor ?? 0 },
      counts: { disputedOpen: disputed._count, creditDue: reversed._count, runs: runs.length, unknownTender: unknownTender._count, cashTransfer: cashTransfer._count },
      tender: { unknownCommissionMinor: unknownTender._sum.amountMinor ?? 0, cashTransferCommissionMinor: cashTransfer._sum.amountMinor ?? 0 },
      byChargeStatus: byCharge.map((r) => ({ status: r.chargeStatus, currency: r.currency, count: r._count, amountMinor: r._sum.amountMinor ?? 0 })),
      byCollectionStatus: byColl.map((r) => ({ status: r.collectionStatus, currency: r.currency, count: r._count, amountMinor: r._sum.amountMinor ?? 0, collectedMinor: r._sum.collectedMinor ?? 0 })),
    };
  }

  async claims(f: Filter, p: Page = {}) {
    const where = this.claimWhere(f); const { skip, take, page, pageSize } = pg(p);
    const [total, items] = await Promise.all([this.prisma.commissionClaim.count({ where }), this.prisma.commissionClaim.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take })]);
    return { total, page, pageSize, items };
  }

  async claim(id: string, orgRef?: string) {
    const c = await this.prisma.commissionClaim.findUnique({ where: { id } });
    if (!c || (orgRef && c.orgRef !== orgRef)) throw notFound('CLAIM_NOT_FOUND', 'No such commission claim');
    const [run, timeline, attempts] = await Promise.all([
      c.runId ? this.prisma.commissionRun.findUnique({ where: { id: c.runId } }) : null,
      this.prisma.commissionTimeline.findMany({ where: { subjectType: 'CLAIM', subjectId: id }, orderBy: { at: 'asc' } }),
      c.runId ? this.prisma.commissionAttempt.findMany({ where: { runId: c.runId }, orderBy: { attemptNo: 'asc' } }) : [],
    ]);
    return { claim: c, run, attempts, timeline };
  }

  async runs(f: Filter, p: Page = {}) {
    const where = this.runWhere(f); const { skip, take, page, pageSize } = pg(p);
    const [total, items] = await Promise.all([this.prisma.commissionRun.count({ where }), this.prisma.commissionRun.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take })]);
    return { total, page, pageSize, items };
  }

  async run(id: string, orgRef?: string) {
    const run = await this.prisma.commissionRun.findUnique({ where: { id } });
    if (!run || (orgRef && run.orgRef !== orgRef)) throw notFound('RUN_NOT_FOUND', 'No such collection run');
    const [claims, attempts, timeline] = await Promise.all([
      this.prisma.commissionClaim.findMany({ where: { runId: id }, orderBy: { confirmedAt: 'asc' } }),
      this.prisma.commissionAttempt.findMany({ where: { runId: id }, orderBy: { attemptNo: 'asc' } }),
      this.prisma.commissionTimeline.findMany({ where: { subjectType: 'RUN', subjectId: id }, orderBy: { at: 'asc' } }),
    ]);
    const findings = [...reconcileRun(run, claims, attempts), ...reconcileClaimRates(claims)];
    return { run, claims, attempts, timeline, findings };
  }

  /** Payouts that carry a commission deduction (cash + deduction = gross released deposits), with the attempts that name them. */
  async deductions(f: Filter, p: Page = {}) {
    const { skip, take, page, pageSize } = pg(p);
    const orgClinics = f.orgRef ? (await this.prisma.commissionClaim.findMany({ where: { orgRef: f.orgRef, clinicId: { not: null } }, distinct: ['clinicId'], select: { clinicId: true } })).map((c) => c.clinicId!) : null;
    const where = { commissionDeductedMinor: { gt: 0 }, ...(orgClinics ? { clinicId: { in: orgClinics } } : {}) };
    const [total, items] = await Promise.all([this.prisma.payout.count({ where }), this.prisma.payout.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take })]);
    const attempts = items.length ? await this.prisma.commissionAttempt.findMany({ where: { kind: 'DEDUCT', payoutRef: { in: items.map((i) => i.payoutRef) } } }) : [];
    return { total, page, pageSize, items: items.map((i) => ({ ...i, grossMinor: i.amountMinor + i.commissionDeductedMinor, attempts: attempts.filter((a) => a.payoutRef === i.payoutRef) })) };
  }

  /** Open commission by age: uncollected confirmed claims by their confirmation, invoices by days past due. */
  async aging(f: Filter, now = new Date()) {
    const runs = await this.prisma.commissionRun.findMany({ where: { ...this.runWhere(f), status: { in: ['INVOICE_OPEN', 'RETRYING', 'COLLECTING'] } }, orderBy: { createdAt: 'asc' } });
    const rows = runs.map((r) => {
      const open = r.status === 'INVOICE_OPEN' ? r.invoicedMinor - r.paidMinor : Math.max(0, r.claimsMinor - r.collectedMinor - r.deductedMinor);
      return { runId: r.id, orgRef: r.orgRef, periodKey: r.periodKey, status: r.status, mode: r.mode, currency: r.currency, openMinor: open, dueAt: r.invoiceDueAt ?? r.collectAt, bucket: agingBucket(r.invoiceDueAt ?? r.collectAt, now), invoiceNo: r.invoiceNo };
    }).filter((r) => r.openMinor > 0);
    const buckets = Object.fromEntries(agingBucketList().map((b) => [b, rows.filter((r) => r.bucket === b).reduce((s, r) => s + r.openMinor, 0)]));
    return { buckets, rows };
  }

  async disputes(f: Filter, p: Page = {}) {
    const where = { ...this.claimWhere({ ...f, status: undefined }), disputeStatus: { not: null } as { not: null } };
    const { skip, take, page, pageSize } = pg(p);
    const [total, items] = await Promise.all([this.prisma.commissionClaim.count({ where }), this.prisma.commissionClaim.findMany({ where, orderBy: { updatedAt: 'desc' }, skip, take })]);
    return { total, page, pageSize, items };
  }

  async orgs(f: Filter) {
    const g = await this.prisma.commissionClaim.groupBy({ by: ['orgRef', 'market', 'currency'], where: this.claimWhere(f), _sum: { amountMinor: true, collectedMinor: true }, _count: true });
    const providers = await this.prisma.commissionOrgProvider.findMany({ where: { orgRef: { in: g.map((x) => x.orgRef) } } });
    const open = await this.prisma.commissionRun.groupBy({ by: ['orgRef'], where: { status: { in: ['INVOICE_OPEN', 'RETRYING', 'COLLECTING'] } }, _count: true });
    return g.map((x) => ({ orgRef: x.orgRef, market: x.market, currency: x.currency, claims: x._count, claimsMinor: x._sum.amountMinor ?? 0, collectedMinor: x._sum.collectedMinor ?? 0, provider: providers.find((p) => p.orgRef === x.orgRef)?.provider ?? null, openRuns: open.find((o) => o.orgRef === x.orgRef)?._count ?? 0 }));
  }

  async org(orgRef: string) {
    if (!RE_ORG.test(orgRef)) throw badRequest('INVALID_ORG', 'Invalid organisation reference');
    const sample = await this.prisma.commissionClaim.findFirst({ where: { orgRef }, select: { market: true } });
    if (!sample) throw notFound('ORG_NOT_FOUND', 'No commission data for this organisation');
    const [eff, provider, methods, summary, runs, providers] = await Promise.all([
      this.config.effective(orgRef, sample.market), this.config.providerOf(orgRef),
      this.prisma.commissionSavedMethod.findMany({ where: { orgRef }, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, provider: true, brand: true, last4: true, status: true, createdAt: true } }),
      this.summary({ orgRef }), this.prisma.commissionRun.findMany({ where: { orgRef }, orderBy: { createdAt: 'desc' }, take: 24 }), this.config.providersFor(sample.market),
    ]);
    return { orgRef, market: sample.market, config: eff, provider: provider?.provider ?? null, providersAvailable: providers, savedMethods: methods, summary, runs };
  }

  /** Reconciliation per organisation and period: charged = decisions, and run totals = their claims and attempts; plus payout deductions. */
  async reconciliation(f: Filter): Promise<{ findings: Finding[]; checkedRuns: number; checkedClaims: number }> {
    const runs = await this.prisma.commissionRun.findMany({ where: this.runWhere(f), orderBy: { createdAt: 'desc' }, take: 500 });
    const ids = runs.map((r) => r.id);
    const [claims, attempts] = await Promise.all([
      this.prisma.commissionClaim.findMany({ where: { OR: [{ runId: { in: ids } }, ...(Object.keys(this.claimWhere(f)).length ? [this.claimWhere(f)] : [{}])] }, take: 5000 }),
      this.prisma.commissionAttempt.findMany({ where: { runId: { in: ids } } }),
    ]);
    const findings: Finding[] = [];
    for (const r of runs) findings.push(...reconcileRun(r, claims, attempts));
    findings.push(...reconcileClaimRates(claims)); // claim vs the resolved rate policy it was reported under (CLAIM_NE_RATE)
    const loose = claims.filter((c) => !c.runId && c.chargeStatus !== 'REVERSED' && c.chargeStatus !== 'WAIVED' && c.decisionAmountMinor !== null && c.decisionAmountMinor !== c.amountMinor);
    for (const c of loose) findings.push({ orgRef: c.orgRef, code: 'CHARGE_NE_DECISION', ref: c.id, expectedMinor: c.decisionAmountMinor!, actualMinor: c.amountMinor, message: 'charged amount differs from the decision amount' });
    for (const c of claims.filter((x) => x.reversedAfterCollection)) findings.push({ orgRef: c.orgRef, code: 'CREDIT_DUE', ref: c.id, expectedMinor: 0, actualMinor: c.collectedMinor, message: 'charge reversed after commission was collected: a credit is due to the provider' });
    const payouts = await this.prisma.payout.findMany({ where: { commissionDeductedMinor: { gt: 0 } }, orderBy: { createdAt: 'desc' }, take: 200 });
    for (const po of payouts) {
      const ids2 = Array.isArray(po.paymentRefs) ? (po.paymentRefs as string[]) : [];
      const pays = ids2.length ? await this.prisma.paymentIntent.findMany({ where: { id: { in: ids2 } } }) : [];
      const gross = pays.reduce((s, p) => s + p.amountMinor - p.refundedMinor + (p.rewardPostedMinor ?? 0) + (p.sponsoredPostedMinor ?? 0) + (p.corporatePostedMinor ?? 0), 0);
      const ded = await this.prisma.commissionAttempt.findMany({ where: { kind: 'DEDUCT', payoutRef: po.payoutRef, status: 'SUCCEEDED' } });
      findings.push(...reconcilePayout(po, gross, ded.map((d) => d.amountMinor)));
    }
    return { findings, checkedRuns: runs.length, checkedClaims: claims.length };
  }

  async timeline(orgRef: string | undefined, limit = 100) {
    return this.prisma.commissionTimeline.findMany({ where: orgRef ? { orgRef } : {}, orderBy: { at: 'desc' }, take: Math.min(limit, 500) });
  }

  // ───────────────────────── exports (audited) ─────────────────────────
  async exportCsv(view: ExportView, f: Filter, actor: string): Promise<{ filename: string; csv: string; rows: number }> {
    if (!EXPORT_VIEWS.includes(view)) throw badRequest('UNKNOWN_VIEW', 'Unknown export view');
    let header: string[]; let rows: unknown[][];
    const m = major;
    if (view === 'claims') { const r = (await this.claims(f, { pageSize: 200, page: 1 })).items; const all = await this.prisma.commissionClaim.findMany({ where: this.claimWhere(f), orderBy: { createdAt: 'desc' }, take: 20_000 }); void r; header = ['org', 'market', 'chargeId', 'appointmentId', 'decisionRef', 'policyVersion', 'origin', 'amount', 'decisionAmount', 'feeBasis', 'sponsoredDiscount', 'basisPolicyVersion', 'currency', 'chargeStatus', 'disputeStatus', 'tender', 'tenderMethod', 'tenderDetail', 'collectionStatus', 'collected', 'creditDue', 'runId', 'confirmedAt']; rows = all.map((c) => [c.orgRef, c.market, c.chargeId, c.appointmentId, c.decisionRef, c.policyVersion, c.origin, m(c.amountMinor), c.decisionAmountMinor === null ? '' : m(c.decisionAmountMinor), c.feeBasisMinor === null ? '' : m(c.feeBasisMinor), c.sponsoredDiscountMinor === null ? '' : m(c.sponsoredDiscountMinor), c.basisPolicyVersion, c.currency, c.chargeStatus, c.disputeStatus, c.tender, c.tenderMethod, c.tenderDetail, c.collectionStatus, m(c.collectedMinor), c.reversedAfterCollection ? 'yes' : '', c.runId, c.confirmedAt]); }
    else if (view === 'runs') { const all = await this.prisma.commissionRun.findMany({ where: this.runWhere(f), orderBy: { createdAt: 'desc' }, take: 20_000 }); header = ['org', 'market', 'period', 'status', 'modeRequested', 'mode', 'fallbackReason', 'provider', 'currency', 'claims', 'claimsTotal', 'collected', 'deducted', 'invoiced', 'invoicePaid', 'invoiceNo', 'invoiceDueAt', 'runId']; rows = all.map((r) => [r.orgRef, r.market, r.periodKey, r.status, r.modeRequested, r.mode, r.fallbackReason, r.provider, r.currency, r.claimsCount, m(r.claimsMinor), m(r.collectedMinor), m(r.deductedMinor), m(r.invoicedMinor), m(r.paidMinor), r.invoiceNo, r.invoiceDueAt, r.id]); }
    else if (view === 'deductions') { const d = await this.deductions(f, { pageSize: 200 }); header = ['payoutRef', 'clinicId', 'gross', 'cashPaid', 'commissionDeducted', 'currency', 'periodKey', 'paidAt']; rows = d.items.map((p) => [p.payoutRef, p.clinicId, m(p.grossMinor), m(p.amountMinor), m(p.commissionDeductedMinor), p.currency, p.periodKey, p.paidAt]); }
    else if (view === 'aging') { const a = await this.aging(f); header = ['org', 'period', 'status', 'mode', 'bucket', 'open', 'currency', 'dueAt', 'invoiceNo', 'runId']; rows = a.rows.map((r) => [r.orgRef, r.periodKey, r.status, r.mode, r.bucket, m(r.openMinor), r.currency, r.dueAt, r.invoiceNo, r.runId]); }
    else if (view === 'disputes') { const d = await this.disputes(f, { pageSize: 200 }); header = ['org', 'chargeId', 'appointmentId', 'amount', 'currency', 'chargeStatus', 'disputeStatus', 'updatedAt']; rows = d.items.map((c) => [c.orgRef, c.chargeId, c.appointmentId, m(c.amountMinor), c.currency, c.chargeStatus, c.disputeStatus, c.updatedAt]); }
    else if (view === 'timeline') { const t = await this.timeline(f.orgRef, 500); header = ['at', 'org', 'subjectType', 'subjectId', 'event', 'actor', 'detail']; rows = t.map((e) => [e.at, e.orgRef, e.subjectType, e.subjectId, e.event, e.actor, JSON.stringify(e.detail ?? {})]); }
    else { const r = await this.reconciliation(f); header = ['code', 'org', 'period', 'ref', 'expected', 'actual', 'message']; rows = r.findings.map((x) => [x.code, x.orgRef, x.periodKey, x.ref, m(x.expectedMinor), m(x.actualMinor), x.message]); }
    await this.auditExport(actor, view, 'CSV', f, rows.length);
    return { filename: `commission-${view}-${new Date().toISOString().slice(0, 10)}.csv`, csv: toCsv(header, rows), rows: rows.length };
  }

  /** Bilingual (EN, then AR right-to-left) finance statement: totals, runs and payout deductions of one organisation or of all (platform), with the reconciliation result. Audited like a CSV export. */
  async statementPdf(f: Filter, actor: string): Promise<{ filename: string; pdf: Buffer }> {
    const [sum, runs, ded, rec, aging] = await Promise.all([this.summary(f), this.runs(f, { pageSize: 200 }), this.deductions(f, { pageSize: 200 }), this.reconciliation(f), this.aging(f)]);
    const m = major;
    const T = {
      en: { title: 'Kiorex commissions statement', org: 'Organisation', all: 'All organisations', collected: 'Charged to saved method', deducted: 'Kept from payouts', invoiceOpen: 'Invoices open', overdue: 'Overdue', disputed: 'Under dispute', creditDue: 'Credit due to providers', runs: 'Collection runs', period: 'Period', status: 'Status', amount: 'Amount', payouts: 'Payout deductions', recon: 'Reconciliation', clean: 'No findings: charged equals decisions and every run equals its claims and attempts.', findings: 'findings', none: 'Nothing to show.', aging: 'Open by age' },
      ar: { title: 'كشف عمولات كيوركس', org: 'الجهة', all: 'كل الجهات', collected: 'محصّل من الوسيلة المحفوظة', deducted: 'مخصوم من التحويلات', invoiceOpen: 'فواتير مفتوحة', overdue: 'متأخر', disputed: 'قيد النزاع', creditDue: 'رصيد مستحق للجهات', runs: 'تشغيلات التحصيل', period: 'الفترة', status: 'الحالة', amount: 'المبلغ', payouts: 'الخصم من التحويلات', recon: 'المطابقة', clean: 'لا ملاحظات: المحصّل يساوي القرارات وكل تشغيل يساوي مطالباته ومحاولاته.', findings: 'ملاحظات', none: 'لا شيء للعرض.', aging: 'المفتوح حسب العمر' },
    } as const;
    const section = (lang: 'en' | 'ar') => {
      const L = T[lang]; const w = [3, 3, 3];
      const rows: PdfRow[] = [
        { kind: 'text', text: L.title, size: 16, bold: true }, { kind: 'pair', label: L.org, value: f.orgRef ?? L.all }, { kind: 'pair', label: 'Date', value: new Date().toISOString().slice(0, 10) }, { kind: 'rule' },
        { kind: 'pair', label: L.collected, value: m(sum.figures.collectedMinor!) }, { kind: 'pair', label: L.deducted, value: m(sum.figures.deductedMinor!) }, { kind: 'pair', label: L.invoiceOpen, value: m(sum.figures.invoiceOpenMinor!) },
        { kind: 'pair', label: L.overdue, value: m(sum.figures.overdueMinor!) }, { kind: 'pair', label: L.disputed, value: m(sum.figures.disputedOpenMinor!) }, { kind: 'pair', label: L.creditDue, value: m(sum.figures.creditDueMinor!) },
        { kind: 'gap' }, { kind: 'text', text: L.aging, size: 11, bold: true },
        ...Object.entries(aging.buckets).map(([k, v]) => ({ kind: 'pair', label: k, value: m(v as number), size: 9 }) as PdfRow),
        { kind: 'gap' }, { kind: 'text', text: L.runs, size: 11, bold: true },
      ];
      if (!runs.items.length) rows.push({ kind: 'text', text: L.none, size: 9 });
      else { rows.push({ kind: 'columns', cells: [L.period, L.status, L.amount], widths: w, size: 9, bold: true }); for (const r of runs.items.slice(0, 120)) rows.push({ kind: 'columns', cells: [`${f.orgRef ? '' : `${r.orgRef.slice(-6)} `}${r.periodKey}`, r.status, `${m(r.claimsMinor)} ${r.currency}`], widths: w, size: 9 }); }
      rows.push({ kind: 'gap' }, { kind: 'text', text: L.payouts, size: 11, bold: true });
      if (!ded.items.length) rows.push({ kind: 'text', text: L.none, size: 9 }); else for (const p of ded.items.slice(0, 60)) rows.push({ kind: 'pair', label: p.payoutRef, value: `-${m(p.commissionDeductedMinor)} ${p.currency}`, size: 9 });
      rows.push({ kind: 'gap' }, { kind: 'text', text: L.recon, size: 11, bold: true }, { kind: 'text', text: rec.findings.length ? `${rec.findings.length} ${L.findings}` : L.clean, size: 9 });
      return { direction: (lang === 'ar' ? 'rtl' : 'ltr') as 'rtl' | 'ltr', rows };
    };
    const pdf = buildBilingualPdf([section('en'), section('ar')]);
    await this.auditExport(actor, 'statement', 'PDF', f, runs.items.length);
    return { filename: `commission-statement-${f.orgRef ?? 'all'}-${new Date().toISOString().slice(0, 10)}.pdf`, pdf };
  }

  async auditExport(actor: string, view: string, format: 'CSV' | 'PDF', f: Filter, rowCount: number) {
    await this.prisma.commissionExportAudit.create({ data: { actor, view, format, scopeOrg: f.orgRef ?? null, filter: f as object, rowCount } });
    await this.prisma.auditLog.create({ data: { actor, action: 'commission.export', resource: 'CommissionExport', resourceId: view, metadata: { format, org: f.orgRef ?? 'ALL', rows: rowCount } } });
  }
  exportAudits(limit = 100) { return this.prisma.commissionExportAudit.findMany({ orderBy: { createdAt: 'desc' }, take: Math.min(limit, 500) }); }
}
