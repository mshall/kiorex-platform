import { quietWindow } from './quiet-hours';
import { evaluateSendGate, GATE_REASONS, MESSAGE_CLASSES, type GateChannel, type GateInput, type GateReason, type MessageClass } from './send-gate';

const iso = (s: string) => Date.parse(s);
const DAY_TIME = iso('2027-03-10T10:00:00Z'); // 12:00 Cairo, outside quiet hours
const NIGHT_TIME = iso('2027-03-10T20:30:00Z'); // 22:30 Cairo, inside quiet hours
const quiet = quietWindow();

const base = (o: Partial<GateInput> = {}): GateInput => ({
  messageClass: 'TRANSACTIONAL', channel: 'PUSH', now: DAY_TIME, critical: false, quietBypass: false, journeyEnabled: true, marketingFlagOn: true, inHoldout: false, consent: true, channelOptedOut: false,
  suppressed: false, quiet, sentDay: 0, sentWeek: 0, caps: { perDay: 1, perWeek: 3 }, whatsappWindowOpen: false, templateApproved: true, hasAddress: true, phiHits: [], duplicate: false, ...o,
});

/**
 * An INDEPENDENT oracle: the rules written as a flat list of (applies, reason) pairs in the documented order, with no shared code with the gate. The 400+ vector table below must
 * agree with it on every combination.
 */
function oracle(i: GateInput): { decision: 'SEND' | 'SKIP'; reason: GateReason } {
  const M = i.messageClass === 'MARKETING';
  const inQuiet = (i.now === NIGHT_TIME) && i.quiet !== null;
  const quietExempt = i.channel === 'INAPP' || i.messageClass === 'SECURITY' || (i.messageClass === 'CLINICAL' && !!i.critical) || (!M && !!i.quietBypass);
  const rules: Array<[boolean, GateReason]> = [
    [!i.journeyEnabled, 'JOURNEY_DISABLED'],
    [M && !i.marketingFlagOn, 'MARKETING_FLAG_OFF'],
    [M && i.inHoldout, 'HOLDOUT'],
    [(M || (i.messageClass === 'TRANSACTIONAL' && i.channel !== 'INAPP')) && !i.consent, 'NO_CONSENT'],
    [i.channel !== 'INAPP' && i.channelOptedOut && !(i.messageClass === 'SECURITY' || (i.messageClass === 'CLINICAL' && !!i.critical)), 'CHANNEL_OPTED_OUT'],
    [M && i.suppressed, 'SUPPRESSED'],
    [inQuiet && !quietExempt, 'QUIET_HOURS'],
    [M && (i.caps.perDay <= 0 || i.sentDay >= i.caps.perDay), 'CAP_DAY'],
    [M && (i.caps.perWeek <= 0 || i.sentWeek >= i.caps.perWeek), 'CAP_WEEK'],
    [i.channel === 'WHATSAPP' && !i.whatsappWindowOpen && !i.templateApproved, 'WHATSAPP_TEMPLATE_REQUIRED'],
    [!i.hasAddress, 'NO_ADDRESS'],
    [i.phiHits.length > 0, 'PHI_BLOCKED'],
    [i.duplicate, 'DUPLICATE'],
  ];
  const hit = rules.find(([applies]) => applies);
  return hit ? { decision: 'SKIP', reason: hit[1] } : { decision: 'SEND', reason: 'OK' };
}

const CHANNELS: GateChannel[] = ['WHATSAPP', 'SMS', 'EMAIL', 'PUSH', 'INAPP'];

