import { computeAttributionInputsHash } from '@kiorex/contracts';
import { decide, FirstTouchNotForCommissionError, type DecisionBooking, type DecisionPolicy, type DecisionTouch } from './decide';
import { toDecisionPolicy } from './policy';
import { GROWTH_DEFAULT_PAYLOADS } from '../config/growth-defaults';

const T0 = Date.parse('2026-11-24T12:00:00.000Z');
const H = 3_600_000; const D = 24 * H;
const at = (ageMs: number) => new Date(T0 - ageMs).toISOString();
const booking = (o: Partial<DecisionBooking> = {}): DecisionBooking => ({ id: 'kx_bk_1', orgId: 'org_A', clinicId: 'cl_1', doctorId: 'dr_1', createdAt: new Date(T0).toISOString(), channel: 'MARKETPLACE', ...o });
const policy = (o: Partial<DecisionPolicy> = {}): DecisionPolicy => ({ ...toDecisionPolicy('ver_1', GROWTH_DEFAULT_PAYLOADS.ATTRIBUTION_POLICY as never), ...o });
let seq = 0;
const touch = (kind: string, ageMs: number, o: Partial<DecisionTouch> = {}): DecisionTouch => ({ id: o.id ?? `t_${String(++seq).padStart(3, '0')}`, kind, occurredAt: at(ageMs), providerOrgRef: kind.startsWith('PROVIDER') || kind === 'WIDGET' || kind === 'OFFLINE' ? 'org_A' : null, dwellMs: 1800, ...o });

