import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  DEFAULT_FRAUD_CONFIG, assessAttempt, clampFraudConfig, clampMatchConfig, clampRouting, matchSignal, orderProviders, qrPlan, readLink, redeemLink, reportCsv, reportPdfLatin, rollup, rollupTable, signLink,
  type LinkRefusal, type MatchTarget, type PayAttempt, type PayContext, type RollupLevel, type RollupRow,
} from '@kiorex/pay-contract';
import { cfg } from '../common/config';
import { badRequest, conflict, notFound } from '../common/errors';
import { newId } from '../common/ids';
import { policyNow } from '../growth/growth-public';
import { PrismaService } from '../prisma/prisma.service';
import { BankIpnPspAdapter } from './psp-bank-ipn';
import { PayService } from './pay.service';
import { PspConfigService } from './psp-config.service';
import { PSP_NAMES } from './psp-config';
import type { PspWebhookEvent } from './psp-types';

const FINANCE_MAX_PAGE = 200;
const linkSecret = (): string => {
  const s = process.env.PAY_LINK_SECRET ?? '';
  if (s.length >= 32) return s;
  if (cfg().isProd) throw new Error('NEEDS_HUMAN: PAY_LINK_SECRET (32+ characters, Secrets Manager /kiorex/<env>/pay-link-secret) is required in production');
  return 'dev-only-pay-link-secret-not-for-production-0000';
};

/**
 * Kiorly Pay unified layer on the shared contract: invoice matching (IPN rows against payments, confidence + human queue), payment links with dynamic QR plans, organisation provider
 * preference with success-rate ordering, the SHADOW fraud scorer and the rollup reports. Kiorly never holds money: everything here records, orders, scores or reports.
 */
