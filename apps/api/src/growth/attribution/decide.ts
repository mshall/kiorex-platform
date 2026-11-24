import { computeAttributionInputsHash, type AcquisitionOrigin, type AttributionReasonCode } from '@kiorex/contracts';

/**
 * Deterministic attribution decision (GRW-P1-B, ARCH section 6.4). PURE: no I/O, no clock, no randomness, no environment.
 * The same inputs always give the same output; the service stores the inputs (booking snapshot + touch ids + policy version) so a
 * replay reproduces the stored decision byte for byte (see decide.unit.spec.ts and attribution.int.spec.ts replay tests).
 *
 * It can only REMOVE a fee (PROVIDER_LED), never add one: MARKETPLACE and UNATTRIBUTED are both what the Clinic already charges today.
 */

/** Source kinds the touch endpoint records (mirrors GrowthAcquisitionSource.sourceKind). */
export const PROVIDER_OWNED_KINDS = ['PROVIDER_LINK', 'PROVIDER_QR', 'WIDGET'] as const;
const DAY_MS = 86_400_000;

export interface DecisionTouch {
  id: string;
  /** GrowthTouchpoint.kind (the source kind at touch time). */
  kind: string;
  providerOrgRef?: string | null;
  /** ISO timestamp. */
  occurredAt: string;
  dwellMs?: number | null;
}

export interface DecisionBooking {
  id: string;
  orgId: string;
  clinicId?: string;
  doctorId?: string;
  /** ISO timestamp the booking intent was created; only touches strictly before it count. */
  createdAt: string;
  /** BookingIntent.channel; CLINIC_LINK is the explicit provider channel. */
  channel: string;
  /** A signed in-session link token for THIS organisation was presented and verified (the service verifies; the function only reads the fact). */
  ltValidForOrg?: boolean;
}

export interface DecisionPolicy {
  /** GrowthConfigVersion.id the policy was resolved from. */
  versionId: string;
  providerTouchWindowDays: number;
  patientReferralWindowDays: number;
  campaignClickWindowDays: number;
  minDwellMsForProviderTouch: number;
  precedence: 'PROVIDER_FIRST' | 'LAST_NON_DIRECT' | 'FIRST_TOUCH';
  allowOfflineEvidence: boolean;
}

export interface Decision {
  origin: AcquisitionOrigin;
  reasonCode: AttributionReasonCode;
  /** The touch that decided the origin (provider, referral or marketplace evidence); null for channel-only or no-evidence decisions. */
  winningTouchId: string | null;
  /** Every touch the function considered (before the booking, inside the widest window), ordered by (occurredAt, id). */
  consideredTouchIds: string[];
  /** Reporting pointers (never used for commission). */
  firstTouchId: string | null;
  lastTouchId: string | null;
  lastNonDirectTouchId: string | null;
  inputsHash: string;
  precedence: DecisionPolicy['precedence'];
}

export class FirstTouchNotForCommissionError extends Error {
  constructor() { super('FIRST_TOUCH precedence is reporting only and cannot decide a commission origin'); this.name = 'FirstTouchNotForCommissionError'; }
}

type Cls = 'PROVIDER' | 'REFERRAL' | 'CAMPAIGN' | 'MARKETPLACE' | 'DIRECT' | 'IGNORED';

const ms = (iso: string) => Date.parse(iso);
const cmp = (a: DecisionTouch, b: DecisionTouch) => { const d = ms(a.occurredAt) - ms(b.occurredAt); return d !== 0 ? d : a.id < b.id ? -1 : a.id > b.id ? 1 : 0; };
/** Greatest occurredAt, ties broken by the smallest id (stable). */
const latest = (ts: DecisionTouch[]): DecisionTouch | null => ts.reduce<DecisionTouch | null>((best, t) => {
  if (!best) return t;
  const d = ms(t.occurredAt) - ms(best.occurredAt);
  return d > 0 || (d === 0 && t.id < best.id) ? t : best;
}, null);

function classify(t: DecisionTouch, b: DecisionBooking, p: DecisionPolicy): Cls {
  if ((PROVIDER_OWNED_KINDS as readonly string[]).includes(t.kind)) return t.providerOrgRef && t.providerOrgRef === b.orgId ? 'PROVIDER' : 'IGNORED'; // another organisation's touch is never evidence for this one
  if (t.kind === 'OFFLINE') return p.allowOfflineEvidence && t.providerOrgRef === b.orgId ? 'PROVIDER' : 'IGNORED';
  if (t.kind === 'REFERRAL') return 'REFERRAL';
  if (t.kind === 'CAMPAIGN') return 'CAMPAIGN';
  if (t.kind === 'DIRECT') return 'DIRECT';
  return 'MARKETPLACE'; // ORGANIC_SEARCH, WHATSAPP and any later marketplace-owned kind
}

