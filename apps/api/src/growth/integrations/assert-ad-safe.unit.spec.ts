import { assertAdSafe, AdUnsafeError, AD_PAYLOAD_KEYS, bucketValue, roundToHour } from './assert-ad-safe';

const ok = { eventName: 'FirstVisitCompleted', occurredAtHour: '2026-12-01T10:47:33.123Z', market: 'EG', valueMinor: 123_456, currency: 'EGP', campaignRef: 'eg-ramadan-checkup' };
const o = { consentAnalytics: true, valueBucketMinor: 1000 };
const rejects = (p: unknown, opts = o) => expect(() => assertAdSafe(p, opts)).toThrow(AdUnsafeError);

describe('assertAdSafe (GRW-P2-F)', () => {
  it('accepts the seven allowed keys, rounds the time to the hour and buckets the value', () => {
    const r = assertAdSafe(ok, o);
    expect(r).toEqual({ eventName: 'FirstVisitCompleted', occurredAtHour: '2026-12-01T10:00:00.000Z', market: 'EG', valueMinor: 123_000, currency: 'EGP', campaignRef: 'eg-ramadan-checkup' });
    expect(Object.keys(r).every((k) => (AD_PAYLOAD_KEYS as readonly string[]).includes(k))).toBe(true);
  });
  it('never returns the input object', () => { const r = assertAdSafe(ok, o); expect(r).not.toBe(ok); });
  it.each(['sub', 'userId', 'phone', 'email', 'bookingId', 'providerId', 'specialty', 'patientName', 'diagnosis', 'ip', 'deviceId', 'extra'])('rejects the extra key %s', (k) => rejects({ ...ok, [k]: 'x' }));
  it.each([
    ['uuid', '123e4567-e89b-12d3-a456-426614174000'], ['cuid', 'cjld2cjxh0000qzrmn831i7rn'], ['hex hash', 'a3f5c9d2e1b04f7a8c6d'], ['prefixed id', 'sub_9fK2xQ'], ['jwt', 'eyJhbGciOiJIUzI1NiJ9.x'], ['email', 'a@b.co'], ['long digits', '01012345678'],
  ])('rejects an identifier-looking campaignRef or eventName (%s)', (_n, v) => { rejects({ ...ok, campaignRef: v }); rejects({ ...ok, eventName: v }); });
  it.each(['Cardiology_Visit', 'dermatologist_booked', 'DoctorSeen', 'PatientRegistered', 'Lab_Result', 'phone_verified'])('rejects a health or person word in the event name (%s)', (v) => rejects({ ...ok, eventName: v }));
  it('rejects a campaignRef that names a provider or a specialty', () => { rejects({ ...ok, campaignRef: 'clinic-dr-ahmed' }); rejects({ ...ok, campaignRef: 'cardiology-promo-specialty' }); });
  it('rejects non-objects, bad market, bad currency, negative or absurd value, bad date', () => {
    for (const p of [null, 'x', 5, [], undefined]) rejects(p);
    rejects({ ...ok, market: 'egypt' }); rejects({ ...ok, currency: 'egp' }); rejects({ ...ok, valueMinor: -1 }); rejects({ ...ok, valueMinor: 1e12 }); rejects({ ...ok, valueMinor: '5' }); rejects({ ...ok, occurredAtHour: 'yesterday' }); rejects({ ...ok, occurredAtHour: undefined });
  });
  it('accepts a clickId only with analytics consent and only when it is not an e-mail or uuid', () => {
    const c = 'Cj0KCQiAxxxxxxxxxxxxBhDmARIsA';
    expect(assertAdSafe({ ...ok, clickId: c }, o).clickId).toBe(c);
    rejects({ ...ok, clickId: c }, { consentAnalytics: false });
    rejects({ ...ok, clickId: 'a@b.com.eg-longer-than-ten' }); rejects({ ...ok, clickId: '123e4567-e89b-12d3-a456-426614174000' }); rejects({ ...ok, clickId: 'short' });
  });
  it('rejects PHI in any string value', () => { rejects({ ...ok, campaignRef: 'call-01012345678' }); });
  it('hour rounding and bucketing are exact', () => { expect(roundToHour('2026-12-01T23:59:59Z')).toBe('2026-12-01T23:00:00.000Z'); expect(bucketValue(1499, 1000)).toBe(1000); expect(bucketValue(1500, 1000)).toBe(2000); });

  it('property: no random payload ever passes with a key outside the allow-list, and anything that passes only has allowed keys', () => {
    let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const keys = [...AD_PAYLOAD_KEYS, 'sub', 'phone', 'email', 'bookingId', 'x', 'name', 'ua', 'ip', 'providerId', 'specialty', 'city'];
    const vals = (): unknown => [ok.eventName, 'EG', 'eg-camp', 5000, 'EGP', '2026-12-01T10:00:00Z', 'a@b.com', '01012345678', 'cjld2cjxh0000qzrmn831i7rn', { a: 1 }, null, true, ''][Math.floor(rnd() * 13)];
    let passed = 0;
    for (let i = 0; i < 4000; i++) {
      const p: Record<string, unknown> = rnd() < 0.5 ? { ...ok } : {}; const n = Math.floor(rnd() * 4); for (let j = 0; j < n; j++) p[keys[Math.floor(rnd() * keys.length)]!] = vals();
      const hasExtra = Object.keys(p).some((k) => !(AD_PAYLOAD_KEYS as readonly string[]).includes(k));
      let r: ReturnType<typeof assertAdSafe> | null = null;
      try { r = assertAdSafe(p, o); } catch (e) { expect(e).toBeInstanceOf(AdUnsafeError); }
      if (r) { passed++; expect(hasExtra).toBe(false); expect(Object.keys(r).every((k) => (AD_PAYLOAD_KEYS as readonly string[]).includes(k))).toBe(true); expect(JSON.stringify({ ...r, valueMinor: undefined })).not.toMatch(/@|\d{9,}|cjld2/); }
    }
    expect(passed).toBeGreaterThan(0);
  });
});