@Injectable()
export class PayUnifiedService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService, private readonly pay: PayService, private readonly psp: PspConfigService) {}

  onModuleInit() {
    // a link payment is a vertical-less order: nothing downstream waits for it, the capture is the record
    this.pay.onOrderCaptured('LINK', async () => undefined);
    this.pay.afterFinal = (id) => { void this.assessPayment(id); }; // SHADOW fraud scoring runs beside the payment path and can never fail or delay it
  }

  // ───────────── Phase 2: matching ─────────────
  async matchingTargets(reference: string | undefined, amountMinor: number, currency: string): Promise<MatchTarget[]> {
    const rows = await this.prisma.paymentIntent.findMany({ where: { currency, OR: [...(reference ? [{ id: reference }] : []), { status: 'CREATED', amountMinor, psp: 'bank_ipn' }] }, take: 50, orderBy: { createdAt: 'desc' } });
    return rows.map((p) => ({ id: p.id, kind: 'KIOREX_LEDGER' as const, reference: p.id, amountMinor: p.amountMinor, currency: p.currency, issuedAt: p.createdAt.toISOString(), settled: p.status !== 'CREATED', organisationId: p.clinicId }));
  }

  /** Ingest a bank IPN file: every row is de-duplicated, matched, and either applied (AUTO, exact) or queued for a finance person. */
  async ingestIpnFile(i: { content: string; format?: 'csv' | 'json'; actor: string; filename?: string }) {
    const adapter = new BankIpnPspAdapter(process.env);
    const { events, rejected } = adapter.ingestFile(i.content, i.format);
    const mcfg = clampMatchConfig(policyNow('PAY_MATCHING_POLICY') as never).config;
    const out = { received: events.length, rejected, applied: 0, queued: 0, duplicates: 0, failed: 0 };
    for (const ev of events) {
      const dedupeKey = `IPN:bank_ipn:${ev.pspRef}:${ev.type}`;
      if (await this.prisma.payMatchSignal.findUnique({ where: { dedupeKey }, select: { id: true } })) { out.duplicates++; continue; }
      const reversal = ev.type !== 'payment.captured';
      const targets = reversal ? [] : await this.matchingTargets(ev.paymentId ?? ev.reference, ev.amountMinor, ev.currency ?? 'EGP');
      const r = reversal ? { decision: 'REVIEW' as const, targetId: undefined, confidence: 0, reasons: ['REVERSAL_NEEDS_HUMAN'], candidates: [] } : matchSignal({ id: ev.eventId, source: 'IPN', reference: ev.reference, amountMinor: ev.amountMinor, currency: ev.currency ?? 'EGP', occurredAt: ev.occurredAt, payerName: undefined, pspRef: ev.pspRef }, targets, mcfg);
      let status = 'OPEN'; let note: string | undefined; let decision: string = r.decision;
      if (r.decision === 'AUTO' && r.targetId) {
        try { await this.pay.ingestVerifiedEvent('bank_ipn', { ...(ev as PspWebhookEvent), paymentId: r.targetId }, 'ipn'); status = 'APPLIED'; out.applied++; }
        catch (e) { decision = 'REVIEW'; note = `auto apply refused: ${(e as { code?: string }).code ?? 'ERROR'}`; out.failed++; }
      }
      if (status === 'OPEN') out.queued++;
      await this.prisma.payMatchSignal.create({ data: { id: newId('pms'), dedupeKey, source: 'IPN', psp: 'bank_ipn', pspRef: ev.pspRef, reference: ev.reference ?? null, amountMinor: ev.amountMinor, currency: ev.currency ?? 'EGP', occurredAt: new Date(ev.occurredAt), payerMasked: ev.payerMasked ?? null, eventKind: ev.type, decision, status, targetKind: r.targetId ? 'KIOREX_LEDGER' : null, targetId: r.targetId ?? null, confidence: r.confidence, reasons: r.reasons as never, candidates: r.candidates as never, note: note ?? null, decidedBy: status === 'APPLIED' ? 'auto' : null, decidedAt: status === 'APPLIED' ? new Date() : null } });
    }
    await this.prisma.auditLog.create({ data: { actor: i.actor, action: 'pay.ipn_file_ingested', resource: 'PayMatchSignal', resourceId: i.filename ?? 'ipn-file', metadata: { received: out.received, applied: out.applied, queued: out.queued, rejected: rejected.length } as never } });
    return out;
  }

  queue(q: { status?: string; take?: number } = {}) { return this.prisma.payMatchSignal.findMany({ where: { status: q.status ?? 'OPEN' }, orderBy: { createdAt: 'asc' }, take: Math.min(q.take ?? 100, FINANCE_MAX_PAGE) }); }

  /** A finance person pairs a queued signal with a payment. The payment's own amount / currency checks still apply (a mismatch is refused, never forced). */
  async confirm(id: string, targetId: string, actor: string) {
    const s = await this.prisma.payMatchSignal.findUnique({ where: { id } });
    if (!s) throw notFound('MATCH_NOT_FOUND', 'Match item not found');
    if (s.status !== 'OPEN') throw conflict('MATCH_NOT_OPEN', 'Match item was already decided');
    if (s.eventKind !== 'payment.captured') throw badRequest('MATCH_KIND_NOT_APPLICABLE', 'Reversals are handled by finance with the bank, not applied automatically');
    const claimed = await this.prisma.payMatchSignal.updateMany({ where: { id, status: 'OPEN' }, data: { status: 'CONFIRMED', targetId, targetKind: 'KIOREX_LEDGER', decidedBy: actor, decidedAt: new Date() } });
    if (!claimed.count) throw conflict('MATCH_NOT_OPEN', 'Match item was already decided');
    try {
      const r = await this.pay.ingestVerifiedEvent('bank_ipn', { eventId: `ipn:bank_ipn:${s.pspRef}`, type: 'payment.captured', pspRef: s.pspRef, paymentId: targetId, amountMinor: s.amountMinor, currency: s.currency, occurredAt: s.occurredAt.toISOString() } as PspWebhookEvent, 'ipn-confirm');
      await this.prisma.auditLog.create({ data: { actor, action: 'pay.match_confirmed', resource: 'PayMatchSignal', resourceId: id, metadata: { targetId, result: r.status } as never } });
      return { id, status: 'CONFIRMED', result: r.status };
    } catch (e) { await this.prisma.payMatchSignal.updateMany({ where: { id, status: 'CONFIRMED' }, data: { status: 'OPEN', decidedBy: null, decidedAt: null, note: `confirm refused: ${(e as { code?: string }).code ?? 'ERROR'}` } }); throw e; }
  }
  async reject(id: string, actor: string, note?: string) {
    const r = await this.prisma.payMatchSignal.updateMany({ where: { id, status: 'OPEN' }, data: { status: 'REJECTED', decidedBy: actor, decidedAt: new Date(), note: note?.slice(0, 300) ?? null } });
    if (!r.count) throw conflict('MATCH_NOT_OPEN', 'Match item not found or already decided');
    await this.prisma.auditLog.create({ data: { actor, action: 'pay.match_rejected', resource: 'PayMatchSignal', resourceId: id, metadata: {} as never } });
    return { id, status: 'REJECTED' };
  }

  // ───────────── Phase 3: links and QR ─────────────
  async createLink(i: { context: PayContext; subjectId: string; organisationId: string; branchId?: string; amountMinor: number; currency?: string; rail?: string; ttlSec?: number; actor: string }) {
    const currency = (i.currency ?? 'EGP').toUpperCase();
    if (!Number.isSafeInteger(i.amountMinor) || i.amountMinor <= 0 || i.amountMinor > 2_147_483_647) throw badRequest('INVALID_AMOUNT', 'amountMinor must be a positive whole number');
    const rail = i.rail ?? 'card';
    const id = newId('lnk');
    const { token, claim } = signLink(linkSecret(), { id, ctx: i.context, subject: i.subjectId, amountMinor: i.amountMinor, currency, org: i.organisationId, branch: i.branchId, rail, ttlSec: i.ttlSec });
    // QR kind: only a PROVIDER QR when the chosen rail's adapter supports one (none does today: config-only), otherwise the QR encodes our hosted link
    const url = `${cfg().webBaseUrl}/pay/l/${token}`;
    const qr = qrPlan({ capabilities: { rails: [], capture: false, void: false, status: false, partialRefund: false, hostedCheckout: true, cardFacts: false, fileIngest: false, qr: 'LINK' } }, { checkoutUrl: url });
    await this.prisma.payLinkIssue.create({ data: { id, context: i.context, subjectId: i.subjectId, organisationId: i.organisationId, branchId: i.branchId ?? null, amountMinor: i.amountMinor, currency, rail, qrKind: qr.kind, expiresAt: new Date(claim.exp * 1000), createdBy: i.actor } });
    await this.prisma.auditLog.create({ data: { actor: i.actor, action: 'pay.link_created', resource: 'PayLinkIssue', resourceId: id, metadata: { context: i.context, amountMinor: i.amountMinor } as never } });
    return { id, token, url, expiresAt: new Date(claim.exp * 1000).toISOString(), qr: { kind: qr.kind, content: qr.content } };
  }
  async linkStatus(token: string) {
    const r = readLink(linkSecret(), token); if (!r.ok) throw notFound('LINK_NOT_FOUND', 'Payment link not found');
    const row = await this.prisma.payLinkIssue.findUnique({ where: { id: r.claim.id } }); if (!row) throw notFound('LINK_NOT_FOUND', 'Payment link not found');
    const status = row.cancelledAt ? 'CANCELLED' : row.usedAt ? 'USED' : row.expiresAt < new Date() ? 'EXPIRED' : 'ACTIVE';
    return { id: row.id, context: row.context, amountMinor: row.amountMinor, currency: row.currency, expiresAt: row.expiresAt.toISOString(), status, paymentId: row.paymentIntentId };
  }
  async cancelLink(id: string, actor: string) {
    const r = await this.prisma.payLinkIssue.updateMany({ where: { id, usedAt: null, cancelledAt: null }, data: { cancelledAt: new Date() } });
    if (!r.count) throw conflict('LINK_NOT_CANCELLABLE', 'Link not found, already used or already cancelled');
    await this.prisma.auditLog.create({ data: { actor, action: 'pay.link_cancelled', resource: 'PayLinkIssue', resourceId: id, metadata: {} as never } });
    return { id, status: 'CANCELLED' };
  }
  /** Redeem (signature, expiry, amount lock, rail, SINGLE USE via one atomic UPDATE) and start the checkout. Refused links are never consumed; a checkout that fails after consuming gives the link back. */
  async redeemAndCheckout(token: string, sub?: string) {
    const row0 = await this.linkStatus(token);
    if (row0.status !== 'ACTIVE') throw conflict(`LINK_${row0.status}`, `Payment link refused (${row0.status})`); // the stored state (cancelled, shortened, used) wins over the token's own expiry
    const claimed = readLink(linkSecret(), token); if (!claimed.ok) throw notFound('LINK_NOT_FOUND', 'Payment link not found');
    const c = claimed.claim;
    const store = { markUsed: async (id: string) => (await this.prisma.payLinkIssue.updateMany({ where: { id, usedAt: null, cancelledAt: null }, data: { usedAt: new Date() } })).count === 1 };
    const res = await redeemLink(linkSecret(), token, { amountMinor: row0.amountMinor, currency: row0.currency, subject: c.subject, rail: c.rail }, store);
    if (!res.ok) throw conflict(`LINK_${res.reason as LinkRefusal}`, `Payment link refused (${res.reason})`);
    try {
      const chosen = (await this.orderedCandidates({ currency: c.currency, organisationId: c.org, rail: c.rail }))[0];
      if (!chosen) throw badRequest('PSP_NOT_AVAILABLE', 'No payment provider is available for this link');
      const intent = await this.pay.createLinkIntent({ linkId: c.id, sub, clinicId: c.org ?? 'unknown', amountMinor: c.amountMinor, currency: c.currency, psp: chosen, orderRef: `${c.ctx}:${c.subject}`, rail: c.rail === 'wallet' ? 'wallet' : 'card' });
      await this.prisma.payLinkIssue.update({ where: { id: c.id }, data: { paymentIntentId: intent.id } });
      return { paymentId: intent.id, checkoutUrl: intent.checkoutUrl, status: intent.status };
    } catch (e) { await this.prisma.payLinkIssue.updateMany({ where: { id: c.id, paymentIntentId: null }, data: { usedAt: null } }); throw e; }
  }

  // ───────────── Phase 4: organisation preference and success-rate ordering ─────────────
  async setOrgPreference(organisationId: string, p: { order: string[]; blocked?: string[] }, actor: string) {
    const bad = [...p.order, ...(p.blocked ?? [])].filter((x) => !PSP_NAMES.includes(x as never));
    if (bad.length) throw badRequest('UNKNOWN_PSP', `Unknown provider: ${bad[0]}`);
    const blocked = p.blocked ?? [];
    const order = p.order.filter((x) => !blocked.includes(x));
    const row = await this.prisma.payOrgProviderPref.upsert({ where: { organisationId }, create: { organisationId, order: order as never, blocked: blocked as never, updatedBy: actor }, update: { order: order as never, blocked: blocked as never, version: { increment: 1 }, updatedBy: actor } });
    await this.prisma.auditLog.create({ data: { actor, action: 'pay.org_preference_changed', resource: 'PayOrgProviderPref', resourceId: organisationId, metadata: { order, blocked } as never } });
    return { organisationId, order, blocked, version: row.version };
  }
  getOrgPreference(organisationId: string) { return this.prisma.payOrgProviderPref.findUnique({ where: { organisationId } }); }

  async successStats(days = 30): Promise<Record<string, { attempts: number; successes: number }>> {
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await this.prisma.paymentIntent.groupBy({ by: ['psp', 'status'], where: { createdAt: { gte: since }, status: { in: ['CAPTURED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'FAILED'] } }, _count: { _all: true } });
    const out: Record<string, { attempts: number; successes: number }> = {};
    for (const r of rows) { const o = (out[r.psp] ??= { attempts: 0, successes: 0 }); o.attempts += r._count._all; if (r.status !== 'FAILED') o.successes += r._count._all; }
    return out;
  }
  /** Providers for a payment, best first: platform settings decide what is eligible, then organisation preference and observed success order them (config: PAY_ROUTING_POLICY; fees never assumed). */
  async orderedCandidates(i: { currency: string; organisationId?: string; rail?: string }): Promise<string[]> {
    const list = await this.psp.candidates({ currency: i.currency });
    const pref = i.organisationId ? await this.getOrgPreference(i.organisationId) : null;
    const order = ((pref?.order as string[] | undefined) ?? []); const blocked = new Set((pref?.blocked as string[] | undefined) ?? []);
    const stats = await this.successStats();
    const RAILS: Record<string, string[]> = { paymob: ['card', 'wallet'], fawry: ['fawry_code', 'card'], instapay: ['instapay'], card: ['card'], bank_ipn: ['bank_ipn'] };
    const d = orderProviders(list.map((c, idx) => ({ psp: c.psp, enabled: true, marketRank: idx, orgRank: order.indexOf(c.psp) >= 0 ? order.indexOf(c.psp) : undefined, orgBlocked: blocked.has(c.psp), stats: stats[c.psp], feeBps: c.settings.fee.percentBps, rails: RAILS[c.psp] })), clampRouting(policyNow('PAY_ROUTING_POLICY') as never), { rail: i.rail });
    return d.order;
  }

  // ───────────── Phase 5: fraud scorer (SHADOW) ─────────────
  /** Score one payment attempt (a PaymentIntent that just reached a final state). Never blocks, never throws into the payment path. */
  async assessPayment(paymentId: string) {
    try {
      const p = await this.prisma.paymentIntent.findUnique({ where: { id: paymentId } });
      if (!p || !p.sub) return null;
      const policy = clampFraudConfig(policyNow('PAY_FRAUD_THRESHOLDS')); const fc = policy.config;
      const since = new Date(p.createdAt.getTime() - fc.fingerprintReuse.windowSec * 1000);
      const hist = await this.prisma.paymentIntent.findMany({ where: { id: { not: p.id }, createdAt: { gte: since, lte: p.createdAt }, OR: [{ sub: p.sub }, ...(p.cardFingerprint ? [{ cardFingerprint: p.cardFingerprint }] : [])] }, take: 500, orderBy: { createdAt: 'desc' } });
      const att = (x: typeof p): PayAttempt => ({ id: x.id, at: x.createdAt.toISOString(), outcome: x.status === 'FAILED' ? 'FAILED' : x.status === 'CREATED' ? 'FAILED' : 'SUCCESS', amountMinor: x.amountMinor, currency: x.currency, accountId: x.sub ?? 'anon', orgId: x.clinicId, fingerprint: x.cardFingerprint ?? undefined, pspRef: x.pspRef ?? undefined });
      const a = assessAttempt(att(p), hist.map(att), fc);
      if (a.score <= 0) return a;
      await this.prisma.payFraudAssessment.upsert({ where: { attemptId: p.id }, create: { id: newId('pfa'), attemptId: p.id, paymentId: p.id, accountId: p.sub, organisationId: p.clinicId, score: a.score, band: a.band, mode: a.mode, action: a.action, signals: a.signals as never }, update: { score: a.score, band: a.band, signals: a.signals as never, mode: a.mode, action: a.action } });
      return a;
    } catch { return null; }
  }
  fraudQueue(q: { status?: string; band?: string; take?: number } = {}) { return this.prisma.payFraudAssessment.findMany({ where: { status: q.status ?? 'OPEN', ...(q.band ? { band: q.band } : {}) }, orderBy: [{ score: 'desc' }, { createdAt: 'desc' }], take: Math.min(q.take ?? 100, FINANCE_MAX_PAGE) }); }
  async reviewFraud(id: string, outcome: 'CONFIRMED' | 'FALSE_POSITIVE' | 'DISMISSED', actor: string, note?: string) {
    const r = await this.prisma.payFraudAssessment.updateMany({ where: { id, status: 'OPEN' }, data: { status: outcome, reviewedBy: actor, reviewedAt: new Date(), note: note?.slice(0, 300) ?? null } });
    if (!r.count) throw conflict('FRAUD_NOT_OPEN', 'Item not found or already reviewed');
    await this.prisma.auditLog.create({ data: { actor, action: 'pay.fraud_reviewed', resource: 'PayFraudAssessment', resourceId: id, metadata: { outcome } as never } }); // a person's review: no account is touched
    return { id, status: outcome };
  }
  fraudConfigInForce() { return { ...clampFraudConfig(policyNow('PAY_FRAUD_THRESHOLDS')), defaults: DEFAULT_FRAUD_CONFIG }; }

  // ───────────── Phase 5: rollups ─────────────
  async rollupRows(q: { from: Date; to: Date; organisationId?: string }): Promise<RollupRow[]> {
    const rows = await this.prisma.paymentIntent.findMany({ where: { createdAt: { gte: q.from, lt: q.to }, ...(q.organisationId ? { clinicId: q.organisationId } : {}) }, take: 50_000, orderBy: { createdAt: 'asc' } });
    return rows.map((p) => ({ at: p.createdAt.toISOString(), organisationId: p.clinicId, psp: p.psp, context: p.purpose, currency: p.currency, state: p.disputeState === 'OPEN' ? 'DISPUTED' : p.status === 'CAPTURED' ? 'CAPTURED' : p.status === 'FAILED' ? 'FAILED' : p.status === 'REFUNDED' ? 'REFUNDED' : p.status === 'PARTIALLY_REFUNDED' ? 'PARTIALLY_REFUNDED' : 'PENDING', amountMinor: p.amountMinor, refundedMinor: p.refundedMinor, feeMinor: p.feeMinor }));
  }
  async report(q: { level: RollupLevel; from: Date; to: Date; organisationId?: string; lang: 'en' | 'ar'; format: 'json' | 'csv' | 'pdf' }) {
    if (!(q.from < q.to) || q.to.getTime() - q.from.getTime() > 366 * 86_400_000) throw badRequest('INVALID_RANGE', 'from must be before to, at most one year');
    const lines = rollup(await this.rollupRows(q), q.level);
    const table = rollupTable(lines, q.lang, q.lang === 'ar' ? 'تقرير المدفوعات' : 'Payments rollup', new Date().toISOString());
    if (q.format === 'csv') return { contentType: 'text/csv; charset=utf-8', body: reportCsv(table) };
    if (q.format === 'pdf') return { contentType: 'application/pdf', body: reportPdfLatin({ ...table, lang: 'en' }) };
    return { contentType: 'application/json', body: { lines, table } };
  }
}
