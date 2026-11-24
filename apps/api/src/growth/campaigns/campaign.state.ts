import { CAMPAIGN_PAUSE_REASONS, CAMPAIGN_STATES, CAMPAIGN_TRANSITIONS, canTransitionCampaign, type CampaignState } from '@kiorex/contracts';

/**
 * Campaign state machine (GRW-P2-A). PURE: every rule of a transition is a function of the two states and a context the service gathers, so the whole table is tested
 * without a database. The legal graph itself is the contract's `CAMPAIGN_TRANSITIONS` (kiorex-contracts 1.12.0); this file adds the guards:
 *
 *   DRAFT -> PENDING_APPROVAL -> SCHEDULED -> ACTIVE <-> PAUSED -> COMPLETED -> ARCHIVED
 *   DRAFT -> SCHEDULED          only when no approval is needed (below the threshold, no sensitive channel, growth.campaign_approval_required OFF)
 *   PENDING_APPROVAL -> DRAFT   rejected or withdrawn (reason mandatory)
 *   ACTIVE -> PAUSED            BUDGET | MANUAL | GUARDRAIL; a PAUSED(BUDGET) campaign needs a BUDGET_INCREASE approval before it can run again
 *   COMPLETED is terminal except ARCHIVED
 */
export type CampaignStatus = CampaignState;
export const CAMPAIGN_STATUSES = CAMPAIGN_STATES;
export type PauseReason = (typeof CAMPAIGN_PAUSE_REASONS)[number];
export const isStatus = (v: unknown): v is CampaignStatus => (CAMPAIGN_STATES as readonly unknown[]).includes(v);

export type TransitionErrorCode = 'CAMPAIGN_INVALID_TRANSITION' | 'CAMPAIGN_APPROVAL_REQUIRED' | 'CAMPAIGN_BUDGET_EXHAUSTED' | 'CAMPAIGN_INVALID';
export type TransitionVerdict = { ok: true } | { ok: false; code: TransitionErrorCode; message: string };

export interface TransitionContext {
  now: Date;
  startsAt: Date | null;
  endsAt: Date | null;
  /** An approval is required to activate this campaign (threshold, sensitive channel or the flag). */
  approvalRequired: boolean;
  /** An APPROVED approval exists whose payload hash equals the campaign's current money-relevant payload. */
  approvalCurrent: boolean;
  pauseReason: PauseReason | null;
  /** Approved spend has reached the total budget. */
  budgetExhausted: boolean;
  /** Daily cap pause still in force (market day has not rolled). */
  dailyPauseActive: boolean;
  /** A reason code was supplied (mandatory for rejects and, per policy, manual pauses). */
  hasReason: boolean;
  actorKind: 'USER' | 'SYSTEM';
  requireReasonOnPause: boolean;
}

const deny = (code: TransitionErrorCode, message: string): TransitionVerdict => ({ ok: false, code, message });

export function evaluateTransition(from: CampaignStatus, to: CampaignStatus, c: TransitionContext): TransitionVerdict {
  if (!canTransitionCampaign(from, to)) return deny('CAMPAIGN_INVALID_TRANSITION', `A ${from} campaign cannot become ${to}`);
  switch (`${from}>${to}`) {
    case 'DRAFT>PENDING_APPROVAL':
      if (!c.startsAt || !c.endsAt) return deny('CAMPAIGN_INVALID', 'Set the start and end dates before asking for approval');
      return { ok: true };
    case 'DRAFT>SCHEDULED':
      if (!c.startsAt || !c.endsAt) return deny('CAMPAIGN_INVALID', 'Set the start and end dates before scheduling');
      if (c.approvalRequired) return deny('CAMPAIGN_APPROVAL_REQUIRED', 'This campaign needs a second approver: request approval first');
      return { ok: true };
    case 'PENDING_APPROVAL>SCHEDULED':
      return c.approvalCurrent ? { ok: true } : deny('CAMPAIGN_APPROVAL_REQUIRED', 'No current approval covers this campaign as it is now');
    case 'PENDING_APPROVAL>DRAFT':
    case 'SCHEDULED>DRAFT':
      return c.hasReason ? { ok: true } : deny('CAMPAIGN_INVALID', 'A reason is required');
    case 'SCHEDULED>ACTIVE':
      if (!c.startsAt || c.now.getTime() < c.startsAt.getTime()) return deny('CAMPAIGN_INVALID_TRANSITION', 'The campaign has not reached its start time');
      if (c.endsAt && c.now.getTime() >= c.endsAt.getTime()) return deny('CAMPAIGN_INVALID_TRANSITION', 'The campaign window already ended');
      if (c.approvalRequired && !c.approvalCurrent) return deny('CAMPAIGN_APPROVAL_REQUIRED', 'The approval no longer covers the campaign (it was edited after approval)');
      return { ok: true };
    case 'ACTIVE>PAUSED':
      return c.actorKind === 'USER' && c.requireReasonOnPause && !c.hasReason ? deny('CAMPAIGN_INVALID', 'A reason is required to pause a campaign') : { ok: true };
    case 'PAUSED>ACTIVE':
      if (c.budgetExhausted || c.pauseReason === 'BUDGET') return deny('CAMPAIGN_BUDGET_EXHAUSTED', 'The budget is used up: a budget increase approved by a second person is needed');
      if (c.dailyPauseActive) return deny('CAMPAIGN_INVALID_TRANSITION', 'The daily cap pause holds until the next market day');
      if (c.endsAt && c.now.getTime() >= c.endsAt.getTime()) return deny('CAMPAIGN_INVALID_TRANSITION', 'The campaign window already ended');
      if (c.approvalRequired && !c.approvalCurrent) return deny('CAMPAIGN_APPROVAL_REQUIRED', 'A reactivation approval is needed: the campaign changed after it was approved');
      return { ok: true };
    default:
      return { ok: true };
  }
}

/** Every pair, for the exhaustive table test and the UI (which buttons to offer). */
export const allPairs = (): Array<[CampaignStatus, CampaignStatus]> => CAMPAIGN_STATES.flatMap((a) => CAMPAIGN_STATES.map((b) => [a, b] as [CampaignStatus, CampaignStatus]));
export const nextStates = (from: CampaignStatus): readonly CampaignStatus[] => CAMPAIGN_TRANSITIONS[from];
export const isTerminal = (s: CampaignStatus) => CAMPAIGN_TRANSITIONS[s].length === 0;
/** States whose campaigns can still receive spend or serve touches: only ACTIVE serves; PAUSED and COMPLETED may still receive late spend lines. */
export const ACCEPTS_SPEND: readonly CampaignStatus[] = ['ACTIVE', 'PAUSED', 'COMPLETED', 'SCHEDULED'];
export const COUNTS_AGAINST_CEILING: readonly CampaignStatus[] = ['ACTIVE', 'SCHEDULED'];
