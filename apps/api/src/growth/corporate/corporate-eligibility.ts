import { emailDomain } from './corporate-code';

/**
 * Who may join a corporate programme (GRW-P4-C). Pure: every fact is passed in, the result names the first failing rule or the way the person was verified.
 * Rules in order: the account is ACTIVE and inside its dates; the code is live; the person is not already in a programme; then ONE verification path must hold
 * (LIST codes need an approved HR list match; OPEN codes need only the code, unless the policy turns open codes off). The e-mail domain path needs a VERIFIED e-mail claim:
 * an unverified address never qualifies, and a free-mail domain is never accepted as an employer domain (the account's own domain list decides, ops enters it).
 */
export interface EligibilityPolicy { openCode: boolean; domainEmail: boolean; hrList: boolean }
export interface EligibilityAccount { status: string; startsAt: Date | null; endsAt: Date | null; emailDomains: readonly string[] }
export interface EligibilityCode { status: string; kind: string; expiresAt: Date | null; redeemedCount: number; maxRedemptions: number }
export interface EligibilityFacts { email?: string; emailVerified?: boolean; hrListMatch: boolean; alreadyMember: boolean }
export type EligibilityReason =
  | 'ACCOUNT_NOT_ACTIVE' | 'CODE_REVOKED' | 'CODE_EXPIRED' | 'CODE_EXHAUSTED' | 'ALREADY_MEMBER' | 'OPEN_CODES_OFF' | 'HR_LIST_OFF' | 'NOT_ON_HR_LIST' | 'EMAIL_NOT_VERIFIED' | 'EMAIL_DOMAIN_MISMATCH' | 'NO_VERIFICATION_PATH';
export type EligibilityDecision = { ok: true; verifiedBy: 'CODE' | 'HR_LIST' | 'DOMAIN_EMAIL' } | { ok: false; reason: EligibilityReason };

/** Domains that can never prove employment, whatever ops types into an account (belt and braces). */
export const FREE_MAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'icloud.com', 'me.com', 'msn.com', 'aol.com', 'proton.me', 'protonmail.com', 'mail.com', 'gmx.com', 'yandex.com']);

export function evaluateEligibility(i: { policy: EligibilityPolicy; account: EligibilityAccount; code: EligibilityCode | null; facts: EligibilityFacts; now: Date }): EligibilityDecision {
  const { policy, account, code, facts, now } = i;
  if (account.status !== 'ACTIVE' || (account.startsAt && account.startsAt > now) || (account.endsAt && account.endsAt <= now)) return { ok: false, reason: 'ACCOUNT_NOT_ACTIVE' };
  if (facts.alreadyMember) return { ok: false, reason: 'ALREADY_MEMBER' };
  if (code) {
    if (code.status !== 'ACTIVE') return { ok: false, reason: 'CODE_REVOKED' };
    if (code.expiresAt && code.expiresAt <= now) return { ok: false, reason: 'CODE_EXPIRED' };
    if (code.redeemedCount >= code.maxRedemptions) return { ok: false, reason: 'CODE_EXHAUSTED' };
    if (code.kind === 'LIST') {
      if (!policy.hrList) return { ok: false, reason: 'HR_LIST_OFF' };
      return facts.hrListMatch ? { ok: true, verifiedBy: 'HR_LIST' } : { ok: false, reason: 'NOT_ON_HR_LIST' };
    }
    if (!policy.openCode) return { ok: false, reason: 'OPEN_CODES_OFF' };
    return { ok: true, verifiedBy: 'CODE' };
  }
  // no code: the domain path only
  if (!policy.domainEmail) return { ok: false, reason: 'NO_VERIFICATION_PATH' };
  if (!facts.email || facts.emailVerified !== true) return { ok: false, reason: 'EMAIL_NOT_VERIFIED' };
  const d = emailDomain(facts.email);
  const allowed = account.emailDomains.map((x) => x.trim().toLowerCase()).filter((x) => x && !FREE_MAIL_DOMAINS.has(x));
  return d && allowed.includes(d) ? { ok: true, verifiedBy: 'DOMAIN_EMAIL' } : { ok: false, reason: 'EMAIL_DOMAIN_MISMATCH' };
}
