/**
 * Pure rules of the DRAFT onboarding request that a won join request creates (founder decision 28 Nov 2026). No I/O here: unit tested.
 * A draft is a work item for the Kiorex / Kiorly team. It never creates an organisation, an enrolment code or a Passport identity; approval only records that two people agreed.
 */
import type { LeadStatus } from './lead-config';

export const ONBOARDING_KINDS = ['CLINIC', 'NURSE', 'PHARMACY', 'LAB'] as const;
export type OnboardingKind = (typeof ONBOARDING_KINDS)[number];
export const ONBOARDING_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

/** Which product enrolment kind a provider type corresponds to (same mapping as the ops console "Start onboarding" helper); null when no product fits. */
export function kindForProviderType(providerType: string): OnboardingKind | null {
  switch (providerType) {
    case 'CLINIC': case 'INDEPENDENT_DOCTOR': case 'CHAIN': case 'HOSPITAL': case 'PHYSICIAN': return 'CLINIC';
    case 'NURSE': return 'NURSE';
    case 'LAB': return 'LAB';
    case 'PHARMACY': return 'PHARMACY';
    default: return null;
  }
}

/** Lead statuses on which the draft is created. WON by founder decision; ONBOARDING can be added with LEAD_ONBOARDING_DRAFT_ON=WON,ONBOARDING (default WON). LOST is never allowed. */
export function draftStatuses(env: string | undefined = process.env.LEAD_ONBOARDING_DRAFT_ON): readonly LeadStatus[] {
  const asked = (env ?? '').split(',').map((s) => s.trim().toUpperCase()).filter((s) => s === 'WON' || s === 'ONBOARDING');
  return asked.length ? ([...new Set(asked)] as LeadStatus[]) : ['WON'];
}

/** The fields copied from the join request. Contact name, phone, e-mail, licences and the applicant note are NOT copied: the reference is the only link. */
export function draftFromLead(l: { id: string; ref: string; legalName: string; providerType: string; mode: string; modules: string[]; market: string; ownerSub: string | null; ownerName: string | null; isTest: boolean }) {
  return {
    leadId: l.id, kind: kindForProviderType(l.providerType), legalName: l.legalName, providerType: l.providerType, mode: l.mode, modules: [...l.modules], market: l.market,
    contactRef: l.ref, assigneeSub: l.ownerSub, assigneeName: l.ownerName, isTest: l.isTest,
  };
}

/** Allowed moves of the draft workflow (who may do them is enforced by the controller: submit/cancel/reopen = ops_admin or super_admin, approve/reject = super_admin only, and never the submitter). */
export const ONBOARDING_TRANSITIONS: Record<OnboardingStatus, readonly OnboardingStatus[]> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: [],
  REJECTED: ['DRAFT'],
  CANCELLED: ['DRAFT'],
};
export const canMove = (from: string, to: OnboardingStatus): boolean => (ONBOARDING_TRANSITIONS[from as OnboardingStatus] ?? []).includes(to);

/** A reviewer may submit only a draft whose product kind is chosen and whose join request is still active (won or in onboarding), never a lost one. */
export function submitBlockers(d: { kind: string | null }, leadStatus: string): string[] {
  const out: string[] = [];
  if (!d.kind) out.push('KIND_REQUIRED');
  if (leadStatus !== 'WON' && leadStatus !== 'ONBOARDING') out.push('LEAD_NOT_ACTIVE');
  return out;
}