describe('send gate: every class x consent x quiet x cap x suppression x window combination (table)', () => {
  const vectors: GateInput[] = [];
  for (const messageClass of MESSAGE_CLASSES) for (const channel of CHANNELS) for (const consent of [true, false]) for (const now of [DAY_TIME, NIGHT_TIME]) for (const sentDay of [0, 1]) for (const suppressed of [false, true]) for (const templateApproved of [true, false]) for (const marketingFlagOn of [true, false]) {
    vectors.push(base({ messageClass, channel, consent, now, sentDay, suppressed, templateApproved, marketingFlagOn, ...(sentDay === 1 ? { sentWeek: 1 } : {}) }));
  }
  it(`has at least 400 vectors (${vectors.length})`, () => { expect(vectors.length).toBeGreaterThanOrEqual(400); });
  it('agrees with the independent oracle on every vector', () => {
    const disagreements: string[] = [];
    for (const v of vectors) {
      const got = evaluateSendGate(v); const want = oracle(v);
      if (got.decision !== want.decision || got.reason !== want.reason) disagreements.push(`${v.messageClass}/${v.channel} consent=${v.consent} night=${v.now === NIGHT_TIME} day=${v.sentDay} supp=${v.suppressed} tmpl=${v.templateApproved} flag=${v.marketingFlagOn}: got ${got.decision}/${got.reason}, want ${want.decision}/${want.reason}`);
    }
    expect(disagreements).toEqual([]);
  });
  it('every reason code the gate can return is a declared one, and every outcome has a reason', () => {
    for (const v of vectors) { const g = evaluateSendGate(v); expect(GATE_REASONS).toContain(g.reason); expect(g.decision === 'SEND').toBe(g.reason === 'OK'); }
  });
  it('INVARIANT: with growth.marketing_messaging OFF no MARKETING message is ever sent, whatever else is true', () => {
    for (const v of vectors.filter((x) => x.messageClass === 'MARKETING' && !x.marketingFlagOn)) expect(evaluateSendGate(v)).toMatchObject({ decision: 'SKIP', reason: 'MARKETING_FLAG_OFF' });
  });
  it('INVARIANT: MARKETING never sends without consent, never to a suppressed address, never in quiet hours (the in-app inbox is exempt), never over the cap', () => {
    for (const v of vectors.filter((x) => x.messageClass === 'MARKETING' && evaluateSendGate(x).decision === 'SEND')) {
      expect(v.consent).toBe(true); expect(v.suppressed).toBe(false); expect(v.now === DAY_TIME || v.channel === 'INAPP').toBe(true); expect(v.sentDay).toBe(0); expect(v.marketingFlagOn).toBe(true);
    }
  });
  it('INVARIANT: suppression, caps and the flag never block SECURITY, CLINICAL or TRANSACTIONAL messages', () => {
    for (const messageClass of ['SECURITY', 'CLINICAL', 'TRANSACTIONAL'] as MessageClass[]) {
      const r = evaluateSendGate(base({ messageClass, suppressed: true, sentDay: 9, sentWeek: 99, marketingFlagOn: false, inHoldout: true }));
      expect(r).toMatchObject({ decision: 'SEND', reason: 'OK' });
    }
  });
  it('INVARIANT: SECURITY ignores consent, opt-out and quiet hours; CRITICAL clinical ignores opt-out and quiet hours; ordinary clinical does not', () => {
    expect(evaluateSendGate(base({ messageClass: 'SECURITY', consent: false, channelOptedOut: true, now: NIGHT_TIME })).decision).toBe('SEND');
    expect(evaluateSendGate(base({ messageClass: 'CLINICAL', critical: true, channelOptedOut: true, now: NIGHT_TIME })).decision).toBe('SEND');
    expect(evaluateSendGate(base({ messageClass: 'CLINICAL', critical: false, now: NIGHT_TIME }))).toMatchObject({ decision: 'SKIP', reason: 'QUIET_HOURS' });
    expect(evaluateSendGate(base({ messageClass: 'CLINICAL', critical: false, channelOptedOut: true }))).toMatchObject({ reason: 'CHANNEL_OPTED_OUT' });
  });
});

