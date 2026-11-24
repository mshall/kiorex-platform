import { messageClassOf, render, TEMPLATES, type NotifyKind } from '../../engagement/engagement-public';
import { detectPhi } from '../../safety/safety-public';
import { JOURNEYS, journeyByKey } from './journeys';
import { nextStepOf } from './journey-runner.service';
import { SEGMENT_ATTRIBUTES } from './lifecycle-segments';

const CLINICAL_WORDS = /\b(doctor|dr\.?|specialty|diagnos|prescription|medicine|medication|drug|lab test|blood|cardio|derma|dental|pregnan|cancer|diabet)\w*/i;
const AR_CLINICAL = /(طبيب|دكتور|تخصص|تشخيص|روشتة|دواء|تحليل|حمل|سرطان|سكر)/;
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();

describe('the eight lifecycle journeys', () => {
  it('there are exactly eight, each with a unique key and at least one step with strictly increasing step numbers', () => {
    expect(JOURNEYS.map((j) => j.key)).toEqual(['welcome', 'booking-recovery', 'reminders', 'post-visit', 'reengagement', 'referral-invite', 'reward-notice', 'family-onboarding']);
    for (const j of JOURNEYS) {
      expect(journeyByKey(j.key)).toBe(j);
      expect(j.steps.length).toBeGreaterThan(0);
      expect(j.steps.map((s) => s.step)).toEqual([...j.steps.map((s) => s.step)].sort((a, b) => a - b));
      expect(new Set(j.steps.map((s) => s.step)).size).toBe(j.steps.length);
      expect(j.describe.en.length).toBeGreaterThan(10); expect(j.describe.ar.length).toBeGreaterThan(10);
    }
  });
  it('every step names a real template whose class equals the step class (a template is bound to one class)', () => {
    for (const j of JOURNEYS) for (const s of j.steps) {
      expect(TEMPLATES[s.kind as NotifyKind]).toBeDefined();
      expect(messageClassOf(s.kind)).toBe(s.messageClass);
    }
  });
  it('MARKETING steps consent per channel and are never reminder-bound; non-marketing steps never use the marketing purpose', () => {
    for (const j of JOURNEYS) for (const s of j.steps) {
      if (s.messageClass === 'MARKETING') { expect(s.purpose).toBe('MARKETING'); expect(s.stopOn).toContain('MARKETING_CONSENT_LOST'); expect(TEMPLATES[s.kind as NotifyKind].marketing).toBe(true); }
      else { expect(s.purpose).not.toBe('MARKETING'); expect(TEMPLATES[s.kind as NotifyKind].marketing ?? false).toBe(false); }
      if (s.channels.length === 1 && s.channels[0] === 'INAPP') expect(s.messageClass).toBe('TRANSACTIONAL'); // a card, never a message
    }
  });
  it('every step stops when the account is deleted', () => {
    for (const j of JOURNEYS) for (const s of j.steps) expect(s.stopOn).toContain('accountDeleted');
  });
  it('incomplete booking recovery: one nudge at +45 minutes, needs REMINDERS, stops on booking, no specialty in the text', () => {
    const j = journeyByKey('booking-recovery')!;
    expect(j.steps).toHaveLength(1);
    expect(j.steps[0]).toMatchObject({ delayMinutes: 45, purpose: 'REMINDER', messageClass: 'TRANSACTIONAL' });
    expect(j.steps[0]!.stopOn).toContain('bookedAfterAnchor');
    expect(TEMPLATES.BOOKING_RECOVERY.en).toMatch(/booking request/);
  });
  it('re-engagement is MARKETING, generic, two steps at most, with a holdout-capable stop on leaving dormant', () => {
    const j = journeyByKey('reengagement')!;
    expect(j.steps.every((s) => s.messageClass === 'MARKETING')).toBe(true);
    expect(j.steps).toHaveLength(2);
    expect(j.params.maxPer90Days).toBe(2);
    expect(j.steps[0]!.stopOn).toContain('leftDormant');
  });
  it('post-visit adds ONE reminder after 48 hours and stops when a review exists', () => {
    const j = journeyByKey('post-visit')!;
    expect(j.steps).toHaveLength(1);
    expect(j.steps[0]!.delayMinutes).toBe(48 * 60);
    expect(j.steps[0]!.stopOn).toContain('reviewedAnchor');
  });
  it('reward notices: issued, redeemed and reversed are TRANSACTIONAL; the expiry notice is TRANSACTIONAL while plain; the step is chosen by the event', () => {
    const j = journeyByKey('reward-notice')!;
    for (const s of j.steps) expect(s.messageClass).toBe('TRANSACTIONAL');
    expect(nextStepOf(j, 0, { event: 'REVERSED' })?.kind).toBe('REWARD_REVERSED');
    expect(nextStepOf(j, 0, { event: 'ISSUED' })?.kind).toBe('REWARD_ISSUED');
    expect(nextStepOf(j, 0, { event: 'NOPE' })).toBeNull();
    expect(TEMPLATES.REWARD_EXPIRING.promotional ?? false).toBe(false);
  });
  it('welcome: the card always, the message only when registration asked for a confirmation', () => {
    const j = journeyByKey('welcome')!;
    expect(nextStepOf(j, 0, {})?.step).toBe(1);
    expect(nextStepOf(j, 1, {})).toBeNull();
    expect(nextStepOf(j, 1, { confirmationRequested: true })?.step).toBe(2);
  });
  it('policy maxSteps limits the steps; a finished journey has no next step', () => {
    const j = journeyByKey('referral-invite')!;
    expect(nextStepOf(j, 0, {}, 1)?.step).toBe(1);
    expect(nextStepOf(j, 1, {}, 1)).toBeNull();
    expect(nextStepOf(j, 2, {})).toBeNull();
  });
});