interface Case { name: string; b?: Partial<DecisionBooking>; p?: Partial<DecisionPolicy>; t?: DecisionTouch[]; origin: string; reason: string; winner?: string | null }
const cases: Case[] = [
  // ── 1 explicit channel ──
  { name: 'CLINIC_LINK channel is provider-led with no touches at all', b: { channel: 'CLINIC_LINK' }, origin: 'PROVIDER_LED', reason: 'EXPLICIT_PROVIDER_CHANNEL' },
  { name: 'a valid lt token for the same organisation is provider-led', b: { ltValidForOrg: true }, origin: 'PROVIDER_LED', reason: 'EXPLICIT_PROVIDER_CHANNEL' },
  { name: 'explicit channel wins over a later referral and a campaign touch', b: { channel: 'CLINIC_LINK' }, t: [touch('REFERRAL', 1 * H), touch('CAMPAIGN', 2 * H)], origin: 'PROVIDER_LED', reason: 'EXPLICIT_PROVIDER_CHANNEL' },
  { name: 'lt token wins over LAST_NON_DIRECT when a campaign touch is newer', b: { ltValidForOrg: true }, p: { precedence: 'LAST_NON_DIRECT' }, t: [touch('PROVIDER_LINK', 3 * H), touch('CAMPAIGN', 1 * H)], origin: 'PROVIDER_LED', reason: 'EXPLICIT_PROVIDER_CHANNEL' },
  { name: 'lt not valid for this org is NOT provider-led', b: { ltValidForOrg: false }, origin: 'UNATTRIBUTED', reason: 'NO_PROVIDER_EVIDENCE' },
  // ── 2 provider touch ──
  { name: 'provider link touch inside the window with dwell is provider-led (Kiorex-visible touch before booking)', t: [touch('PROVIDER_LINK', 2 * D, { id: 'p1' })], origin: 'PROVIDER_LED', reason: 'PRIOR_PROVIDER_TOUCH', winner: 'p1' },
  { name: 'QR touch counts like a link', t: [touch('PROVIDER_QR', 5 * D, { id: 'q1' })], origin: 'PROVIDER_LED', reason: 'PRIOR_PROVIDER_TOUCH', winner: 'q1' },
  { name: 'widget touch counts', t: [touch('WIDGET', 1 * H, { id: 'w1' })], origin: 'PROVIDER_LED', reason: 'PRIOR_PROVIDER_TOUCH', winner: 'w1' },
  { name: 'PROVIDER_FIRST: provider touch beats a NEWER organic touch', t: [touch('PROVIDER_LINK', 10 * D, { id: 'p1' }), touch('ORGANIC_SEARCH', 1 * H)], origin: 'PROVIDER_LED', reason: 'PRIOR_PROVIDER_TOUCH', winner: 'p1' },
  { name: 'PROVIDER_FIRST: provider touch beats a NEWER campaign click', t: [touch('PROVIDER_LINK', 6 * D, { id: 'p1' }), touch('CAMPAIGN', 1 * D)], origin: 'PROVIDER_LED', reason: 'PRIOR_PROVIDER_TOUCH', winner: 'p1' },
  { name: 'PROVIDER_FIRST: provider touch beats a NEWER patient referral', t: [touch('PROVIDER_LINK', 6 * D, { id: 'p1' }), touch('REFERRAL', 1 * D)], origin: 'PROVIDER_LED', reason: 'PRIOR_PROVIDER_TOUCH', winner: 'p1' },
  { name: 'latest provider touch is the evidence when there are several', t: [touch('PROVIDER_LINK', 9 * D, { id: 'old' }), touch('PROVIDER_QR', 2 * D, { id: 'new' })], origin: 'PROVIDER_LED', reason: 'PRIOR_PROVIDER_TOUCH', winner: 'new' },
  { name: 'tie on occurredAt: the smallest id wins (stable)', t: [touch('PROVIDER_LINK', 2 * D, { id: 'b' }), touch('PROVIDER_QR', 2 * D, { id: 'a' })], origin: 'PROVIDER_LED', reason: 'PRIOR_PROVIDER_TOUCH', winner: 'a' },
  { name: 'touch of ANOTHER organisation is ignored', t: [touch('PROVIDER_LINK', 1 * D, { providerOrgRef: 'org_B' })], origin: 'UNATTRIBUTED', reason: 'NO_PROVIDER_EVIDENCE' },
  { name: 'provider touch without an organisation is ignored', t: [touch('PROVIDER_LINK', 1 * D, { providerOrgRef: null })], origin: 'UNATTRIBUTED', reason: 'NO_PROVIDER_EVIDENCE' },
  { name: 'other-org provider touch does not hide this org\'s older touch', t: [touch('PROVIDER_LINK', 5 * D, { id: 'mine' }), touch('PROVIDER_LINK', 1 * D, { providerOrgRef: 'org_B' })], origin: 'PROVIDER_LED', reason: 'PRIOR_PROVIDER_TOUCH', winner: 'mine' },
  // ── dwell ──
  { name: 'dwell 999 ms (below the 1000 ms minimum) does not count', t: [touch('PROVIDER_LINK', 1 * D, { dwellMs: 999 })], origin: 'UNATTRIBUTED', reason: 'NO_PROVIDER_EVIDENCE' },
  { name: 'dwell exactly 1000 ms counts', t: [touch('PROVIDER_LINK', 1 * D, { id: 'p1', dwellMs: 1000 })], origin: 'PROVIDER_LED', reason: 'PRIOR_PROVIDER_TOUCH', winner: 'p1' },
  { name: 'unknown dwell (null) does not count', t: [touch('PROVIDER_LINK', 1 * D, { dwellMs: null })], origin: 'UNATTRIBUTED', reason: 'NO_PROVIDER_EVIDENCE' },
  { name: 'a short-dwell provider touch with a real organic touch falls to the marketplace touch', t: [touch('PROVIDER_LINK', 2 * D, { dwellMs: 10 }), touch('ORGANIC_SEARCH', 1 * D, { id: 'o1' })], origin: 'MARKETPLACE', reason: 'MARKETPLACE_TOUCH', winner: 'o1' },
  { name: 'configurable dwell minimum (3000 ms): 2999 fails', p: { minDwellMsForProviderTouch: 3000 }, t: [touch('PROVIDER_LINK', 1 * D, { dwellMs: 2999 })], origin: 'UNATTRIBUTED', reason: 'NO_PROVIDER_EVIDENCE' },
  // ── windows ──
  { name: 'window edge: 29 d 23 h is inside the 30 day provider window', t: [touch('PROVIDER_LINK', 29 * D + 23 * H, { id: 'p1' })], origin: 'PROVIDER_LED', reason: 'PRIOR_PROVIDER_TOUCH', winner: 'p1' },
  { name: 'window edge: exactly 30 d is inside (inclusive)', t: [touch('PROVIDER_LINK', 30 * D, { id: 'p1' })], origin: 'PROVIDER_LED', reason: 'PRIOR_PROVIDER_TOUCH', winner: 'p1' },
  { name: 'window edge: 30 d 1 s is outside', t: [touch('PROVIDER_LINK', 30 * D + 1000)], origin: 'UNATTRIBUTED', reason: 'NO_PROVIDER_EVIDENCE' },
  { name: 'a 31 day old provider touch plus a fresh organic touch is marketplace', t: [touch('PROVIDER_LINK', 31 * D), touch('ORGANIC_SEARCH', 1 * H, { id: 'o1' })], origin: 'MARKETPLACE', reason: 'MARKETPLACE_TOUCH', winner: 'o1' },
  { name: 'policy window 45 days keeps a 40 day provider touch', p: { providerTouchWindowDays: 45 }, t: [touch('PROVIDER_LINK', 40 * D, { id: 'p1' })], origin: 'PROVIDER_LED', reason: 'PRIOR_PROVIDER_TOUCH', winner: 'p1' },
  { name: 'policy window 7 days drops a 10 day provider touch', p: { providerTouchWindowDays: 7 }, t: [touch('PROVIDER_LINK', 10 * D)], origin: 'UNATTRIBUTED', reason: 'NO_PROVIDER_EVIDENCE' },
  { name: 'a touch AT the booking instant is not before it (ignored)', t: [touch('PROVIDER_LINK', 0)], origin: 'UNATTRIBUTED', reason: 'NO_PROVIDER_EVIDENCE' },
  { name: 'a touch after the booking is ignored', t: [touch('PROVIDER_LINK', -1 * H)], origin: 'UNATTRIBUTED', reason: 'NO_PROVIDER_EVIDENCE' },
  // ── 3 patient referral ──
  { name: 'referral touch in window: Kiorex-acquired', t: [touch('REFERRAL', 3 * D, { id: 'r1' })], origin: 'MARKETPLACE', reason: 'PATIENT_REFERRAL', winner: 'r1' },
  { name: 'referral at 29 d 23 h is in, at 30 d 1 s is out', t: [touch('REFERRAL', 30 * D + 1000)], origin: 'UNATTRIBUTED', reason: 'NO_PROVIDER_EVIDENCE' },
  { name: 'referral beats a campaign click (rule 3 before rule 4)', t: [touch('CAMPAIGN', 1 * D), touch('REFERRAL', 3 * D, { id: 'r1' })], origin: 'MARKETPLACE', reason: 'PATIENT_REFERRAL', winner: 'r1' },
  { name: 'referral window is its own policy value (10 days): 12 days old falls out', p: { patientReferralWindowDays: 10 }, t: [touch('REFERRAL', 12 * D)], origin: 'UNATTRIBUTED', reason: 'NO_PROVIDER_EVIDENCE' },
  // ── 4 marketplace touches ──
  { name: 'paid campaign click inside 7 days is a marketplace touch', t: [touch('CAMPAIGN', 6 * D, { id: 'c1' })], origin: 'MARKETPLACE', reason: 'MARKETPLACE_TOUCH', winner: 'c1' },
  { name: 'campaign click at 7 d 1 s is outside the 7 day click window', t: [touch('CAMPAIGN', 7 * D + 1000)], origin: 'UNATTRIBUTED', reason: 'NO_PROVIDER_EVIDENCE' },
  { name: 'campaign click at exactly 7 d is inside', t: [touch('CAMPAIGN', 7 * D, { id: 'c1' })], origin: 'MARKETPLACE', reason: 'MARKETPLACE_TOUCH', winner: 'c1' },
  { name: 'organic search touch is a marketplace touch', t: [touch('ORGANIC_SEARCH', 2 * D, { id: 'o1' })], origin: 'MARKETPLACE', reason: 'MARKETPLACE_TOUCH', winner: 'o1' },
  { name: 'direct app touch is a marketplace touch', t: [touch('DIRECT', 2 * D, { id: 'd1' })], origin: 'MARKETPLACE', reason: 'MARKETPLACE_TOUCH', winner: 'd1' },
  { name: 'WhatsApp entry touch is a marketplace touch', t: [touch('WHATSAPP', 1 * D, { id: 'wa' })], origin: 'MARKETPLACE', reason: 'MARKETPLACE_TOUCH', winner: 'wa' },
  { name: 'latest marketplace touch is the evidence', t: [touch('ORGANIC_SEARCH', 4 * D, { id: 'o1' }), touch('DIRECT', 1 * D, { id: 'd1' })], origin: 'MARKETPLACE', reason: 'MARKETPLACE_TOUCH', winner: 'd1' },
  // ── 5 none ──
  { name: 'no touches, plain marketplace channel: no provider evidence', origin: 'UNATTRIBUTED', reason: 'NO_PROVIDER_EVIDENCE', winner: null },
  { name: 'only ancient touches: no provider evidence', t: [touch('ORGANIC_SEARCH', 90 * D)], origin: 'UNATTRIBUTED', reason: 'NO_PROVIDER_EVIDENCE' },
  // ── LAST_NON_DIRECT ──
  { name: 'LAST_NON_DIRECT: newest non-direct touch is the provider\'s', p: { precedence: 'LAST_NON_DIRECT' }, t: [touch('CAMPAIGN', 5 * D), touch('PROVIDER_LINK', 1 * D, { id: 'p1' })], origin: 'PROVIDER_LED', reason: 'PRIOR_PROVIDER_TOUCH', winner: 'p1' },
  { name: 'LAST_NON_DIRECT: a newer campaign click beats an older provider touch', p: { precedence: 'LAST_NON_DIRECT' }, t: [touch('PROVIDER_LINK', 5 * D), touch('CAMPAIGN', 1 * D, { id: 'c1' })], origin: 'MARKETPLACE', reason: 'MARKETPLACE_TOUCH', winner: 'c1' },
  { name: 'LAST_NON_DIRECT: direct visits are skipped, the provider touch still wins', p: { precedence: 'LAST_NON_DIRECT' }, t: [touch('PROVIDER_LINK', 5 * D, { id: 'p1' }), touch('DIRECT', 1 * H)], origin: 'PROVIDER_LED', reason: 'PRIOR_PROVIDER_TOUCH', winner: 'p1' },
  { name: 'LAST_NON_DIRECT: a newer referral beats an older provider touch', p: { precedence: 'LAST_NON_DIRECT' }, t: [touch('PROVIDER_LINK', 9 * D), touch('REFERRAL', 2 * D, { id: 'r1' })], origin: 'MARKETPLACE', reason: 'PATIENT_REFERRAL', winner: 'r1' },
  { name: 'LAST_NON_DIRECT: a newer ineligible (other org) touch does not count as the last touch', p: { precedence: 'LAST_NON_DIRECT' }, t: [touch('PROVIDER_LINK', 5 * D, { id: 'p1' }), touch('PROVIDER_LINK', 1 * D, { providerOrgRef: 'org_B' })], origin: 'PROVIDER_LED', reason: 'PRIOR_PROVIDER_TOUCH', winner: 'p1' },
  // ── returning visitor / repeat ──
  { name: 'returning patient: an old provider touch and a recent organic visit stays provider-led under PROVIDER_FIRST', t: [touch('PROVIDER_QR', 20 * D, { id: 'p1' }), touch('ORGANIC_SEARCH', 2 * D), touch('DIRECT', 1 * H)], origin: 'PROVIDER_LED', reason: 'PRIOR_PROVIDER_TOUCH', winner: 'p1' },
  { name: 'returning patient: only organic visits, no provider touch ever: marketplace', t: [touch('ORGANIC_SEARCH', 20 * D), touch('DIRECT', 1 * H, { id: 'd1' })], origin: 'MARKETPLACE', reason: 'MARKETPLACE_TOUCH', winner: 'd1' },
  // ── offline evidence ──
  { name: 'OFFLINE evidence is ignored unless the policy allows it', t: [touch('OFFLINE', 1 * D, { dwellMs: null })], origin: 'UNATTRIBUTED', reason: 'NO_PROVIDER_EVIDENCE' },
  { name: 'OFFLINE evidence counts when allowed (no dwell needed)', p: { allowOfflineEvidence: true }, t: [touch('OFFLINE', 1 * D, { id: 'off', dwellMs: null })], origin: 'PROVIDER_LED', reason: 'PRIOR_PROVIDER_TOUCH', winner: 'off' },
  { name: 'OFFLINE evidence for another organisation never counts', p: { allowOfflineEvidence: true }, t: [touch('OFFLINE', 1 * D, { providerOrgRef: 'org_B', dwellMs: null })], origin: 'UNATTRIBUTED', reason: 'NO_PROVIDER_EVIDENCE' },
];

