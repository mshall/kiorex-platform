import { Injectable } from '@nestjs/common';
import { ApiError } from '../../common/errors';
import { subRefOf } from '../../common/privacy-hash';
import { PrismaService } from '../../prisma/prisma.service';
import type { Evaluation } from './engine';
import type { FraudRulesConfig } from './fraud-config';
import { relationshipIdsOf, FraudHoldService } from './fraud-hold.service';
import { bandOf } from './scoring';
import type { CaseStatus, FraudBand, FraudCaseKind } from './signals';

const DAY = 86_400_000;
export const dbBand = (b: FraudBand): 'LOW' | 'MEDIUM' | 'HIGH' => (b === 'HOLD' ? 'HIGH' : b === 'REVIEW' ? 'MEDIUM' : 'LOW');
export const bandFromDb = (b: string): FraudBand => (b === 'HIGH' ? 'HOLD' : b === 'MEDIUM' ? 'REVIEW' : 'ALLOW');
/** The stored decision text: `DISMISS`, `CONFIRM` or `CONFIRM;reverse=1;suspend=30` (parsed by `parseDecision`). */
export const encodeDecision = (d: { decision: 'CONFIRM' | 'DISMISS'; reverse?: boolean; suspendDays?: number }): string => (d.decision === 'DISMISS' ? 'DISMISS' : `CONFIRM${d.reverse ? ';reverse=1' : ''}${d.suspendDays ? `;suspend=${d.suspendDays}` : ''}`);
export const parseDecision = (s: string | null): { decision: 'CONFIRM' | 'DISMISS' | null; reverse: boolean; suspendDays: number } => {
  if (!s) return { decision: null, reverse: false, suspendDays: 0 };
  const parts = s.split(';');
  return { decision: parts[0] === 'CONFIRM' ? 'CONFIRM' : parts[0] === 'DISMISS' ? 'DISMISS' : null, reverse: parts.includes('reverse=1'), suspendDays: Number(parts.find((p) => p.startsWith('suspend='))?.slice(8)) || 0 };
};

/** Re-score a case from its stored signal weights (the strongest weight per rule, diminishing returns, the same formula as live scoring). */
export function rescore(weights: { ruleId: string; weight: number }[], cfg: Pick<FraudRulesConfig, 'diminishing' | 'bands'>): { score: number; band: FraudBand } {
  const best = new Map<string, number>();
  for (const w of weights) best.set(w.ruleId, Math.max(best.get(w.ruleId) ?? 0, w.weight));
  const sorted = [...best.values()].sort((a, b) => b - a);
  let t = 0; sorted.forEach((w, i) => { t += w * Math.pow(cfg.diminishing, i); });
  const score = Math.min(100, Math.max(0, Math.round(t)));
  return { score, band: bandOf(score, cfg.bands) };
}

export interface RecordInput { market: string; subject: string; evidenceRef: string; cfg: FraudRulesConfig }
export interface CaseView { id: string; kind: string; score: number; band: string; status: string; mode: string }

/**
 * Cases (GRW-P3-D). One open case per (market, subject hash, kind): new signals add to it and the score is recomputed. Signals and the decision log are append-only (database triggers);
 * the case row only moves forward (the guard trigger). A case NEVER changes an attribution decision, a commission, a booking or a provider by itself.
 */
@Injectable()
export class FraudCaseService {
  constructor(private readonly prisma: PrismaService, private readonly hold: FraudHoldService) {}