describe('send gate: order of checks (the order is the specification)', () => {
  const allBad = base({ messageClass: 'MARKETING', journeyEnabled: false, marketingFlagOn: false, inHoldout: true, consent: false, channelOptedOut: true, suppressed: true, now: NIGHT_TIME, sentDay: 5, sentWeek: 9, templateApproved: false, channel: 'WHATSAPP', hasAddress: false, phiHits: ['PHONE'], duplicate: true });
  it('peels the reasons off one at a time in the documented order', () => {
    const order: Array<[Partial<GateInput>, GateReason]> = [
      [{}, 'JOURNEY_DISABLED'], [{ journeyEnabled: true }, 'MARKETING_FLAG_OFF'], [{ marketingFlagOn: true }, 'HOLDOUT'], [{ inHoldout: false }, 'NO_CONSENT'], [{ consent: true }, 'CHANNEL_OPTED_OUT'],
      [{ channelOptedOut: false }, 'SUPPRESSED'], [{ suppressed: false }, 'QUIET_HOURS'], [{ now: DAY_TIME }, 'CAP_DAY'], [{ sentDay: 0 }, 'CAP_WEEK'], [{ sentWeek: 0 }, 'WHATSAPP_TEMPLATE_REQUIRED'],
      [{ templateApproved: true }, 'NO_ADDRESS'], [{ hasAddress: true }, 'PHI_BLOCKED'], [{ phiHits: [] }, 'DUPLICATE'], [{ duplicate: false }, 'OK'],
    ];
    let cur = allBad;
    for (const [patch, reason] of order) { cur = { ...cur, ...patch }; const g = evaluateSendGate(cur); expect(g.reason).toBe(reason); }
  });
  it('quiet hours defer (never drop): the outcome carries when the window ends', () => {
    const g = evaluateSendGate(base({ messageClass: 'MARKETING', now: NIGHT_TIME }));
    expect(g).toMatchObject({ decision: 'SKIP', reason: 'QUIET_HOURS', deferUntil: iso('2027-03-11T07:00:00Z') });
  });
  it('the in-app inbox is always available for service messages and cards, but a MARKETING in-app message needs consent', () => {
    expect(evaluateSendGate(base({ messageClass: 'TRANSACTIONAL', channel: 'INAPP', consent: false, now: NIGHT_TIME, channelOptedOut: true })).decision).toBe('SEND');
    expect(evaluateSendGate(base({ messageClass: 'MARKETING', channel: 'INAPP', consent: false })).reason).toBe('NO_CONSENT');
  });
  it('a person own caps of zero (or a policy of zero) block marketing entirely', () => {
    expect(evaluateSendGate(base({ messageClass: 'MARKETING', caps: { perDay: 0, perWeek: 3 } })).reason).toBe('CAP_DAY');
    expect(evaluateSendGate(base({ messageClass: 'MARKETING', caps: { perDay: 1, perWeek: 0 } })).reason).toBe('CAP_WEEK');
  });
  it('WhatsApp: outside the 24 hour window only an approved template goes; inside the window free text is allowed', () => {
    expect(evaluateSendGate(base({ channel: 'WHATSAPP', templateApproved: false })).reason).toBe('WHATSAPP_TEMPLATE_REQUIRED');
    expect(evaluateSendGate(base({ channel: 'WHATSAPP', templateApproved: false, whatsappWindowOpen: true })).decision).toBe('SEND');
  });
  it('quiet hours on the Cairo offset-change nights defer to 09:00 local', () => {
    const spring = evaluateSendGate(base({ messageClass: 'MARKETING', now: iso('2027-04-29T21:30:00Z') }));
    expect(spring).toMatchObject({ reason: 'QUIET_HOURS', deferUntil: iso('2027-04-30T06:00:00Z') });
    const autumn = evaluateSendGate(base({ messageClass: 'MARKETING', now: iso('2027-10-28T20:00:00Z') }));
    expect(autumn).toMatchObject({ reason: 'QUIET_HOURS', deferUntil: iso('2027-10-29T07:00:00Z') });
  });
});