describe('attribution decide(): table of rule branches (founder rules)', () => {
  it('has at least 40 cases', () => expect(cases.length).toBeGreaterThanOrEqual(40));
  it.each(cases)('$name', (c) => {
    const d = decide(booking(c.b), c.t ?? [], policy(c.p));
    expect({ origin: d.origin, reason: d.reasonCode }).toEqual({ origin: c.origin, reason: c.reason });
    if (c.winner !== undefined) expect(d.winningTouchId).toBe(c.winner);
  });
});

describe('founder scenarios, named', () => {
  it('provider-originated: patient came through the provider link, then booked through the marketplace page later the same week', () => {
    const d = decide(booking(), [touch('PROVIDER_LINK', 4 * D, { id: 'p1' }), touch('ORGANIC_SEARCH', 1 * H)], policy());
    expect(d).toMatchObject({ origin: 'PROVIDER_LED', reasonCode: 'PRIOR_PROVIDER_TOUCH', winningTouchId: 'p1' });
  });
  it('Kiorex-originated: patient found the provider through search and never touched a provider link', () => {
    expect(decide(booking(), [touch('ORGANIC_SEARCH', 1 * D)], policy())).toMatchObject({ origin: 'MARKETPLACE', reasonCode: 'MARKETPLACE_TOUCH' });
  });
  it('patient referral: Kiorex-acquired, even if the same patient once clicked another provider\'s link', () => {
    expect(decide(booking(), [touch('PROVIDER_LINK', 2 * D, { providerOrgRef: 'org_B' }), touch('REFERRAL', 1 * D)], policy())).toMatchObject({ origin: 'MARKETPLACE', reasonCode: 'PATIENT_REFERRAL' });
  });
  it('paid campaign: marketplace, and a provider touch older than the campaign click still wins under PROVIDER_FIRST (the fee can only be removed)', () => {
    expect(decide(booking(), [touch('CAMPAIGN', 1 * D)], policy())).toMatchObject({ origin: 'MARKETPLACE' });
    expect(decide(booking(), [touch('PROVIDER_QR', 6 * D), touch('CAMPAIGN', 1 * D)], policy())).toMatchObject({ origin: 'PROVIDER_LED' });
  });
  it('FIRST_TOUCH is reporting only: the function refuses to decide a commission origin with it', () => {
    expect(() => decide(booking(), [], policy({ precedence: 'FIRST_TOUCH' }))).toThrow(FirstTouchNotForCommissionError);
  });
  it('never produces a chargeable origin when a qualifying provider touch exists under PROVIDER_FIRST (monotone: more provider evidence never ADDS a fee)', () => {
    const without = decide(booking(), [touch('ORGANIC_SEARCH', 1 * D)], policy());
    const withProvider = decide(booking(), [touch('ORGANIC_SEARCH', 1 * D), touch('PROVIDER_LINK', 3 * D)], policy());
    expect(without.origin).not.toBe('PROVIDER_LED');
    expect(withProvider.origin).toBe('PROVIDER_LED');
  });
});