  /** Record the signals of an evaluation. Only a shadow band of REVIEW or HOLD opens a case: weak signals stay in the (existing) GrowthFraudSignal rows only. */
  async record(ev: Evaluation, i: RecordInput): Promise<{ id: string; created: boolean; band: FraudBand } | null> {
    if (!ev.signals.length || ev.shadow.band === 'ALLOW') return null;
    const subjectHash = subRefOf(i.subject);
    const enforced = ev.enforced.contributions.length > 0;
    const find = () => this.prisma.fraudCase.findFirst({ where: { market: i.market, subjectHash, kind: ev.kind, status: { in: ['OPEN', 'IN_REVIEW', 'APPEALED'] } } });
    let existing = await find(); let created = false;
    if (!existing) {
      try {
        existing = await this.prisma.fraudCase.create({ data: { market: i.market, subjectHash, kind: ev.kind, score: ev.shadow.score, band: dbBand(ev.shadow.band), mode: enforced ? 'ENFORCE' : 'SHADOW', slaDueAt: new Date(Date.now() + i.cfg.reviewSlaHours * 3_600_000) } });
        created = true;
        await this.prisma.fraudDecisionLog.create({ data: { caseId: existing.id, action: 'OPENED', toStatus: 'OPEN', actor: 'system:fraud', note: `${ev.shadow.band} ${ev.shadow.score}${ev.wouldHaveBeenHeld ? ` shadow-would:${ev.shadowAction}` : ''}` } });
      } catch (e) { if ((e as { code?: string }).code !== 'P2002') throw e; existing = await find(); if (!existing) throw e; }
    }
    const contribution = new Map(ev.shadow.contributions.map((c) => [c.ruleId, Math.round(c.contribution)]));
    await this.prisma.fraudCaseSignal.createMany({
      data: ev.signals.map((s) => ({ caseId: existing!.id, ruleId: s.ruleId, weight: Math.min(100, Math.max(-100, contribution.get(s.ruleId) ?? 0)), evidenceRef: i.evidenceRef })), skipDuplicates: true,
    });
    const all = await this.prisma.fraudCaseSignal.findMany({ where: { caseId: existing.id }, select: { ruleId: true, weight: true } });
    const rs = rescore(all, i.cfg);
    const newBand = dbBand(rs.band);
    if (rs.score !== existing.score || newBand !== existing.band || (enforced && existing.mode !== 'ENFORCE')) {
      await this.prisma.fraudCase.update({ where: { id: existing.id }, data: { score: rs.score, band: newBand, ...(enforced ? { mode: 'ENFORCE' } : {}), updatedAt: new Date() } });
      if (newBand !== existing.band && !created) await this.prisma.fraudDecisionLog.create({ data: { caseId: existing.id, action: 'SCORED', fromStatus: existing.status, toStatus: existing.status, actor: 'system:fraud', note: `${existing.band}->${newBand} ${rs.score}` } });
    }
    return { id: existing.id, created, band: rs.band };
  }

  // ───────────────────────── reading ─────────────────────────

  async evidence(id: string) {
    const c = await this.prisma.fraudCase.findUnique({ where: { id } });
    if (!c) throw new ApiError(404, 'FRAUD_CASE_NOT_FOUND', 'Case not found');
    const signals = await this.prisma.fraudCaseSignal.findMany({ where: { caseId: id }, orderBy: { at: 'asc' } });
    const log = await this.prisma.fraudDecisionLog.findMany({ where: { caseId: id }, orderBy: { at: 'asc' } });
    const relIds = relationshipIdsOf(signals.map((s) => s.evidenceRef));
    const checks = relIds.length ? await this.prisma.referralQualificationCheck.findMany({ where: { relationshipId: { in: relIds } }, orderBy: { at: 'asc' }, select: { relationshipId: true, checkKey: true, passed: true, detail: true, at: true } }) : [];
    return {
      case: { id: c.id, kind: c.kind, score: c.score, band: c.band, status: c.status, mode: c.mode, slaDueAt: c.slaDueAt, assignedTo: c.assignedTo, decision: parseDecision(c.decision), decisionNote: c.decisionNote, decidedBy: c.decidedBy, createdAt: c.createdAt, decidedAt: c.decidedAt, subjectRef: c.subjectHash.slice(0, 12) },
      signals: signals.map((s) => ({ ruleId: s.ruleId, weight: s.weight, evidenceRef: s.evidenceRef, at: s.at })),
      checks: checks.map((k) => ({ relationshipRef: k.relationshipId, key: k.checkKey, passed: k.passed, detail: k.detail, at: k.at })),
      log: log.map((l) => ({ action: l.action, from: l.fromStatus, to: l.toStatus, actor: l.actor, note: l.note, at: l.at })),
    };
  }

  /** Raw account references (opaque subs, never contact data) for the case; DPO role only, and the lookup is audited. */
  async identity(id: string, actor: string, reason: string) {
    if (!reason || reason.trim().length < 10) throw new ApiError(400, 'REASON_REQUIRED', 'Say why the identity is needed (at least 10 characters)');
    const signals = await this.prisma.fraudCaseSignal.findMany({ where: { caseId: id }, select: { evidenceRef: true } });
    const rels = relationshipIdsOf(signals.map((s) => s.evidenceRef));
    const rows = rels.length ? await this.prisma.referralRelationship.findMany({ where: { id: { in: rels } }, select: { id: true, referrerSub: true, refereeSub: true } }) : [];
    await this.prisma.auditLog.create({ data: { actor, action: 'growth.fraud.identity_lookup', resource: 'FraudCase', resourceId: id, metadata: { reason: reason.slice(0, 200), relationships: rows.length } } });
    return { accounts: rows.map((r) => ({ relationshipRef: r.id, referrerSub: r.referrerSub, refereeSub: r.refereeSub })), audited: true };
  }

