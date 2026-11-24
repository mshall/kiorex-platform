import type { GateChannel, MessageClass } from './send-gate';
import type { LifecycleStage } from './lifecycle.stage';
import type { SegmentRule } from './lifecycle-segments';

/** Template kinds the journeys send (declared in engagement/templates.growth.ts). */
export type LifecycleKind =
  | 'WELCOME' | 'BOOKING_RECOVERY' | 'FEEDBACK_REMINDER' | 'REENGAGE_DORMANT' | 'REFERRAL_NUDGE' | 'REWARD_ISSUED' | 'REWARD_REDEEMED' | 'REWARD_REVERSED' | 'REWARD_EXPIRING' | 'FAMILY_ONBOARDING' | 'FAMILY_ONBOARDING_CARD' | 'REFERRAL_INVITE_CARD' | 'NEW_DEVICE_NOTICE'
  | 'DEPOSIT_PENDING_FOLLOWUP';

export type JourneyTrigger = 'REGISTERED' | 'HOLD_EXPIRED' | 'RESERVATION_PENDING_DEPOSIT' | 'VISIT_COMPLETED' | 'STAGE_DORMANT' | 'FIRST_ATTENDED' | 'REWARD_EVENT'
  /** GRW-P3-E: a journey compiled from a published builder graph (the event is in `custom.trigger`). */
  | 'AUTOMATION';

/** Facts a stop condition may look at. Non-clinical only. */
export interface StopFacts {
  /** The person started or confirmed any booking after the anchor time. */
  bookedAfterAnchor: boolean;
  /** Left a review for the anchored visit. */
  reviewedAnchor: boolean;
  stage: LifecycleStage | null;
  marketingAnyConsent: boolean;
  /** The reward in the anchor is no longer active (used, reversed or expired). */
  rewardClosed: boolean;
  dependantAdded: boolean;
  accountDeleted: boolean;
  /** The booking behind a deposit reminder is no longer waiting for the deposit. */
  depositSettled: boolean;
  /** The person is no longer DORMANT (re-engagement stops). */
  leftDormant: boolean;
}

export interface JourneyStep {
  step: number;
  /** Delay after the anchor (first step) or after the previous step. */
  delayMinutes: number;
  messageClass: MessageClass;
  /** Channel preference order; the first channel that passes the gate wins (INAPP card never needs a consent). */
  channels: GateChannel[];
  kind: LifecycleKind;
  /** Which consent purpose the channel send needs (TRANSACTIONAL status messages vs REMINDERS). */
  purpose: 'TRANSACTIONAL' | 'REMINDER' | 'MARKETING' | 'SECURITY' | 'CLINICAL';
  stopOn: ReadonlyArray<keyof StopFacts | 'MARKETING_CONSENT_LOST'>;
  /** Step applies only when this holds for the anchor parameters (e.g. the welcome message only when registration asked for a confirmation). */
  when?: (anchor: Record<string, unknown>) => boolean;
  /** GRW-P3-E (compiled journeys only): every segment must hold for the person at send time, else the journey ends (CONDITION_FALSE). Non-clinical attributes only. */
  segments?: readonly SegmentRule[];
  /** GRW-P3-E: the step belongs to these experiment arms; a person who is not in them (or whose experiment stopped: control) skips it. */
  branch?: ReadonlyArray<{ experiment: string; variant: string }>;
  /** GRW-P3-E: the consent-and-gate node the compiler inserted in front of a MARKETING send. Informational for the dry run; the enforcement is the send gate every step passes. */
  gate?: { inserted: true; checks: readonly string[] };
}

/** Metadata of a journey compiled from a published builder definition (GRW-P3-E). */
export interface CustomJourneyMeta { definitionId: string; market: string; definitionKey: string; checksum: string; trigger: string; maxSends: number }

export interface JourneyDef {
  key: string;
  version: number;
  trigger: JourneyTrigger;
  /** One enrolment per anchor (booking, reward) or one per person. */
  anchored: boolean;
  steps: readonly JourneyStep[];
  /** Parameters PROPOSED_DEFAULT, overridable by LIFECYCLE_POLICY where the schema carries them. */
  params: Readonly<Record<string, number>>;
  /** Human description for the ops console (non-clinical). */
  describe: { en: string; ar: string };
  /** Present only on a journey compiled from the builder. */
  custom?: CustomJourneyMeta;
}

/** Policy overrides read from LIFECYCLE_POLICY (`journeys.<key>.enabled`, `maxSteps`). */
export interface JourneyPolicy { enabled: boolean; messageClass: MessageClass; maxSteps?: number }
