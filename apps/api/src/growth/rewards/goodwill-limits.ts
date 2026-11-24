import type { RewardRules } from './reward-rules';

export const GOODWILL_REASONS = ['PROVIDER_LATE_CANCEL', 'LONG_WAIT', 'FAILED_BOOKING', 'PAYMENT_ISSUE', 'OTHER_APPROVED'] as const;
export type GoodwillReason = (typeof GOODWILL_REASONS)[number];

export interface GoodwillFacts { actorGrantedTodayMinor: number; patientGranted90dMinor: number; actorIsTarget: boolean }
export interface GoodwillRequest { reason: string; amountMinor: number; bookingId?: string | null; ticketRef?: string | null }
export type GoodwillVerdict = { ok: true; needsSecondApprover: boolean } | { ok: false; code: 'REASON_NOT_ALLOWED' | 'REFERENCE_REQUIRED' | 'AMOUNT_INVALID' | 'REASON_MAX_EXCEEDED' | 'AGENT_DAILY_CAP' | 'PATIENT_90D_CAP' | 'SELF_GRANT' };

/**
 * Goodwill limits (GRW-P2-B2), pure. Order: closed reason list, mandatory booking or ticket reference, amount, per-reason maximum, per-agent daily cap, per-patient 90-day cap, no grant to the
 * agent's own or a related account. Above `approvalAboveMinor` a second support lead or super admin must approve (maker-checker); the database also refuses approvedBy = grantedBy.
 */
export function checkGoodwill(rules: RewardRules['credit']['goodwill'], r: GoodwillRequest, f: GoodwillFacts): GoodwillVerdict {
  if (f.actorIsTarget) return { ok: false, code: 'SELF_GRANT' };
  if (!(GOODWILL_REASONS as readonly string[]).includes(r.reason) || !rules.reasons.includes(r.reason)) return { ok: false, code: 'REASON_NOT_ALLOWED' };
  if (!r.bookingId && !r.ticketRef) return { ok: false, code: 'REFERENCE_REQUIRED' };
  if (!Number.isInteger(r.amountMinor) || r.amountMinor <= 0) return { ok: false, code: 'AMOUNT_INVALID' };
  if (r.amountMinor > rules.perReasonMaxMinor) return { ok: false, code: 'REASON_MAX_EXCEEDED' };
  if (f.actorGrantedTodayMinor + r.amountMinor > rules.perAgentDailyCapMinor) return { ok: false, code: 'AGENT_DAILY_CAP' };
  if (f.patientGranted90dMinor + r.amountMinor > rules.perPatient90dCapMinor) return { ok: false, code: 'PATIENT_90D_CAP' };
  return { ok: true, needsSecondApprover: r.amountMinor > rules.approvalAboveMinor };
}
