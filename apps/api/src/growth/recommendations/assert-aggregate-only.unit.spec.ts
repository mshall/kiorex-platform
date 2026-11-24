import { assertAggregateOnly, checkAggregateOnly, type AggregateViolationCode } from './assert-aggregate-only';

const codes = (v: unknown) => checkAggregateOnly(v).map((x) => x.code);
const first = (v: unknown): AggregateViolationCode | undefined => checkAggregateOnly(v)[0]?.code;

describe('assertAggregateOnly (GRW-P3-E)', () => {
  it('accepts a clean aggregate payload', () => {
    expect(codes({ fromChannel: 'PAID_SEARCH', toChannel: 'REFERRAL', shiftBp: 1500, fromAttended: 40, toAttended: 55, fromCacMinor: 90_000, window: { from: '2027-01-01', to: '2027-01-28' }, campaignKey: 'ramadan-acquisition-2027' })).toEqual([]);
  });
  it('accepts zero counts (an empty cell is not a person)', () => { expect(codes({ attendedNew: 0, count: 0 })).toEqual([]); });

  it.each(['sub', 'subject', 'subjectHash', 'userId', 'patientId', 'phone', 'email', 'name', 'nationalId', 'visitorKey', 'addressHash', 'deviceToken', 'doctor', 'doctorRef', 'provider', 'providerRef', 'branchRef', 'specialty', 'diagnosis', 'condition', 'symptom', 'icd', 'prescription', 'medication', 'reason'])('rejects the identifier key "%s"', (k) => {
    expect(first({ [k]: 'x' })).toBe('IDENTIFIER_KEY');
    expect(first({ nested: { deeper: { [k]: 1 } } })).toBe('IDENTIFIER_KEY');
  });
  it.each(['audience', 'lookalikeAudience', 'retargetingList', 'segmentMembers', 'userList', 'recipients', 'customMatch', 'hashedList'])('rejects the audience key "%s"', (k) => { expect(codes({ [k]: [] })).toContain('AUDIENCE_KEY'); });
  it.each([['a person e-mail', 'someone@example.com'], ['a phone number', '+201012345678'], ['a local phone', '01012345678'], ['a hash', 'a'.repeat(30) + '1'], ['a sha256', 'f'.repeat(64)], ['a uuid', '123e4567-e89b-12d3-a456-426614174000'], ['a cuid-like id', 'cm1abc2def3ghi4jkl5mno6p7']])('rejects %s as a value', (_n, v) => {
    expect(codes({ label: v })).toContain('IDENTIFIER_VALUE');
  });
  it.each([1, 2, 5, 9])('rejects a small cell of %i in a count key', (n) => { expect(codes({ attendedNew: n })).toContain('SMALL_CELL'); expect(codes({ rows: [{ patients: n }] })).toContain('SMALL_CELL'); });
  it('accepts exactly k = 10 and above', () => { expect(codes({ attendedNew: 10, patients: 11 })).toEqual([]); });
  it('a small number in a key that is not a count is fine (a rate in basis points, a day count)', () => { expect(codes({ activeDays: 3, shiftBp: 5 })).toEqual([]); });
  it.each(['Cardiology patients', 'target diabetes', 'pregnancy cohort', 'مرضى القلب', 'doctor list', 'prescription refill'])('rejects the health word in "%s"', (v) => { expect(codes({ note: v })).toContain('HEALTH_WORD'); });
  it('rejects over-long text, deep nesting and huge lists', () => {
    expect(codes({ note: 'x'.repeat(241) })).toContain('TOO_LONG');
    expect(codes({ a: { b: { c: { d: { e: { f: { g: 1 } } } } } } })).toContain('TOO_DEEP');
    expect(codes({ list: Array.from({ length: 51 }, (_, i) => i) })).toContain('TOO_MANY');
  });
  it('rejects NaN and Infinity', () => { expect(codes({ x: Number.NaN })).toContain('NOT_FINITE'); expect(codes({ x: Infinity })).toContain('NOT_FINITE'); });
  it('throws 422 RECOMMENDATION_NOT_AGGREGATE with the violations', () => {
    try { assertAggregateOnly({ phone: '1' }); throw new Error('no throw'); } catch (e) { const r = (e as { getResponse(): { code: string; violations: unknown[] }; getStatus(): number }); expect(r.getStatus()).toBe(422); expect(r.getResponse().code).toBe('RECOMMENDATION_NOT_AGGREGATE'); expect(r.getResponse().violations.length).toBeGreaterThan(0); }
  });

  // property test (fuzz): a seeded generator builds clean payloads, then poisons one random spot; the guard must pass every clean one and reject every poisoned one
  describe('fuzz', () => {
    let seed = 987654321; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
    const clean = (depth = 0): unknown => {
      const o: Record<string, unknown> = {};
      for (let i = 0; i < 1 + Math.floor(rnd() * 5); i++) {
        const k = pick(['shiftBp', 'cacMinor', 'spendMinor', 'liftBp', 'activeDays', 'confidenceBp', 'rateBp', 'basis', 'window', 'fromChannel', 'toChannel']);
        o[`${k}${i}`.replace(/\d$/, '')] = depth < 2 && rnd() < 0.2 ? clean(depth + 1) : rnd() < 0.5 ? Math.floor(rnd() * 100_000) : pick(['CAC', 'LTV_CAC', 'PAID_SEARCH', 'REFERRAL', '2027-01-28']);
      }
      if (rnd() < 0.5) o.attendedNew = 10 + Math.floor(rnd() * 500);
      return o;
    };
    const poison = (v: any): void => {
      const holder = (() => { let cur = v; while (rnd() < 0.5) { const subs = Object.values(cur).filter((x) => x && typeof x === 'object'); if (!subs.length) break; cur = pick(subs as any[]); } return cur; })();
      const kind = Math.floor(rnd() * 6);
      if (kind === 0) holder[pick(['sub', 'patientId', 'phone', 'email', 'subjectHash', 'doctorRef', 'specialty'])] = 'x';
      else if (kind === 1) holder.note = `${Math.floor(rnd() * 1e6)}@mail.example.org`;
      else if (kind === 2) holder.attendedNew = 1 + Math.floor(rnd() * 9);
      else if (kind === 3) holder.audience = [1, 2, 3];
      else if (kind === 4) holder.note = pick(['cardiology', 'diabetes', 'pregnancy', 'القلب', 'prescription']);
      else holder.tok = 'k' + Math.floor(rnd() * 1e9).toString(36).padEnd(26, '7') + '9';
    };
    it('accepts 300 clean payloads and rejects 300 poisoned ones', () => {
      for (let i = 0; i < 300; i++) { const c = clean() as any; expect(checkAggregateOnly(c)).toEqual([]); const p = JSON.parse(JSON.stringify(c)); poison(p); expect(checkAggregateOnly(p).length).toBeGreaterThan(0); }
    });
  });
});
