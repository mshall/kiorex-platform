import { Injectable, Logger } from '@nestjs/common';
import { newId } from '../common/ids';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { CommissionRateService } from './commission-rate.service';
import { expectedCommissionMinor } from './commission-rate';
import { parseTenderFields, type TenderFields } from './commission-tender';

const minor = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v * 100);
  if (typeof v === 'string' && /^-?\d+(\.\d{1,2})?$/.test(v)) return Math.round(Number(v) * 100);
  return null;
};
const date = (v: unknown): Date | null => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v) : null);
const str = (v: unknown, max = 120): string | null => (typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null);
const CLAIM_EVENTS = new Set(['COMMISSION_CHARGE_CREATED', 'COMMISSION_CHARGE_REVERSED', 'COMMISSION_CHARGE_STATUS_CHANGED']);
export const isCommissionClaimEvent = (type: string) => CLAIM_EVENTS.has(type);
/** Statuses that take a claim out of collection. */
const OUT = new Set(['REVERSED', 'WAIVED']);

/** Tender of the event; an event that does not carry a valid tender keeps what the claim had (LG-COM-20: tenderMethod / tenderDetail are additive and optional, so an older client's CASH stays plain CASH). */
export function tenderOf(data: Record<string, any>, prev?: { tender: string | null; tenderMethod: string | null; tenderDetail: string | null } | null): TenderFields {
  const n = parseTenderFields(data);
  const had = { tender: (prev?.tender ?? null) as TenderFields['tender'], tenderMethod: (prev?.tenderMethod ?? null) as TenderFields['tenderMethod'], tenderDetail: (prev?.tenderDetail ?? null) as TenderFields['tenderDetail'] };
  if (!n.tender) return had;
  if (n.tender === 'CASH' && !n.tenderMethod && had.tender === 'CASH') return had; // same tender, no kind in this event: keep the kind already known
  return n;
}

export type ClaimOutcome = 'APPLIED' | 'IGNORED' | 'STALE';

/**
 * COM-1 claim ingestion: the Clinic stays the system of record for the charge and the decision; Kiorex mirrors what it is owed, idempotently and in time order
 * (an event older than the newest applied one is ignored). A reversal after money was taken never silently keeps the money: the claim is flagged `reversedAfterCollection` (a credit is due) and
 * shows on the reconciliation. A reversal before collection releases the claim from its run and the run totals are recomputed.
 */
@Injectable()
export class CommissionClaimsService {
  private readonly log = new Logger('commission-claims');
  constructor(private readonly prisma: PrismaService, private readonly rates: CommissionRateService) {}