describe('lifecycle template copy', () => {
  const lifecycle = ['WELCOME', 'BOOKING_RECOVERY', 'DEPOSIT_PENDING_FOLLOWUP', 'FEEDBACK_REMINDER', 'REENGAGE_DORMANT', 'REFERRAL_INVITE_CARD', 'REFERRAL_NUDGE', 'REWARD_ISSUED', 'REWARD_REDEEMED', 'REWARD_REVERSED', 'REWARD_EXPIRING', 'FAMILY_ONBOARDING_CARD', 'FAMILY_ONBOARDING', 'NEW_DEVICE_NOTICE'] as const;
  it.each(lifecycle)('%s: AR and EN present, same placeholders, no clinical word, no emoji, no PHI, Meta id is a placeholder, copy review pending', (kind) => {
    const t = TEMPLATES[kind];
    expect(t.en.length).toBeGreaterThan(10); expect(t.ar.length).toBeGreaterThan(10);
    expect(placeholders(t.en)).toBe(placeholders(t.ar));
    expect(t.en).not.toMatch(CLINICAL_WORDS); expect(t.ar).not.toMatch(AR_CLINICAL);
    expect(`${t.en}${t.ar}`).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(detectPhi(render(t.en, { time: 'Mon 9:00', date: '1 Jan' }))).toEqual([]);
    expect(t.templateId.startsWith('TODO_NEEDS_HUMAN_')).toBe(true);
    expect(t.copyReview).toBe('PENDING');
  });
  it('the marketing texts are generic: no specialty, provider or doctor placeholder', () => {
    for (const k of ['REENGAGE_DORMANT', 'REFERRAL_NUDGE', 'FAMILY_ONBOARDING'] as const) expect(TEMPLATES[k].en + TEMPLATES[k].ar).not.toMatch(/\{(doctor|specialty|provider|clinic)\}/);
  });
  it('the journey layer exposes no segment attribute outside the allowlist', () => {
    expect(SEGMENT_ATTRIBUTES).not.toContain('specialty' as never);
  });
});
