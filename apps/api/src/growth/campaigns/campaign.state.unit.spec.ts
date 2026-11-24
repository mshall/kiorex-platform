import { CAMPAIGN_TRANSITIONS } from '@kiorex/contracts';
import { allPairs, evaluateTransition, isTerminal, nextStates, type CampaignStatus, type TransitionContext } from './campaign.state';

const NOW = new Date('2027-01-10T10:00:00Z');
const ctx = (o: Partial<TransitionContext> = {}): TransitionContext => ({ now: NOW, startsAt: new Date('2027-01-09T00:00:00Z'), endsAt: new Date('2027-02-09T00:00:00Z'), approvalRequired: false, approvalCurrent: false, pauseReason: null, budgetExhausted: false, dailyPauseActive: false, hasReason: true, actorKind: 'USER', requireReasonOnPause: true, ...o });

describe('campaign state machine (GRW-P2-A)', () => {
  it('the legal graph is the contract table: exactly 13 of the 49 pairs are legal and every other pair is CAMPAIGN_INVALID_TRANSITION whatever the context', () => {
    let legal = 0;
    for (const [a, b] of allPairs()) {
      const v = evaluateTransition(a, b, ctx({ approvalCurrent: true }));
      if ((CAMPAIGN_TRANSITIONS[a] as readonly string[]).includes(b)) { legal++; expect(v.ok || v.code !== 'CAMPAIGN_INVALID_TRANSITION' || ['SCHEDULED>ACTIVE', 'PAUSED>ACTIVE'].includes(`${a}>${b}`)).toBe(true); }
      else expect(v).toMatchObject({ ok: false, code: 'CAMPAIGN_INVALID_TRANSITION' });
    }
    expect(legal).toBe(13);
  });
  it('COMPLETED is terminal except ARCHIVED; ARCHIVED has no way out; nothing returns to DRAFT from ACTIVE, PAUSED or COMPLETED', () => {
    expect(nextStates('COMPLETED')).toEqual(['ARCHIVED']); expect(isTerminal('ARCHIVED')).toBe(true);
    for (const s of ['ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED'] as CampaignStatus[]) expect(evaluateTransition(s, 'DRAFT', ctx())).toMatchObject({ ok: false, code: 'CAMPAIGN_INVALID_TRANSITION' });
  });
  it('DRAFT to SCHEDULED needs dates and no approval requirement; otherwise the campaign must go through PENDING_APPROVAL', () => {
    expect(evaluateTransition('DRAFT', 'SCHEDULED', ctx())).toEqual({ ok: true });
    expect(evaluateTransition('DRAFT', 'SCHEDULED', ctx({ approvalRequired: true }))).toMatchObject({ ok: false, code: 'CAMPAIGN_APPROVAL_REQUIRED' });
    expect(evaluateTransition('DRAFT', 'SCHEDULED', ctx({ startsAt: null }))).toMatchObject({ ok: false, code: 'CAMPAIGN_INVALID' });
    expect(evaluateTransition('DRAFT', 'PENDING_APPROVAL', ctx({ endsAt: null }))).toMatchObject({ ok: false, code: 'CAMPAIGN_INVALID' });
    expect(evaluateTransition('DRAFT', 'PENDING_APPROVAL', ctx())).toEqual({ ok: true });
  });
  it('PENDING_APPROVAL to SCHEDULED needs a current approval; back to DRAFT needs a reason', () => {
    expect(evaluateTransition('PENDING_APPROVAL', 'SCHEDULED', ctx({ approvalCurrent: false }))).toMatchObject({ ok: false, code: 'CAMPAIGN_APPROVAL_REQUIRED' });
    expect(evaluateTransition('PENDING_APPROVAL', 'SCHEDULED', ctx({ approvalCurrent: true }))).toEqual({ ok: true });
    expect(evaluateTransition('PENDING_APPROVAL', 'DRAFT', ctx({ hasReason: false }))).toMatchObject({ ok: false, code: 'CAMPAIGN_INVALID' });
    expect(evaluateTransition('PENDING_APPROVAL', 'DRAFT', ctx())).toEqual({ ok: true });
  });
  it('SCHEDULED becomes ACTIVE only at or after startsAt and before endsAt, and only while an approval still covers an approval-required campaign', () => {
    expect(evaluateTransition('SCHEDULED', 'ACTIVE', ctx())).toEqual({ ok: true });
    expect(evaluateTransition('SCHEDULED', 'ACTIVE', ctx({ startsAt: new Date('2027-01-11T00:00:00Z') }))).toMatchObject({ ok: false, code: 'CAMPAIGN_INVALID_TRANSITION' });
    expect(evaluateTransition('SCHEDULED', 'ACTIVE', ctx({ endsAt: new Date('2027-01-10T09:00:00Z') }))).toMatchObject({ ok: false });
    expect(evaluateTransition('SCHEDULED', 'ACTIVE', ctx({ approvalRequired: true, approvalCurrent: false }))).toMatchObject({ ok: false, code: 'CAMPAIGN_APPROVAL_REQUIRED' });
    expect(evaluateTransition('SCHEDULED', 'ACTIVE', ctx({ approvalRequired: true, approvalCurrent: true }))).toEqual({ ok: true });
  });
  it('ACTIVE to PAUSED needs a reason from a person (the system never needs one)', () => {
    expect(evaluateTransition('ACTIVE', 'PAUSED', ctx({ hasReason: false }))).toMatchObject({ ok: false, code: 'CAMPAIGN_INVALID' });
    expect(evaluateTransition('ACTIVE', 'PAUSED', ctx({ hasReason: false, actorKind: 'SYSTEM' }))).toEqual({ ok: true });
    expect(evaluateTransition('ACTIVE', 'PAUSED', ctx({ hasReason: false, requireReasonOnPause: false }))).toEqual({ ok: true });
  });
  it('PAUSED to ACTIVE: a budget pause needs a budget increase; a daily pause holds until the day rolls; a campaign edited after approval needs a reactivation approval', () => {
    expect(evaluateTransition('PAUSED', 'ACTIVE', ctx({ pauseReason: 'BUDGET' }))).toMatchObject({ ok: false, code: 'CAMPAIGN_BUDGET_EXHAUSTED' });
    expect(evaluateTransition('PAUSED', 'ACTIVE', ctx({ pauseReason: 'MANUAL', budgetExhausted: true }))).toMatchObject({ ok: false, code: 'CAMPAIGN_BUDGET_EXHAUSTED' });
    expect(evaluateTransition('PAUSED', 'ACTIVE', ctx({ pauseReason: 'GUARDRAIL', dailyPauseActive: true }))).toMatchObject({ ok: false, code: 'CAMPAIGN_INVALID_TRANSITION' });
    expect(evaluateTransition('PAUSED', 'ACTIVE', ctx({ pauseReason: 'MANUAL', approvalRequired: true, approvalCurrent: false }))).toMatchObject({ ok: false, code: 'CAMPAIGN_APPROVAL_REQUIRED' });
    expect(evaluateTransition('PAUSED', 'ACTIVE', ctx({ pauseReason: 'MANUAL' }))).toEqual({ ok: true });
    expect(evaluateTransition('PAUSED', 'ACTIVE', ctx({ pauseReason: 'MANUAL', endsAt: new Date('2027-01-10T09:00:00Z') }))).toMatchObject({ ok: false });
  });
  it('completion and archiving are always allowed from the states that reach them', () => {
    for (const [a, b] of [['ACTIVE', 'COMPLETED'], ['PAUSED', 'COMPLETED'], ['COMPLETED', 'ARCHIVED'], ['DRAFT', 'ARCHIVED'], ['SCHEDULED', 'ARCHIVED']] as Array<[CampaignStatus, CampaignStatus]>) expect(evaluateTransition(a, b, ctx())).toEqual({ ok: true });
    expect(evaluateTransition('SCHEDULED', 'DRAFT', ctx({ hasReason: false }))).toMatchObject({ ok: false });
  });
});
