import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { cfg } from '../common/config';
import { badRequest, conflict, notFound } from '../common/errors';
import { newId } from '../common/ids';
import type { CommissionNettingPort } from '../common/commission-netting-port';
import { RealModeNotApprovedError } from '../common/providers/mode-guard';
import { KiorlyClient } from '../kiorly/kiorly-public';
import { OutboxService } from '../outbox/outbox-public';
import { postLedgerTx } from '../pay/pay-public';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { CommissionClaimsService } from './commission-claims.service';
import { COMMISSION_COLLECTOR, type CommissionCollectorPort } from './commission-collector';
import { type CollectionSettings, afterFailure, duePeriod, eligibleForRun, netSplit, parseSettings, startingMode, type FallbackReason } from './commission-collect';
import { CommissionConfigService } from './commission-config.service';
import { commissionJobIntervalMs } from './commission-bounds';
import { CommissionPolicyService } from './commission-policy.service';
import { commissionNet, commissionReceived } from './commission-ledger';

const OPEN_RUN = ['PLANNED', 'COLLECTING', 'RETRYING', 'INVOICE_OPEN'];
export type RunOutcome = { orgRef: string; status: string; runId?: string; periodKey?: string; missing?: string[]; claimsMinor?: number; detail?: string };

/**
 * COM-1 collection engine. Idempotent per (organisation, period); never blocks care (this class has no listing pause, no gate, no plan change: the worst outcome of a failed collection is an open
 * invoice that ages on the console). Money moves only on the rails of the provider the organisation chose: a payout deduction (Kiorex already owes the provider), a saved-method charge through the
 * provider, or an invoice the provider pays through that provider. Kiorly holds nothing.
 */