describe('reporting pointers and inputs hash', () => {
  it('first, last and last non-direct pointers are computed from eligible touches only', () => {
    const d = decide(booking(), [touch('ORGANIC_SEARCH', 9 * D, { id: 'a' }), touch('CAMPAIGN', 3 * D, { id: 'b' }), touch('DIRECT', 1 * D, { id: 'c' })], policy());
    expect(d).toMatchObject({ firstTouchId: 'a', lastTouchId: 'c', lastNonDirectTouchId: 'b' });
  });
  it('the inputs hash is the contract helper over the booking subset and ordered touch ids with timestamps (precedence and policy version included)', () => {
    const ts = [touch('PROVIDER_LINK', 3 * D, { id: 'z' }), touch('ORGANIC_SEARCH', 1 * D, { id: 'y' })];
    const d = decide(booking(), ts, policy());
    expect(d.inputsHash).toBe(computeAttributionInputsHash({ booking: { id: 'kx_bk_1', orgId: 'org_A', clinicId: 'cl_1', doctorId: 'dr_1', createdAt: new Date(T0).toISOString(), channel: 'MARKETPLACE', hasValidLt: false }, touches: ts.map((t) => ({ id: t.id, occurredAt: t.occurredAt })), policyVersion: 'ver_1', precedence: 'PROVIDER_FIRST' }));
  });
  it('a different policy version or precedence changes the hash', () => {
    const a = decide(booking(), [], policy()).inputsHash;
    expect(decide(booking(), [], policy({ versionId: 'ver_2' })).inputsHash).not.toBe(a);
    expect(decide(booking(), [], policy({ precedence: 'LAST_NON_DIRECT' })).inputsHash).not.toBe(a);
  });
});

