import { evaluateSend, GATE_CHANNELS, GATE_PURPOSES, quietEnd, type GateChannel, type GateFacts, type GatePurpose } from './consent-gate';

// 2026-11-24 12:00 Cairo (UTC+2) is outside quiet hours; 23:30 Cairo is inside 21:00-09:00
const NOON = Date.parse('2026-11-24T10:00:00Z');
const NIGHT = Date.parse('2026-11-24T21:30:00Z');
const Q = { startHour: 21, endHour: 9, tzOffsetMinutes: 120 };
const facts = (o: Partial<GateFacts> = {}): GateFacts => ({ purpose: 'MARKETING', channel: 'WHATSAPP', now: NOON, consent: true, optedOut: false, suppressed: false, quiet: Q, marketingEnabled: true, sentLast24h: 0, sentLast7d: 0, caps: { perDay: 1, perWeek: 3 }, ...o });

describe('send gate: marketing needs everything', () => {
  it('allows with consent, flag, no opt-out, no suppression, outside quiet hours, inside caps', () => expect(evaluateSend(facts())).toEqual({ allow: true }));
  it.each([
    ['flag off', { marketingEnabled: false }, 'MARKETING_DISABLED'],
    ['no consent', { consent: false }, 'CONSENT'],
    ['channel opt-out', { optedOut: true }, 'OPT_OUT'],
    ['suppressed', { suppressed: true }, 'SUPPRESSED'],
    ['daily cap reached', { sentLast24h: 1 }, 'FREQUENCY_CAP_DAY'],
    ['weekly cap reached', { sentLast7d: 3 }, 'FREQUENCY_CAP_WEEK'],
    ['caps set to zero (marketing paused)', { caps: { perDay: 0, perWeek: 0 } }, 'FREQUENCY_CAP_DAY'],
  ] as const)('blocks: %s', (_n, o, reason) => expect(evaluateSend(facts(o as Partial<GateFacts>))).toEqual({ allow: false, reason }));
  it('quiet hours defer with the end of the window (09:00 Cairo next morning)', () => {
    const v = evaluateSend(facts({ now: NIGHT }));
    expect(v).toMatchObject({ allow: false, reason: 'QUIET_HOURS' });
    expect(new Date((v as { until: number }).until).toISOString()).toBe('2026-11-25T07:00:00.000Z');
  });
  it('order: flag first, then consent, opt-out, suppression, quiet hours, caps', () => {
    expect(evaluateSend(facts({ marketingEnabled: false, consent: false }))).toMatchObject({ reason: 'MARKETING_DISABLED' });
    expect(evaluateSend(facts({ consent: false, suppressed: true, now: NIGHT, sentLast24h: 5 }))).toMatchObject({ reason: 'CONSENT' });
    expect(evaluateSend(facts({ suppressed: true, now: NIGHT, sentLast24h: 5 }))).toMatchObject({ reason: 'SUPPRESSED' });
    expect(evaluateSend(facts({ now: NIGHT, sentLast24h: 5 }))).toMatchObject({ reason: 'QUIET_HOURS' });
  });
  it('in-app (inbox) marketing is still marketing: it needs consent and obeys the caps', () => {
    expect(evaluateSend(facts({ channel: 'INAPP', consent: false }))).toMatchObject({ allow: false, reason: 'CONSENT' });
    expect(evaluateSend(facts({ channel: 'INAPP', sentLast24h: 1 }))).toMatchObject({ allow: false, reason: 'FREQUENCY_CAP_DAY' });
  });
});

describe('send gate: purposes are separate (matrix purpose x channel)', () => {
  // for every NON-marketing purpose, marketing consent, marketing suppression, caps and the marketing flag are irrelevant
  const hostileMarketingState = { consent: true, suppressed: true, marketingEnabled: false, sentLast24h: 99, sentLast7d: 99, caps: { perDay: 0, perWeek: 0 } };
  const nonMarketing = GATE_PURPOSES.filter((p) => p !== 'MARKETING' && p !== 'REMINDER') as GatePurpose[];
  for (const purpose of nonMarketing) for (const channel of GATE_CHANNELS as readonly GateChannel[]) {
    it(`${purpose} on ${channel} is NOT blocked by marketing consent, suppression, flag or caps`, () => {
      expect(evaluateSend(facts({ purpose, channel, ...hostileMarketingState, quiet: null }))).toEqual({ allow: true });
    });
  }
  it('REMINDER needs the REMINDERS consent but never marketing state', () => {
    expect(evaluateSend(facts({ purpose: 'REMINDER', consent: false, quiet: null }))).toMatchObject({ reason: 'CONSENT' });
    expect(evaluateSend(facts({ purpose: 'REMINDER', ...hostileMarketingState, quiet: null }))).toEqual({ allow: true });
  });
  it('TRANSACTIONAL respects a channel opt-out and quiet hours; SECURITY ignores both (an OTP must arrive)', () => {
    expect(evaluateSend(facts({ purpose: 'TRANSACTIONAL', optedOut: true }))).toMatchObject({ reason: 'OPT_OUT' });
    expect(evaluateSend(facts({ purpose: 'TRANSACTIONAL', now: NIGHT }))).toMatchObject({ reason: 'QUIET_HOURS' });
    expect(evaluateSend(facts({ purpose: 'SECURITY', optedOut: true, now: NIGHT }))).toEqual({ allow: true });
  });
  it('CLINICAL waits for quiet hours unless it is critical; a quiet-bypass template goes through', () => {
    expect(evaluateSend(facts({ purpose: 'CLINICAL', now: NIGHT }))).toMatchObject({ reason: 'QUIET_HOURS' });
    expect(evaluateSend(facts({ purpose: 'CLINICAL', now: NIGHT, critical: true }))).toEqual({ allow: true });
    expect(evaluateSend(facts({ purpose: 'TRANSACTIONAL', now: NIGHT, quietBypass: true }))).toEqual({ allow: true });
  });
  it('the in-app inbox is exempt from quiet hours for service messages but not for marketing', () => {
    expect(evaluateSend(facts({ purpose: 'TRANSACTIONAL', channel: 'INAPP', now: NIGHT }))).toEqual({ allow: true });
    expect(evaluateSend(facts({ purpose: 'MARKETING', channel: 'INAPP', now: NIGHT }))).toMatchObject({ reason: 'QUIET_HOURS' });
  });
  it('full matrix (5 purposes x 5 channels x consent x suppression x night): nothing marketing ever passes without consent', () => {
    for (const purpose of GATE_PURPOSES) for (const channel of GATE_CHANNELS) for (const consent of [true, false]) for (const suppressed of [true, false]) for (const now of [NOON, NIGHT]) {
      const v = evaluateSend(facts({ purpose, channel, consent, suppressed, now }));
      if (purpose === 'MARKETING' && (!consent || suppressed || now === NIGHT)) expect(v.allow).toBe(false);
      if (purpose === 'MARKETING' && !consent) expect(v).toMatchObject({ reason: 'CONSENT' });
    }
  });
});

describe('quietEnd', () => {
  it('handles a window that wraps midnight, a same-day window and an empty one', () => {
    expect(quietEnd(NOON, Q)).toBeNull();
    expect(quietEnd(NIGHT, Q)).not.toBeNull();
    expect(quietEnd(Date.parse('2026-11-24T08:00:00Z'), { startHour: 13, endHour: 17, tzOffsetMinutes: 0 })).toBeNull();
    expect(quietEnd(NOON, { startHour: 9, endHour: 9, tzOffsetMinutes: 0 })).toBeNull();
  });
});