@Injectable()
export class CommissionCollectionService implements OnModuleInit, CommissionNettingPort {
  private readonly log = new Logger('commission-collection');
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: CommissionConfigService,
    private readonly claims: CommissionClaimsService,
    private readonly outbox: OutboxService,
    private readonly kiorly: KiorlyClient,
    @Inject(COMMISSION_COLLECTOR) private readonly collector: CommissionCollectorPort,
    @Optional() private readonly policy?: CommissionPolicyService,
  ) {}

  onModuleInit() {
    this.outbox.register('kiorly.commission_collection', (e) => this.pushToClinic(e.payload.runId));
    if (cfg().jobsEnabled) setInterval(() => { void this.runDue().catch((e) => this.log.warn(`runDue failed: ${(e as Error).message}`)); void this.processPending().catch((e) => this.log.warn(`processPending failed: ${(e as Error).message}`)); }, commissionJobIntervalMs()).unref();
  }

  // ───────────────────────── planning ─────────────────────────
  /** Runs every organisation whose period is due. Safe to call at any time and as often as wanted: a second call changes nothing. */
  async runDue(now = new Date(), actor = 'system'): Promise<{ outcomes: RunOutcome[] }> {
    const orgs = await this.prisma.commissionClaim.groupBy({ by: ['orgRef'], where: { collectionStatus: 'UNCOLLECTED', chargeStatus: 'CONFIRMED' } });
    const outcomes: RunOutcome[] = [];
    for (const o of orgs) outcomes.push(await this.runForOrg(o.orgRef, now, actor).catch((e) => ({ orgRef: o.orgRef, status: 'ERROR', detail: (e as Error).message })));
    return { outcomes };
  }

  async runForOrg(orgRef: string, now = new Date(), actor = 'system'): Promise<RunOutcome> {
    const sample = await this.prisma.commissionClaim.findFirst({ where: { orgRef }, select: { market: true, currency: true } });
    if (!sample) return { orgRef, status: 'NO_CLAIMS' };
    const eff = await this.config.effective(orgRef, sample.market);
    if (eff.missing.length) return { orgRef, status: 'NOT_CONFIGURED', missing: eff.missing };
    const settings = eff.settings;
    const due = duePeriod(now, settings);
    if (!due) return { orgRef, status: 'NOT_DUE' };
    const idempotencyKey = `com:${orgRef}:${due.periodKey}`;
    const existing = await this.prisma.commissionRun.findUnique({ where: { idempotencyKey } });
    if (existing) return { orgRef, status: 'EXISTS', runId: existing.id, periodKey: due.periodKey };

    const rows = await this.prisma.commissionClaim.findMany({ where: { orgRef, collectionStatus: 'UNCOLLECTED', chargeStatus: 'CONFIRMED' }, orderBy: { confirmedAt: 'asc' } });
    const currency = eff.rate?.currency ?? sample.currency; // COM-3: a currency configured on the rate decides which claims are collected together
    const eligible = rows.filter((c) => c.currency === currency && eligibleForRun(c, due.cutoff, eff.rate?.disputeWindowDays ?? null));
    const total = eligible.reduce((s, c) => s + c.amountMinor, 0);
    if (!eligible.length) return { orgRef, status: 'NOTHING_DUE', periodKey: due.periodKey };
    if (total < (settings.minCollectMinor ?? 0)) return { orgRef, status: 'BELOW_MINIMUM', periodKey: due.periodKey, claimsMinor: total, detail: 'rolls to the next period, nothing is lost' };

    const provider = (await this.config.providerOf(orgRef))?.provider ?? null;
    const saved = provider ? await this.prisma.commissionSavedMethod.findFirst({ where: { orgRef, provider, status: 'ACTIVE' } }) : null;
    const start = startingMode(settings, { provider, hasSavedMethod: !!saved, payableMinor: 0, savedMethodAllowed: eff.rate?.savedMethodChargeAllowed ?? null });
    // COM-3 counsel gate: in REAL mode the mode the run would start with must be approved by counsel for this market (mock always passes). Blocked = no run, claims stay uncollected, nothing is lost, care is never touched.
    if (this.policy) {
      const g = await this.policy.gate(sample.market, 'COLLECTION_MODE', start.mode);
      if (!g.allowed) { await this.noteBlocked(orgRef, due.periodKey, g.reason, start.mode); return { orgRef, status: 'COUNSEL_BLOCKED', periodKey: due.periodKey, claimsMinor: total, detail: `${g.reason}: ${start.mode} is not approved for real mode in ${sample.market}` }; }
    }
    let runId: string;
    try {
      runId = await this.prisma.$transaction(async (tx) => {
        const id = newId('crn');
        await tx.commissionRun.create({ data: { id, orgRef, market: sample.market, periodKey: due.periodKey, cutoffAt: due.cutoff, collectAt: due.collectAt, modeRequested: start.requested, mode: start.mode, fallbackReason: start.fallbackReason ?? null, provider, status: 'PLANNED', currency, claimsCount: eligible.length, claimsMinor: total, settingsJson: settings as object, idempotencyKey } });
        const claimed = await tx.commissionClaim.updateMany({ where: { id: { in: eligible.map((c) => c.id) }, collectionStatus: 'UNCOLLECTED' }, data: { collectionStatus: 'IN_RUN', runId: id } });
        if (claimed.count !== eligible.length) throw conflict('CLAIM_RACE', 'Claims were taken by another run');
        await this.claims.timeline(tx, orgRef, id, 'RUN_PLANNED', { periodKey: due.periodKey, claims: eligible.length, claimsMinor: total, mode: start.mode, requested: start.requested, fallbackReason: start.fallbackReason ?? null, provider, by: actor }, 'RUN', actor);
        for (const c of eligible) await this.claims.timeline(tx, orgRef, c.id, 'ASSIGNED_TO_RUN', { runId: id, periodKey: due.periodKey });
        return id;
      });
    } catch (e: any) {
      if (e?.code === 'P2002') { const r = await this.prisma.commissionRun.findUnique({ where: { idempotencyKey } }); return { orgRef, status: 'EXISTS', runId: r?.id, periodKey: due.periodKey }; }
      throw e;
    }
    await this.execute(runId, now);
    const run = await this.prisma.commissionRun.findUniqueOrThrow({ where: { id: runId } });
    return { orgRef, status: run.status, runId, periodKey: due.periodKey, claimsMinor: total };
  }

  /** One timeline row per (organisation, period, reason): the console shows why nothing ran; the 15-minute job does not repeat it. */
  private async noteBlocked(orgRef: string, periodKey: string, reason: string, mode: string) {
    const subjectId = `block:${orgRef}:${periodKey}:${reason}`;
    const have = await this.prisma.commissionTimeline.findFirst({ where: { orgRef, subjectId, event: 'COUNSEL_BLOCKED' }, select: { id: true } });
    if (!have) await this.prisma.commissionTimeline.create({ data: { orgRef, subjectType: 'RUN', subjectId, event: 'COUNSEL_BLOCKED', detail: { periodKey, reason, mode }, actor: 'system' } });
  }

  // ───────────────────────── execution ─────────────────────────
  private settingsOf(run: { settingsJson: unknown }): CollectionSettings { return parseSettings(run.settingsJson); }
  private async openMinor(runId: string): Promise<number> {
    const r = await this.prisma.commissionRun.findUniqueOrThrow({ where: { id: runId } });
    return Math.max(0, r.claimsMinor - r.collectedMinor - r.deductedMinor - r.invoicedMinor);
  }

  async execute(runId: string, now = new Date()): Promise<void> {
    const run = await this.prisma.commissionRun.findUniqueOrThrow({ where: { id: runId } });
    if (run.status !== 'PLANNED') return;
    if (run.mode === 'INVOICE_AND_COLLECT') { await this.issueInvoice(runId, now); return; }
    if (run.mode === 'NET_FROM_PAYOUT') {
      const s = this.settingsOf(run);
      const deadline = new Date(run.collectAt.getTime() + (s.retryDays?.at(-1) ?? 0) * 86_400_000);
      await this.prisma.$transaction(async (tx) => {
        await tx.commissionAttempt.create({ data: { id: newId('cat'), runId, orgRef: run.orgRef, attemptNo: 1, kind: 'DEDUCT', provider: run.provider, amountMinor: run.claimsMinor, status: 'PENDING', retryable: false, scheduledFor: deadline, idempotencyKey: `ded-window:${runId}` } });
        await tx.commissionRun.update({ where: { id: runId }, data: { status: 'COLLECTING' } });
        await this.claims.timeline(tx, run.orgRef, runId, 'AWAITING_PAYOUT', { deadline: deadline.toISOString(), amountMinor: run.claimsMinor }, 'RUN');
      });
      await this.push(runId);
      return;
    }
    await this.charge(runId, 1, now);
  }

  /** AUTO_CHARGE_SAVED_METHOD: one idempotent charge attempt through the organisation's provider; failure -> dunning (retries) -> invoice. */
  private async charge(runId: string, attemptNo: number, now: Date): Promise<void> {
    const run = await this.prisma.commissionRun.findUniqueOrThrow({ where: { id: runId } });
    const key = `chg:${runId}:${attemptNo}`;
    const amount = await this.openMinor(runId);
    if (amount <= 0) return;
    const prior = await this.prisma.commissionAttempt.findUnique({ where: { idempotencyKey: key } });
    if (prior?.status === 'SUCCEEDED') return;
    const saved = run.provider ? await this.prisma.commissionSavedMethod.findFirst({ where: { orgRef: run.orgRef, provider: run.provider, status: 'ACTIVE' } }) : null;
    if (!run.provider || !saved) { await this.fallBackToInvoice(runId, 'NO_SAVED_METHOD', now); return; }
    const attemptId = prior?.id ?? newId('cat');
    if (!prior) await this.prisma.commissionAttempt.create({ data: { id: attemptId, runId, orgRef: run.orgRef, attemptNo, kind: 'CHARGE', provider: run.provider, amountMinor: amount, status: 'PENDING', scheduledFor: now, idempotencyKey: key } });
    let result: Awaited<ReturnType<CommissionCollectorPort['chargeSaved']>>; let fallback: FallbackReason | null = null;
    try { result = await this.collector.chargeSaved({ orgRef: run.orgRef, provider: run.provider, tokenRef: saved.tokenRef, amountMinor: amount, currency: run.currency, idempotencyKey: key, attemptNo }); }
    catch (e) { fallback = e instanceof RealModeNotApprovedError ? 'RAIL_NOT_APPROVED' : 'RETRIES_EXHAUSTED'; result = { ok: false, code: e instanceof RealModeNotApprovedError ? 'REAL_MODE_NOT_APPROVED' : 'RAIL_ERROR', retryable: false }; }
    if (result.ok) {
      await this.prisma.$transaction(async (tx) => {
        await tx.commissionAttempt.update({ where: { id: attemptId }, data: { status: 'SUCCEEDED', providerRef: result.ok ? result.providerRef : undefined, executedAt: now } });
        await postLedgerTx(tx, { key: `commission-received:${key}`, kind: 'COMMISSION_CHARGED', postings: commissionReceived(amount), memo: `${run.orgRef} ${run.periodKey}` });
        await this.allocate(tx, runId, amount, 'COLLECTED');
        await tx.commissionRun.update({ where: { id: runId }, data: { collectedMinor: { increment: amount }, status: 'COLLECTED' } });
        await this.claims.timeline(tx, run.orgRef, runId, 'CHARGE_SUCCEEDED', { attemptNo, amountMinor: amount, provider: run.provider }, 'RUN');
      });
      await this.push(runId);
      return;
    }
    const first = await this.prisma.commissionAttempt.findFirst({ where: { runId, kind: 'CHARGE' }, orderBy: { attemptNo: 'asc' } });
    const next = afterFailure(attemptNo, first?.createdAt ?? now, now, this.settingsOf(run).retryDays, result.retryable);
    await this.prisma.$transaction(async (tx) => {
      await tx.commissionAttempt.update({ where: { id: attemptId }, data: { status: 'FAILED', failureCode: result.ok ? undefined : result.code, retryable: !result.ok && result.retryable, executedAt: now } });
      await this.claims.timeline(tx, run.orgRef, runId, 'CHARGE_FAILED', { attemptNo, code: result.ok ? null : result.code, retryable: !result.ok && result.retryable }, 'RUN');
      if (next.action === 'RETRY') {
        await tx.commissionAttempt.create({ data: { id: newId('cat'), runId, orgRef: run.orgRef, attemptNo: next.attemptNo, kind: 'CHARGE', provider: run.provider, amountMinor: amount, status: 'PENDING', scheduledFor: next.at, idempotencyKey: `chg:${runId}:${next.attemptNo}` } });
        await tx.commissionRun.update({ where: { id: runId }, data: { status: 'RETRYING' } });
        await this.claims.timeline(tx, run.orgRef, runId, 'RETRY_SCHEDULED', { attemptNo: next.attemptNo, at: next.at.toISOString() }, 'RUN');
      }
    });
    if (next.action === 'FALL_BACK_TO_INVOICE') await this.fallBackToInvoice(runId, fallback ?? 'RETRIES_EXHAUSTED', now); else await this.push(runId);
  }

  /** Safe fallback: whatever is still open becomes an invoice the provider pays through the chosen provider. Never a write-off, never a pause of care. */
  async fallBackToInvoice(runId: string, reason: FallbackReason, now = new Date()): Promise<void> {
    await this.prisma.commissionRun.update({ where: { id: runId }, data: { fallbackReason: reason } });
    await this.claims.timeline(this.prisma, (await this.prisma.commissionRun.findUniqueOrThrow({ where: { id: runId } })).orgRef, runId, 'FALLBACK_TO_INVOICE', { reason }, 'RUN');
    await this.issueInvoice(runId, now);
  }

  private async issueInvoice(runId: string, now: Date): Promise<void> {
    const run = await this.prisma.commissionRun.findUniqueOrThrow({ where: { id: runId } });
    const amount = await this.openMinor(runId);
    if (amount <= 0) { await this.finishIfSettled(runId); return; }
    const s = this.settingsOf(run);
    const dueAt = new Date(now.getTime() + (s.invoiceDueDays ?? 0) * 86_400_000); // invoiceDueDays null (not configured) = due on issue; the console still shows the placeholder warning
    const invoiceNo = run.invoiceNo ?? `KXC-${run.periodKey.replace(/-/g, '')}-${run.orgRef.slice(-6).toUpperCase()}`;
    await this.prisma.$transaction(async (tx) => {
      await tx.commissionAttempt.upsert({ where: { idempotencyKey: `inv:${runId}:${run.invoicedMinor + amount}` }, create: { id: newId('cat'), runId, orgRef: run.orgRef, attemptNo: 1 + (await tx.commissionAttempt.count({ where: { runId } })), kind: 'INVOICE', provider: run.provider, providerRef: invoiceNo, amountMinor: amount, status: 'SUCCEEDED', scheduledFor: now, executedAt: now, idempotencyKey: `inv:${runId}:${run.invoicedMinor + amount}` }, update: {} });
      await this.allocate(tx, runId, amount, 'INVOICED');
      await tx.commissionRun.update({ where: { id: runId }, data: { mode: 'INVOICE_AND_COLLECT', invoicedMinor: { increment: amount }, status: 'INVOICE_OPEN', invoiceNo, invoiceDueAt: dueAt } });
      await this.claims.timeline(tx, run.orgRef, runId, 'INVOICE_ISSUED', { invoiceNo, amountMinor: amount, dueAt: dueAt.toISOString(), provider: run.provider }, 'RUN');
    });
    await this.push(runId);
  }

  /** Walks IN_RUN claims oldest first and marks `amount` of them settled (collectedMinor is money received on the claim, from whichever path). */
  private async allocate(tx: Tx, runId: string, amount: number, to: 'COLLECTED' | 'INVOICED' | 'PAID', from: ('IN_RUN' | 'INVOICED')[] = ['IN_RUN']): Promise<void> {
    const rows = await tx.commissionClaim.findMany({ where: { runId, collectionStatus: { in: from } }, orderBy: [{ confirmedAt: 'asc' }, { id: 'asc' }] });
    let left = amount;
    for (const c of rows) {
      if (left <= 0) break;
      if (to === 'INVOICED') { await tx.commissionClaim.update({ where: { id: c.id }, data: { collectionStatus: 'INVOICED' } }); left -= c.amountMinor - c.collectedMinor; continue; }
      const need = c.amountMinor - c.collectedMinor; const take = Math.min(need, left); left -= take;
      const collected = c.collectedMinor + take;
      await tx.commissionClaim.update({ where: { id: c.id }, data: { collectedMinor: collected, ...(collected === c.amountMinor ? { collectionStatus: to } : {}) } });
      if (collected === c.amountMinor) await this.claims.timeline(tx, c.orgRef, c.id, to === 'PAID' ? 'INVOICE_PAID' : 'COLLECTED', { runId, amountMinor: c.amountMinor });
    }
  }

  // ───────────────────────── net-from-payout (port used by Pay's payout run) ─────────────────────────
  async reserveForPayout(txArg: unknown, i: { clinicId: string; payoutId: string; payoutRef: string; grossMinor: number; currency: string }): Promise<number> {
    const tx = txArg as Tx;
    const c = await tx.commissionClaim.findFirst({ where: { clinicId: i.clinicId }, select: { orgRef: true } });
    if (!c || i.grossMinor <= 0) return 0;
    const runs = await tx.commissionRun.findMany({ where: { orgRef: c.orgRef, mode: 'NET_FROM_PAYOUT', status: 'COLLECTING', currency: i.currency }, orderBy: { createdAt: 'asc' } });
    let left = i.grossMinor; let total = 0;
    for (const run of runs) {
      const open = Math.max(0, run.claimsMinor - run.collectedMinor - run.deductedMinor - run.invoicedMinor);
      const take = netSplit(open, left).netMinor;
      if (take <= 0) continue;
      const key = `ded:${i.payoutId}:${run.id}`;
      if (await tx.commissionAttempt.findUnique({ where: { idempotencyKey: key } })) continue;
      await tx.commissionAttempt.create({ data: { id: newId('cat'), runId: run.id, orgRef: run.orgRef, attemptNo: 1 + (await tx.commissionAttempt.count({ where: { runId: run.id } })), kind: 'DEDUCT', provider: run.provider, payoutRef: i.payoutRef, amountMinor: take, status: 'SUCCEEDED', scheduledFor: new Date(), executedAt: new Date(), idempotencyKey: key } });
      await this.allocate(tx, run.id, take, 'COLLECTED');
      const done = open - take === 0;
      await tx.commissionRun.update({ where: { id: run.id }, data: { deductedMinor: { increment: take }, ...(done ? { status: 'COLLECTED' } : {}) } });
      await this.claims.timeline(tx, run.orgRef, run.id, 'DEDUCTED_FROM_PAYOUT', { payoutRef: i.payoutRef, amountMinor: take, remainingMinor: open - take }, 'RUN');
      if (done) await tx.commissionAttempt.updateMany({ where: { runId: run.id, kind: 'DEDUCT', status: 'PENDING' }, data: { status: 'SUCCEEDED', executedAt: new Date(), amountMinor: 0 } });
      left -= take; total += take;
      await this.outbox.enqueue(tx, { type: 'kiorly.commission_collection', target: 'KIORLY', aggregateType: 'CommissionRun', aggregateId: run.id, payload: { runId: run.id }, dedupeKey: `kiorly.commission_collection:${run.id}:ded:${i.payoutId}` });
    }
    if (total > 0) await postLedgerTx(tx, { key: `commission-net:${i.payoutId}`, kind: 'COMMISSION_NETTED', postings: commissionNet(i.clinicId, total), clinicId: i.clinicId, memo: i.payoutRef });
    return total;
  }

  // ───────────────────────── dunning / deadlines ─────────────────────────
  /** Runs everything that is due: charge retries and net-from-payout windows that ended without enough payouts (the rest becomes an invoice). Idempotent. */
  async processPending(now = new Date()): Promise<{ retried: number; fellBack: number }> {
    const due = await this.prisma.commissionAttempt.findMany({ where: { status: 'PENDING', scheduledFor: { lte: now } }, orderBy: { scheduledFor: 'asc' }, take: 200 });
    let retried = 0, fellBack = 0;
    for (const a of due) {
      const run = await this.prisma.commissionRun.findUnique({ where: { id: a.runId } });
      if (!run || !['COLLECTING', 'RETRYING'].includes(run.status)) { await this.prisma.commissionAttempt.update({ where: { id: a.id }, data: { status: 'FAILED', failureCode: 'RUN_CLOSED' } }); continue; }
      if (a.kind === 'CHARGE') { await this.charge(run.id, a.attemptNo, now); retried++; }
      else if (a.kind === 'DEDUCT') {
        await this.prisma.commissionAttempt.update({ where: { id: a.id }, data: { status: 'FAILED', failureCode: 'PAYOUT_WINDOW_ENDED', executedAt: now } });
        await this.fallBackToInvoice(run.id, 'NET_SHORTFALL', now); fellBack++;
      }
    }
    return { retried, fellBack };
  }

  /** Retry now (finance / super admin): the pending attempt of a RETRYING run runs immediately. */
  async retryNow(runId: string, actor: string, now = new Date()): Promise<void> {
    const run = await this.prisma.commissionRun.findUnique({ where: { id: runId } });
    if (!run) throw notFound('RUN_NOT_FOUND', 'No such run');
    if (run.status !== 'RETRYING') throw conflict('NOT_RETRYING', 'Only a run in RETRYING can be retried');
    await this.claims.timeline(this.prisma, run.orgRef, runId, 'RETRY_REQUESTED', { by: actor }, 'RUN', actor);
    const a = await this.prisma.commissionAttempt.findFirst({ where: { runId, status: 'PENDING', kind: 'CHARGE' }, orderBy: { attemptNo: 'asc' } });
    if (a) await this.charge(runId, a.attemptNo, now);
  }

  /** The organisation (or finance on its behalf) paid the invoice through the chosen provider. Idempotent on the provider reference. */
  async markInvoicePaid(i: { runId: string; providerRef: string; amountMinor?: number; actor: string }, now = new Date()) {
    const run = await this.prisma.commissionRun.findUnique({ where: { id: i.runId } });
    if (!run) throw notFound('RUN_NOT_FOUND', 'No such run');
    if (!/^[A-Za-z0-9_.:#-]{3,100}$/.test(i.providerRef)) throw badRequest('INVALID_PROVIDER_REF', 'providerRef is not valid');
    const key = `invpay:${i.runId}:${i.providerRef}`;
    if (await this.prisma.commissionAttempt.findUnique({ where: { idempotencyKey: key } })) return this.prisma.commissionRun.findUniqueOrThrow({ where: { id: i.runId } });
    const owed = run.invoicedMinor - run.paidMinor;
    const amount = i.amountMinor ?? owed;
    if (!Number.isInteger(amount) || amount <= 0 || amount > owed) throw badRequest('INVALID_AMOUNT', 'Amount must be a whole number of minor units, at most what is still owed', { owedMinor: owed });
    await this.prisma.$transaction(async (tx) => {
      await tx.commissionAttempt.create({ data: { id: newId('cat'), runId: i.runId, orgRef: run.orgRef, attemptNo: 1 + (await tx.commissionAttempt.count({ where: { runId: i.runId } })), kind: 'INVOICE_PAYMENT', provider: run.provider, providerRef: i.providerRef, amountMinor: amount, status: 'SUCCEEDED', scheduledFor: now, executedAt: now, idempotencyKey: key } });
      await postLedgerTx(tx, { key: `commission-received:${key}`, kind: 'COMMISSION_INVOICE_PAID', postings: commissionReceived(amount), memo: `${run.orgRef} ${run.invoiceNo ?? run.periodKey}` });
      await this.allocate(tx, i.runId, amount, 'PAID', ['INVOICED']);
      await tx.commissionRun.update({ where: { id: i.runId }, data: { paidMinor: { increment: amount } } });
      await this.claims.timeline(tx, run.orgRef, i.runId, 'INVOICE_PAYMENT_RECORDED', { providerRef: i.providerRef, amountMinor: amount, by: i.actor }, 'RUN', i.actor);
      await tx.auditLog.create({ data: { actor: i.actor, action: 'commission.invoice_payment_recorded', resource: 'CommissionRun', resourceId: i.runId, metadata: { providerRef: i.providerRef, amountMinor: amount } } });
    });
    await this.finishIfSettled(i.runId);
    await this.push(i.runId);
    return this.prisma.commissionRun.findUniqueOrThrow({ where: { id: i.runId } });
  }

  private async finishIfSettled(runId: string) {
    const r = await this.prisma.commissionRun.findUniqueOrThrow({ where: { id: runId } });
    const done = r.collectedMinor + r.deductedMinor + r.paidMinor >= r.claimsMinor && r.invoicedMinor === r.paidMinor;
    if (done && r.status !== 'SETTLED' && r.status !== 'COLLECTED') { await this.prisma.commissionRun.update({ where: { id: runId }, data: { status: 'SETTLED' } }); await this.claims.timeline(this.prisma, r.orgRef, runId, 'RUN_SETTLED', {}, 'RUN'); }
  }

  // ───────────────────────── saved method (provider hosted enrolment; mock in mock mode) ─────────────────────────
  async saveMethod(i: { orgRef: string; provider: string; tokenRef: string; brand?: string; last4?: string; actor: string }) {
    if (cfg().pspMode !== 'sandbox-fake') throw badRequest('USE_PROVIDER_ENROLMENT', 'In real mode a saved method is enrolled through the provider\'s hosted flow (NEEDS_HUMAN, LG-COM-3), never typed in');
    if (!/^[A-Za-z0-9_.:-]{3,120}$/.test(i.tokenRef)) throw badRequest('INVALID_TOKEN_REF', 'tokenRef is not valid (an opaque provider reference, never a card number)');
    if (/^\d{12,19}$/.test(i.tokenRef.replace(/[ -]/g, ''))) throw badRequest('LOOKS_LIKE_A_CARD_NUMBER', 'A card number is never accepted');
    await this.prisma.commissionSavedMethod.updateMany({ where: { orgRef: i.orgRef, provider: i.provider, status: 'ACTIVE' }, data: { status: 'REVOKED', revokedAt: new Date() } });
    const row = await this.prisma.commissionSavedMethod.create({ data: { id: newId('csm'), orgRef: i.orgRef, provider: i.provider, tokenRef: i.tokenRef, brand: i.brand?.slice(0, 20), last4: i.last4 && /^\d{4}$/.test(i.last4) ? i.last4 : undefined } });
    await this.prisma.auditLog.create({ data: { actor: i.actor, action: 'commission.saved_method_enrolled', resource: 'CommissionSavedMethod', resourceId: row.id, metadata: { orgRef: i.orgRef, provider: i.provider } } });
    return { id: row.id, provider: row.provider, brand: row.brand, last4: row.last4, status: row.status };
  }

  // ───────────────────────── push to the product (transparency on the provider side) ─────────────────────────
  private async push(runId: string) {
    await this.outbox.enqueue(this.prisma, { type: 'kiorly.commission_collection', target: 'KIORLY', aggregateType: 'CommissionRun', aggregateId: runId, payload: { runId }, dedupeKey: `kiorly.commission_collection:${runId}:${Date.now().toString(36)}` });
  }

  async snapshot(runId: string) {
    const run = await this.prisma.commissionRun.findUnique({ where: { id: runId } });
    if (!run) return null;
    const [claims, attempts, tl] = await Promise.all([
      this.prisma.commissionClaim.findMany({ where: { runId }, select: { chargeId: true, appointmentId: true, amountMinor: true, collectedMinor: true, collectionStatus: true, chargeStatus: true, decisionRef: true, feeBasisMinor: true, sponsoredDiscountMinor: true, basisPolicyVersion: true, disputeStatus: true, disputeDeadline: true, tender: true, rateSource: true, rateSnapshot: true }, orderBy: { id: 'asc' } }),
      this.prisma.commissionAttempt.findMany({ where: { runId }, orderBy: { createdAt: 'asc' }, select: { attemptNo: true, kind: true, provider: true, payoutRef: true, amountMinor: true, status: true, failureCode: true, scheduledFor: true, executedAt: true } }),
      this.prisma.commissionTimeline.findMany({ where: { subjectType: 'RUN', subjectId: runId }, orderBy: { at: 'asc' }, select: { at: true, event: true, actor: true } }),
    ]);
    return { runId: run.id, orgRef: run.orgRef, periodKey: run.periodKey, cutoffAt: run.cutoffAt, collectAt: run.collectAt, status: run.status, mode: run.mode, modeRequested: run.modeRequested, fallbackReason: run.fallbackReason, provider: run.provider, currency: run.currency, claimsCount: run.claimsCount, claimsMinor: run.claimsMinor, collectedMinor: run.collectedMinor, deductedMinor: run.deductedMinor, invoicedMinor: run.invoicedMinor, paidMinor: run.paidMinor, invoiceNo: run.invoiceNo, invoiceDueAt: run.invoiceDueAt, version: run.updatedAt.getTime(), claims, attempts, timeline: tl.map((e) => ({ at: e.at, event: e.event, by: e.actor === 'system' ? 'system' : 'kiorex' })) };
  }

  private async pushToClinic(runId: string) {
    const snap = await this.snapshot(runId);
    if (!snap) return;
    const c = await this.prisma.commissionClaim.findFirst({ where: { runId, clinicId: { not: null } }, select: { clinicId: true } });
    await this.kiorly.recordCommissionCollection(snap, c?.clinicId ?? undefined);
  }
}