describe('determinism and replay (property test)', () => {
  // mulberry32: a seeded generator so a failure is reproducible
  const rng = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const KINDS = ['PROVIDER_LINK', 'PROVIDER_QR', 'WIDGET', 'ORGANIC_SEARCH', 'DIRECT', 'REFERRAL', 'CAMPAIGN', 'WHATSAPP', 'OFFLINE'];
  const PRECS = ['PROVIDER_FIRST', 'LAST_NON_DIRECT'] as const;
  function scenario(seed: number) {
    const r = rng(seed); const n = Math.floor(r() * 8);
    const ts: DecisionTouch[] = Array.from({ length: n }, (_, i) => ({ id: `s${seed}_${i}`, kind: KINDS[Math.floor(r() * KINDS.length)]!, providerOrgRef: r() < 0.7 ? 'org_A' : 'org_B', occurredAt: at(Math.floor(r() * 40 * D)), dwellMs: r() < 0.2 ? null : Math.floor(r() * 4000) }));
    return { b: booking({ id: `kx_bk_${seed}`, channel: r() < 0.1 ? 'CLINIC_LINK' : 'MARKETPLACE', ltValidForOrg: r() < 0.1 }), ts, p: policy({ precedence: PRECS[Math.floor(r() * 2)]!, allowOfflineEvidence: r() < 0.5 }) };
  }
  it('1000 random scenarios: deterministic, independent of input order, and stored inputs replay to the stored output', () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const { b, ts, p } = scenario(seed);
      const first = decide(b, ts, p);
      expect(decide(b, ts, p)).toEqual(first); // same input, same output
      expect(decide(b, [...ts].reverse(), p)).toEqual(first); // order of arrival does not matter
      const stored = JSON.parse(JSON.stringify({ b, ts, p })); // what the database round trip keeps
      expect(decide(stored.b, stored.ts, stored.p)).toEqual(first); // replay of stored inputs equals the stored result
    }
  });
  it('no input can turn a provider-led booking chargeable by adding touches of other classes (PROVIDER_FIRST)', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const { b, ts, p } = scenario(seed); const pf = { ...p, precedence: 'PROVIDER_FIRST' as const };
      const base = decide(b, ts, pf);
      if (base.origin !== 'PROVIDER_LED') continue;
      const noise = ts.concat([touch('CAMPAIGN', 1 * H), touch('REFERRAL', 2 * H), touch('ORGANIC_SEARCH', 3 * H)]);
      expect(decide(b, noise, pf).origin).toBe('PROVIDER_LED');
    }
  });
  it('is pure: it does not mutate its inputs', () => {
    const { b, ts, p } = scenario(7); const snap = JSON.stringify({ b, ts, p });
    decide(b, ts, p);
    expect(JSON.stringify({ b, ts, p })).toBe(snap);
  });
});