const windowMs = (c: Cls, p: DecisionPolicy): number => {
  switch (c) {
    case 'REFERRAL': return p.patientReferralWindowDays * DAY_MS;
    case 'CAMPAIGN': return p.campaignClickWindowDays * DAY_MS;
    default: return p.providerTouchWindowDays * DAY_MS; // provider, organic, direct (assumption: reporting-only reasons share the provider window)
  }
};

/** The widest window any class can use: touches older than this can never matter, so the service need not load them. */
export const maxWindowMs = (p: DecisionPolicy): number => Math.max(p.providerTouchWindowDays, p.patientReferralWindowDays, p.campaignClickWindowDays) * DAY_MS;

export function decide(booking: DecisionBooking, touches: readonly DecisionTouch[], policy: DecisionPolicy): Decision {
  if (policy.precedence === 'FIRST_TOUCH') throw new FirstTouchNotForCommissionError();
  const at = ms(booking.createdAt);
  if (!Number.isFinite(at)) throw new TypeError('booking.createdAt must be an ISO timestamp');
  const seen = new Set<string>();
  const considered = touches
    .filter((t) => Number.isFinite(ms(t.occurredAt)) && ms(t.occurredAt) < at && at - ms(t.occurredAt) <= maxWindowMs(policy) && !seen.has(t.id) && !!seen.add(t.id))
    .sort(cmp);
  const inWindow = (t: DecisionTouch) => at - ms(t.occurredAt) <= windowMs(classify(t, booking, policy), policy);
  const rendered = (t: DecisionTouch) => t.kind === 'OFFLINE' || (typeof t.dwellMs === 'number' && t.dwellMs >= policy.minDwellMsForProviderTouch); // a bare redirect or prefetch is not a touch
  const eligible = considered.filter((t) => { const c = classify(t, booking, policy); return c !== 'IGNORED' && inWindow(t) && (c !== 'PROVIDER' || rendered(t)); });
  const byCls = (c: Cls) => eligible.filter((t) => classify(t, booking, policy) === c);

  const nonDirect = eligible.filter((t) => classify(t, booking, policy) !== 'DIRECT');
  const pointers = { firstTouchId: eligible[0]?.id ?? null, lastTouchId: eligible[eligible.length - 1]?.id ?? null, lastNonDirectTouchId: latest(nonDirect)?.id ?? null };
  const providerTouch = latest(byCls('PROVIDER'));
  const hasLt = booking.ltValidForOrg === true;

  const inputsHash = computeAttributionInputsHash({
    booking: { id: booking.id, orgId: booking.orgId, ...(booking.clinicId ? { clinicId: booking.clinicId } : {}), ...(booking.doctorId ? { doctorId: booking.doctorId } : {}), createdAt: booking.createdAt, channel: booking.channel, hasValidLt: hasLt },
    touches: considered.map((t) => ({ id: t.id, occurredAt: t.occurredAt })),
    policyVersion: policy.versionId,
    precedence: policy.precedence,
  });
  const done = (origin: AcquisitionOrigin, reasonCode: AttributionReasonCode, winning: DecisionTouch | null): Decision => ({
    origin, reasonCode, winningTouchId: winning?.id ?? null, consideredTouchIds: considered.map((t) => t.id), ...pointers, inputsHash, precedence: policy.precedence,
  });

  // 1. explicit provider channel (today's CLINIC_LINK rule is this special case) or a verified in-session link token for the same organisation
  if (booking.channel === 'CLINIC_LINK' || hasLt) return done('PROVIDER_LED', 'EXPLICIT_PROVIDER_CHANNEL', providerTouch);
  // 2. prior provider touch for the same organisation, inside its window, actually rendered
  if (providerTouch) {
    if (policy.precedence === 'PROVIDER_FIRST') return done('PROVIDER_LED', 'PRIOR_PROVIDER_TOUCH', providerTouch);
    const lastNd = latest(nonDirect);
    if (lastNd && classify(lastNd, booking, policy) === 'PROVIDER') return done('PROVIDER_LED', 'PRIOR_PROVIDER_TOUCH', lastNd); // LAST_NON_DIRECT
  }
  // 3. patient referral inside its window: Kiorex-acquired
  const referral = latest(byCls('REFERRAL'));
  if (referral) return done('MARKETPLACE', 'PATIENT_REFERRAL', referral);
  // 4. any marketplace touch (search, SEO, campaign, direct, WhatsApp)
  const marketplace = latest(eligible.filter((t) => classify(t, booking, policy) !== 'PROVIDER'));
  if (marketplace) return done('MARKETPLACE', 'MARKETPLACE_TOUCH', marketplace);
  // 5. nothing: still chargeable like today (the booking came through Kiorex with no provider evidence)
  return done('UNATTRIBUTED', 'NO_PROVIDER_EVIDENCE', null);
}