  // ───────────────────────── decisions ─────────────────────────

  private async load(id: string) {
    const c = await this.prisma.fraudCase.findUnique({ where: { id } });
    if (!c) throw new ApiError(404, 'FRAUD_CASE_NOT_FOUND', 'Case not found');
    return c;
  }
  private async relsOf(caseId: string): Promise<string[]> {
    return relationshipIdsOf((await this.prisma.fraudCaseSignal.findMany({ where: { caseId }, select: { evidenceRef: true } })).map((s) => s.evidenceRef));
  }
  private async setStatus(id: string, from: CaseStatus, to: CaseStatus, action: 'ASSIGNED' | 'CONFIRMED' | 'DISMISSED' | 'APPEALED' | 'CLOSED' | 'REOPENED', actor: string, note: string | undefined, data: Record<string, unknown> = {}) {
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.fraudCase.updateMany({ where: { id, status: from }, data: { status: to, updatedAt: new Date(), ...data } });
      if (r.count !== 1) throw new ApiError(409, 'FRAUD_CASE_STATE_CHANGED', 'The case changed while you were deciding; reload it');
      await tx.fraudDecisionLog.create({ data: { caseId: id, action, fromStatus: from, toStatus: to, actor, note: note?.slice(0, 300) } });
    });
  }

  async assign(id: string, actor: string, assignTo: string) {
    const c = await this.load(id);
    if (!['OPEN', 'IN_REVIEW'].includes(c.status)) throw new ApiError(409, 'FRAUD_CASE_NOT_OPEN', `The case is ${c.status}`);
    if (c.status === 'OPEN') await this.setStatus(id, 'OPEN', 'IN_REVIEW', 'ASSIGNED', actor, `assigned to ${assignTo}`, { assignedTo: assignTo });
    else { await this.prisma.fraudCase.update({ where: { id }, data: { assignedTo: assignTo } }); await this.prisma.fraudDecisionLog.create({ data: { caseId: id, action: 'ASSIGNED', fromStatus: 'IN_REVIEW', toStatus: 'IN_REVIEW', actor, note: `assigned to ${assignTo}` } }); }
    return { status: 'IN_REVIEW', assignedTo: assignTo };
  }

  /**
   * CONFIRM or DISMISS. A confirmation that REVERSES REWARD VALUE moves money, so it is a two-person decision (config `twoPersonOnMoney` cannot be switched off): the first call records the
   * request (audited), a DIFFERENT reviewer's call executes it with the requested parameters. A confirmation that only suspends referral, or only records, is one reviewer.
   * A dismissal releases any hold and any suspension the case caused.
   */
  async decide(id: string, actor: string, d: { decision: 'CONFIRM' | 'DISMISS'; note?: string; reverseRewards?: boolean; suspendDays?: number }, cfg: FraudRulesConfig, now = new Date()) {
    const c = await this.load(id);
    if (!['OPEN', 'IN_REVIEW'].includes(c.status)) throw new ApiError(409, 'FRAUD_CASE_NOT_OPEN', `The case is ${c.status}`);
    if (d.decision === 'DISMISS') {
      if (!d.note || d.note.trim().length < 10) throw new ApiError(400, 'REASON_REQUIRED', 'A dismissal needs a reason (at least 10 characters)');
      await this.setStatus(id, c.status as CaseStatus, 'DISMISSED', 'DISMISSED', actor, d.note, { decision: 'DISMISS', decisionNote: d.note.slice(0, 300), decidedBy: actor, decidedAt: now });
      const rels = await this.relsOf(id);
      await this.hold.releaseRewards(rels); await this.hold.reinstateReferral(rels);
      return { status: 'DISMISSED' as const };
    }
    const suspendDays = d.suspendDays ? Math.min(cfg.banMaxDays, Math.max(1, Math.floor(d.suspendDays))) : 0;
    if (d.suspendDays && d.suspendDays > cfg.banMaxDays) throw new ApiError(400, 'SUSPENSION_TOO_LONG', `A suspension is at most ${cfg.banMaxDays} days`);
    let params = { reverse: !!d.reverseRewards, suspendDays, note: d.note };
    let confirmedBy = actor; let requestedBy: string | undefined;
    const open = cfg.twoPersonOnMoney ? await this.prisma.auditLog.findFirst({ where: { action: 'growth.fraud.confirm_requested', resourceId: id, createdAt: { gte: new Date(now.getTime() - DAY) } }, orderBy: { createdAt: 'desc' } }) : null;
    if (open) {
      // a request is waiting: only a DIFFERENT reviewer can execute it, with the parameters that were requested (the second person confirms what the first asked for)
      if (open.actor === actor) throw new ApiError(409, 'CONFIRM_NEEDS_SECOND_PERSON', 'A different reviewer must confirm a decision that reverses reward value');
      const m = (open.metadata ?? {}) as { suspendDays?: number; note?: string };
      params = { reverse: true, suspendDays: Number(m.suspendDays) || 0, note: m.note ?? d.note }; requestedBy = open.actor;
    } else if (params.reverse && cfg.twoPersonOnMoney) {
      await this.prisma.auditLog.create({ data: { actor, action: 'growth.fraud.confirm_requested', resource: 'FraudCase', resourceId: id, metadata: { reverse: true, suspendDays, note: d.note?.slice(0, 300) } } });
      return { status: 'CONFIRM_REQUESTED' as const };
    }
    const rels = await this.relsOf(id);
    let reversed = { reversedMinor: 0, lots: 0 };
    if (params.reverse) reversed = await this.hold.reverseRewards(rels, confirmedBy);
    else await this.hold.releaseRewards(rels, 'FRAUD_CONFIRMED_NO_REVERSAL');
    if (params.suspendDays) await this.hold.suspendReferral(rels);
    await this.setStatus(id, c.status as CaseStatus, 'CONFIRMED', 'CONFIRMED', confirmedBy, `${params.note ?? ''}${requestedBy ? ` (requested by ${requestedBy})` : ''}`.trim(), { decision: encodeDecision({ decision: 'CONFIRM', reverse: params.reverse, suspendDays: params.suspendDays }), decisionNote: params.note?.slice(0, 300), decidedBy: confirmedBy, decidedAt: now });
    if (params.reverse) await this.prisma.auditLog.create({ data: { actor: confirmedBy, action: 'growth.fraud.confirm_executed', resource: 'FraudCase', resourceId: id, metadata: { requestedBy, reversedMinor: reversed.reversedMinor, lots: reversed.lots } } });
    return { status: 'CONFIRMED' as const, reversedMinor: reversed.reversedMinor, suspendedDays: params.suspendDays };
  }

  /** A patient contacts support; support files the appeal inside the window. Reopens the case for a DIFFERENT reviewer. */
  async appeal(id: string, actor: string, note: string, cfg: FraudRulesConfig, now = new Date()) {
    const c = await this.load(id);
    if (c.status !== 'CONFIRMED') throw new ApiError(409, 'FRAUD_CASE_NOT_APPEALABLE', 'Only a confirmed case can be appealed');
    if (c.decidedAt && now.getTime() - c.decidedAt.getTime() > cfg.appealWindowDays * DAY) throw new ApiError(409, 'APPEAL_WINDOW_CLOSED', `Appeals are accepted for ${cfg.appealWindowDays} days after the decision`);
    if (!note || note.trim().length < 10) throw new ApiError(400, 'REASON_REQUIRED', 'Record what the patient said (at least 10 characters)');
    await this.setStatus(id, 'CONFIRMED', 'APPEALED', 'APPEALED', actor, note, { assignedTo: null, slaDueAt: new Date(now.getTime() + cfg.reviewSlaHours * 3_600_000) });
    return { status: 'APPEALED' as const };
  }

  /** The appeal decision: a different person from the one who confirmed. Upheld (DISMISS) re-enables the invite code and, when the case had reversed reward value, opens one goodwill approval request per patient for the value taken back (`restoreAfterUpheldAppeal`); a SECOND approver (never the appeal decider) grants it through the P2-B2 goodwill path. Nothing is credited here. */
  async redecide(id: string, actor: string, d: { decision: 'CONFIRM' | 'DISMISS'; note: string }, now = new Date()) {
    const c = await this.load(id);
    if (c.status !== 'APPEALED') throw new ApiError(409, 'FRAUD_CASE_NOT_APPEALED', 'The case is not under appeal');
    if (c.decidedBy === actor) throw new ApiError(409, 'APPEAL_NEEDS_DIFFERENT_REVIEWER', 'An appeal is decided by a different person');
    if (!d.note || d.note.trim().length < 10) throw new ApiError(400, 'REASON_REQUIRED', 'A decision needs a reason (at least 10 characters)');
    if (d.decision === 'DISMISS') {
      await this.setStatus(id, 'APPEALED', 'DISMISSED', 'DISMISSED', actor, `APPEAL_UPHELD ${d.note}`, { decision: 'DISMISS', decisionNote: d.note.slice(0, 300), decidedBy: actor, decidedAt: now });
      const rels = await this.relsOf(id); await this.hold.reinstateReferral(rels); await this.hold.releaseRewards(rels);
      const restore = await this.restoreAfterUpheldAppeal(id, actor, rels, now);
      return { status: 'DISMISSED' as const, appeal: 'UPHELD' as const, restoreRequests: restore.requests };
    }
    await this.setStatus(id, 'APPEALED', 'CONFIRMED', 'CONFIRMED', actor, `APPEAL_REJECTED ${d.note}`, { decisionNote: d.note.slice(0, 300), decidedBy: actor, decidedAt: now });
    return { status: 'CONFIRMED' as const, appeal: 'REJECTED' as const };
  }

  /**
   * Wave 9: value a confirmed case took back is returned only through a goodwill approval request (kind GOODWILL, reason OTHER_APPROVED, ticket `fraud-appeal:<case>`), one per patient and idempotent
   * per case, for the amount of the REVERSE ledger entries of the case's lots. The appeal decider is the requester, so the existing rule "the requester cannot decide" makes the approver a second
   * person. Whether to credit stays a human decision; with `growth.support_goodwill` OFF the request can still be created but cannot be approved.
   */
  async restoreAfterUpheldAppeal(caseId: string, requestedBy: string, relationshipIds: string[], now = new Date()): Promise<{ requests: number; amountMinor: number }> {
    if (!relationshipIds.length) return { requests: 0, amountMinor: 0 };
    const lots = await this.prisma.rewardLot.findMany({ where: { relationshipId: { in: relationshipIds } }, select: { id: true, sub: true } });
    if (!lots.length) return { requests: 0, amountMinor: 0 };
    const rev = await this.prisma.rewardLedgerEntry.findMany({ where: { lotId: { in: lots.map((l) => l.id) }, type: 'REVERSE', reasonCode: 'FRAUD_CONFIRMED' }, select: { lotId: true, amountMinor: true } });
    const subOf = new Map(lots.map((l) => [l.id, l.sub]));
    const bySub = new Map<string, number>();
    for (const r of rev) { const s = subOf.get(r.lotId); if (s) bySub.set(s, (bySub.get(s) ?? 0) + r.amountMinor); }
    let requests = 0; let total = 0; const ticketRef = `fraud-appeal:${caseId}`;
    for (const [sub, amountMinor] of bySub) {
      if (amountMinor <= 0) continue;
      if (await this.prisma.rewardApprovalRequest.findFirst({ where: { kind: 'GOODWILL', sub, ticketRef }, select: { id: true } })) continue;
      const r = await this.prisma.rewardApprovalRequest.create({ data: { kind: 'GOODWILL', sub, amountMinor, reason: 'OTHER_APPROVED', ticketRef, payload: { source: 'FRAUD_APPEAL_UPHELD', caseId, createdAt: now.toISOString() }, requestedBy } });
      await this.prisma.auditLog.create({ data: { actor: requestedBy, action: 'growth.fraud.restore_requested', resource: 'RewardApprovalRequest', resourceId: r.id, metadata: { caseId, amountMinor } } });
      requests++; total += amountMinor;
    }
    return { requests, amountMinor: total };
  }

  /** Decided cases past the appeal window close (history stays). Ended suspensions reinstate the invite code. */
  async housekeeping(cfg: FraudRulesConfig, now = new Date()) {
    const due = await this.prisma.fraudCase.findMany({ where: { status: { in: ['CONFIRMED', 'DISMISSED'] }, decidedAt: { lt: new Date(now.getTime() - cfg.appealWindowDays * DAY) } }, select: { id: true, status: true } });
    for (const c of due) await this.setStatus(c.id, c.status as CaseStatus, 'CLOSED', 'CLOSED', 'system:fraud', 'appeal window over').catch(() => undefined);
    let reinstated = 0;
    const confirmed = await this.prisma.fraudCase.findMany({ where: { status: { in: ['CONFIRMED', 'CLOSED'] }, decision: { contains: 'suspend=' } }, select: { id: true, decision: true, decidedAt: true } });
    for (const c of confirmed) {
      const p = parseDecision(c.decision);
      if (!p.suspendDays || !c.decidedAt || c.decidedAt.getTime() + p.suspendDays * DAY > now.getTime()) continue;
      if (await this.prisma.auditLog.findFirst({ where: { action: 'growth.fraud.suspension_ended', resourceId: c.id }, select: { id: true } })) continue;
      reinstated += await this.hold.reinstateReferral(await this.relsOf(c.id));
      await this.prisma.auditLog.create({ data: { actor: 'system:fraud', action: 'growth.fraud.suspension_ended', resource: 'FraudCase', resourceId: c.id, metadata: { days: p.suspendDays } } });
    }
    return { closed: due.length, reinstated };
  }
}

export type { FraudCaseKind };