  async applyEvent(type: string, data: Record<string, any>, ctx: { tenantId?: string; occurredAt?: string }): Promise<ClaimOutcome> {
    if (!CLAIM_EVENTS.has(type)) return 'IGNORED';
    const chargeId = str(data.chargeId); const appointmentId = str(data.appointmentId);
    const amountMinor = minor(data.amount);
    const orgRef = str(data.tenantId ?? ctx.tenantId, 64);
    if (!chargeId || !appointmentId || amountMinor === null || amountMinor < 0 || !orgRef) {
      await this.prisma.auditLog.create({ data: { actor: 'system', action: 'commission.claim_event_ignored', resource: 'CommissionClaim', resourceId: chargeId ?? undefined, metadata: { type, reason: !orgRef ? 'NO_ORG' : 'INVALID_PAYLOAD' } } });
      return 'IGNORED';
    }
    const at = date(ctx.occurredAt) ?? new Date();
    const status = type === 'COMMISSION_CHARGE_REVERSED' ? 'REVERSED' : (str(data.status, 20) ?? 'PENDING');
    return this.prisma.$transaction(async (tx) => {
      const prev = await tx.commissionClaim.findUnique({ where: { chargeId } });
      if (prev?.lastEventAt && at.getTime() < prev.lastEventAt.getTime()) return 'STALE' as const;
      // a (re)delivered CREATED never downgrades a claim that moved on; only a re-activation after REVERSED / WAIVED is a real CREATED
      if (prev && type === 'COMMISSION_CHARGE_CREATED' && !OUT.has(prev.chargeStatus)) return 'STALE' as const;
      const decisionAmountMinor = data.decisionAmount !== undefined ? minor(data.decisionAmount) : (prev?.decisionAmountMinor ?? null);
      const fields = {
        clinicId: str(data.clinicId, 64) ?? prev?.clinicId ?? null,
        market: (str(data.market, 2) ?? prev?.market ?? 'EG').toUpperCase(),
        appointmentId, amountMinor, decisionAmountMinor,
        currency: (str(data.currency, 3) ?? prev?.currency ?? 'EGP').toUpperCase(),
        decisionRef: str(data.decisionRef) ?? prev?.decisionRef ?? null,
        policyVersion: str(data.policyVersion) ?? prev?.policyVersion ?? null,
        origin: str(data.origin, 40) ?? prev?.origin ?? '',
        feeBasisMinor: typeof data.feeBasisMinor === 'number' ? data.feeBasisMinor : (prev?.feeBasisMinor ?? null),
        sponsoredDiscountMinor: typeof data.sponsoredDiscountMinor === 'number' ? data.sponsoredDiscountMinor : (prev?.sponsoredDiscountMinor ?? null),
        basisPolicyVersion: str(data.basisPolicyVersion) ?? prev?.basisPolicyVersion ?? null,
        ...tenderOf(data, prev),
        attendedAt: date(data.attendedAt) ?? prev?.attendedAt ?? null,
        confirmedAt: status === 'CONFIRMED' ? (date(data.confirmedAt) ?? prev?.confirmedAt ?? at) : (OUT.has(status) || status === 'PENDING' || status === 'DISPUTED' ? (status === 'DISPUTED' ? prev?.confirmedAt ?? null : null) : (date(data.confirmedAt) ?? prev?.confirmedAt ?? null)),
        disputeDeadline: date(data.disputeDeadline) ?? prev?.disputeDeadline ?? null,
        disputeStatus: data.disputeStatus === null ? null : (str(data.disputeStatus, 20) ?? prev?.disputeStatus ?? null),
        chargeStatus: status,
        lastEventAt: at,
      };
      if (!prev) {
        // COM-2: the organisation inherits its product default when first seen, and the claim keeps the rate that applied when it was reported (never rewritten, so later rate changes do not touch past charges)
        await this.rates.ensureLink(orgRef, 'CLINIC', tx);
        const rate = await this.rates.effectiveAt(orgRef, 'CLINIC', fields.attendedAt ?? at, tx);
        const snapshot = rate.state === 'SET' ? { source: rate.source, policyId: rate.policyId, version: rate.version, effectiveFrom: rate.effectiveFrom, spec: rate.spec, expectedMinor: fields.feeBasisMinor != null ? expectedCommissionMinor(fields.feeBasisMinor, rate) : null } : null;
        const created = await tx.commissionClaim.create({ data: { id: newId('ccl'), orgRef, chargeId, ...fields, rateSource: rate.source, ratePolicyId: rate.policyId, rateSnapshot: (snapshot ?? undefined) as object | undefined } });
        await this.timeline(tx, orgRef, created.id, 'CLAIM_REPORTED', { status, amountMinor });
        return 'APPLIED' as const;
      }
      let collectionStatus = prev.collectionStatus; let runId = prev.runId; let reversedAfterCollection = prev.reversedAfterCollection;
      if (OUT.has(status)) {
        if (prev.collectedMinor > 0 || ['COLLECTED', 'INVOICED', 'PAID'].includes(prev.collectionStatus)) { reversedAfterCollection = true; await this.timeline(tx, orgRef, prev.id, 'REVERSED_AFTER_COLLECTION', { status, collectedMinor: prev.collectedMinor, amountMinor: prev.amountMinor }); }
        else if (prev.collectionStatus === 'IN_RUN') { collectionStatus = 'RELEASED'; await this.timeline(tx, orgRef, prev.id, 'RELEASED_FROM_RUN', { status, runId: prev.runId }); }
        else if (prev.collectionStatus === 'UNCOLLECTED') collectionStatus = 'RELEASED';
      } else if (prev.collectionStatus === 'RELEASED') { collectionStatus = 'UNCOLLECTED'; runId = null; } // the Clinic re-activated the charge
      await tx.commissionClaim.update({ where: { id: prev.id }, data: { ...fields, collectionStatus, runId, reversedAfterCollection } });
      if (prev.chargeStatus !== status) await this.timeline(tx, orgRef, prev.id, `CHARGE_${status}`, { from: prev.chargeStatus, to: status });
      if (collectionStatus === 'RELEASED' && prev.collectionStatus === 'IN_RUN' && prev.runId) await this.recomputeRun(tx, prev.runId);
      return 'APPLIED' as const;
    });
  }

  timeline(tx: Tx | PrismaService, orgRef: string, subjectId: string, event: string, detail?: Record<string, unknown>, subjectType = 'CLAIM', actor = 'system') {
    return tx.commissionTimeline.create({ data: { orgRef, subjectType, subjectId, event, detail: detail as object | undefined, actor } });
  }

  /** The books of a run after a claim left it: counts and totals follow the claims still in it; the invoiced part shrinks first, never below what was actually settled. */
  async recomputeRun(tx: Tx, runId: string) {
    const run = await tx.commissionRun.findUnique({ where: { id: runId } });
    if (!run) return;
    const live = await tx.commissionClaim.findMany({ where: { runId, collectionStatus: { not: 'RELEASED' } }, select: { amountMinor: true } });
    const claimsMinor = live.reduce((s, c) => s + c.amountMinor, 0);
    const over = Math.max(0, run.collectedMinor + run.deductedMinor + run.invoicedMinor - claimsMinor);
    const invoicedMinor = run.invoicedMinor - Math.min(over, run.invoicedMinor);
    await tx.commissionRun.update({ where: { id: runId }, data: { claimsCount: live.length, claimsMinor, invoicedMinor } });
    await this.timeline(tx, run.orgRef, runId, 'RUN_RECOMPUTED', { claimsCount: live.length, claimsMinor, invoicedMinor }, 'RUN');
  }
}
