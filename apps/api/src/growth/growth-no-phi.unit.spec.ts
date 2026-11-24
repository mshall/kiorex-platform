import { guardEventProps, parseEventsBody, GROWTH_EVENT_PROP_KEYS } from './events/growth-phi-guard';
import { parseTouchBody, sourceKindOf, uaClassOf, referrerHostOf, parseCookies } from './touch/touch-sanitizer';

const code = (fn: () => unknown) => { try { fn(); return 'NO_ERROR'; } catch (e) { return (e as { getResponse(): { code: string } }).getResponse().code; } };

describe('GrowthEvent props: no PHI, no identifiers (guard)', () => {
  it('accepts the allow-listed keys with short tokens, numbers and booleans', () => {
    expect(guardEventProps({ surface: 'home', platform: 'ios', count: 3, variant: 'a', position: 2, bucket: '1-5', locale: 'ar' })).toEqual({ surface: 'home', platform: 'ios', count: 3, variant: 'a', position: 2, bucket: '1-5', locale: 'ar' });
    expect(guardEventProps(undefined)).toEqual({});
  });
  it.each(['specialty', 'specialtyCode', 'providerId', 'provider_id', 'doctorId', 'clinicId', 'symptom', 'diagnosis', 'searchQuery', 'query', 'patientName', 'phone', 'email', 'address', 'district', 'nationalId', 'sub', 'bookingId', 'visitReason'])('rejects a PHI-like key: %s', (k) => {
    expect(code(() => guardEventProps({ [k]: 'x' }))).toBe('GROWTH_PHI_REJECTED');
  });
  it('rejects unknown keys that are not PHI-named as not allowed', () => expect(code(() => guardEventProps({ foo: 'x' }))).toBe('GROWTH_EVENT_NOT_ALLOWED'));
  it('rejects PHI-like VALUES in an allowed key (phone number, e-mail, national id)', () => {
    for (const v of ['01012345678', 'a@b.co', '29001011234567']) expect(code(() => guardEventProps({ surface: v }))).toMatch(/GROWTH_PHI_REJECTED|GROWTH_INVALID_REQUEST/);
  });
  it('rejects free text, long values, nested objects and more than 8 keys', () => {
    expect(code(() => guardEventProps({ surface: 'I have chest pain' }))).toBe('GROWTH_INVALID_REQUEST');
    expect(code(() => guardEventProps({ surface: 'x'.repeat(65) }))).toBe('GROWTH_INVALID_REQUEST');
    expect(code(() => guardEventProps({ surface: { a: 1 } }))).toBe('GROWTH_INVALID_REQUEST');
    const nine = Object.fromEntries(GROWTH_EVENT_PROP_KEYS.slice(0, 9).map((k) => [k, 'a']));
    expect(code(() => guardEventProps(nine))).toBe('GROWTH_INVALID_REQUEST');
  });
});

describe('events batch parsing', () => {
  it('accepts client names, careType and landingKind; rejects server-only names with GROWTH_EVENT_NOT_ALLOWED', () => {
    expect(parseEventsBody({ events: [{ name: 'PageViewed', careType: 'DOCTORS', landingKind: 'HOME', props: { surface: 'home' } }] })).toHaveLength(1);
    for (const n of ['SlotSelected', 'BookingInitiated', 'BookingConfirmed', 'BookingAttended', 'BookingCancelled', 'PatientRegistered', 'Nope']) expect(code(() => parseEventsBody({ events: [{ name: n }] }))).toBe('GROWTH_EVENT_NOT_ALLOWED');
  });
  it('rejects a specialty or provider id at the top level of an event and in props', () => {
    expect(code(() => parseEventsBody({ events: [{ name: 'PageViewed', specialty: 'cardiology' }] }))).toBe('GROWTH_PHI_REJECTED');
    expect(code(() => parseEventsBody({ events: [{ name: 'ProviderViewed', providerId: 'p_1' }] }))).toBe('GROWTH_PHI_REJECTED');
    expect(code(() => parseEventsBody({ events: [{ name: 'ProviderViewed', props: { providerId: 'p_1' } }] }))).toBe('GROWTH_PHI_REJECTED');
  });
  it('batch size is 1 to 20; careType must be a known value; occurredAt outside the sane range is replaced by now', () => {
    expect(code(() => parseEventsBody({ events: [] }))).toBe('GROWTH_INVALID_REQUEST');
    expect(code(() => parseEventsBody({ events: Array.from({ length: 21 }, () => ({ name: 'PageViewed' })) }))).toBe('GROWTH_INVALID_REQUEST');
    expect(code(() => parseEventsBody({ events: [{ name: 'PageViewed', careType: 'CARDIOLOGY' }] }))).toBe('GROWTH_INVALID_REQUEST');
    const now = new Date('2026-11-24T12:00:00Z');
    expect(parseEventsBody({ events: [{ name: 'PageViewed', occurredAt: '2030-01-01T00:00:00Z' }] }, now)[0]!.occurredAt).toEqual(now);
  });
});

describe('touch request sanitising', () => {
  it('drops unknown top-level and utm keys, keeps the known ones', () => {
    const t = parseTouchBody({ landingKind: 'HOME', utm: { source: 'google', medium: 'organic', evil: 'x' }, ref: '7K2M9X4Q', dwellMs: 1800, specialty: 'cardiology', userId: 'u1', fbp: 'abc' });
    expect(t).toEqual({ landingKind: 'HOME', utm: { source: 'google', medium: 'organic' }, ref: '7K2M9X4Q', dwellMs: 1800 });
  });
  it('rejects the WHOLE call for an e-mail-like or phone-like UTM value (422) and for pattern or length violations (400)', () => {
    expect(code(() => parseTouchBody({ landingKind: 'HOME', utm: { campaign: 'jane@example.com' } }))).toBe('GROWTH_PHI_REJECTED');
    expect(code(() => parseTouchBody({ landingKind: 'HOME', utm: { term: '01012345678' } }))).toBe('GROWTH_PHI_REJECTED');
    expect(code(() => parseTouchBody({ landingKind: 'HOME', utm: { term: 'two words' } }))).toBe('GROWTH_INVALID_REQUEST');
    expect(code(() => parseTouchBody({ landingKind: 'HOME', utm: { source: 'a'.repeat(65) } }))).toBe('GROWTH_INVALID_REQUEST');
  });
  it('validates landingKind, ref, dwellMs, clickId and lt', () => {
    for (const bad of [{}, { landingKind: 'NOPE' }, { landingKind: 'HOME', ref: 'a b' }, { landingKind: 'HOME', ref: 'abc' }, { landingKind: 'HOME', dwellMs: -1 }, { landingKind: 'HOME', dwellMs: 600001 }, { landingKind: 'HOME', dwellMs: 1.5 }, { landingKind: 'HOME', clickId: { kind: 'X', value: 'v' } }, { landingKind: 'HOME', clickId: { kind: 'GCLID', value: '' } }, { landingKind: 'HOME', lt: 'x'.repeat(513) }, null, [], 'str']) expect(code(() => parseTouchBody(bad))).toBe('GROWTH_INVALID_REQUEST');
  });
  it('source kind decision: provider and referral landings are decided by the landing, search by medium or referrer', () => {
    const p = (o: object) => parseTouchBody({ landingKind: 'HOME', ...o });
    expect(sourceKindOf(p({ landingKind: 'PROVIDER_LINK' }), null)).toBe('PROVIDER_LINK');
    expect(sourceKindOf(p({ landingKind: 'WIDGET' }), null)).toBe('WIDGET');
    expect(sourceKindOf(p({ utm: { medium: 'cpc' } }), null)).toBe('CAMPAIGN');
    expect(sourceKindOf(p({ clickId: { kind: 'GCLID', value: 'v' } }), null)).toBe('CAMPAIGN');
    expect(sourceKindOf(p({}), 'www.google.com')).toBe('ORGANIC_SEARCH');
    expect(sourceKindOf(p({ landingKind: 'SPECIALTY_CITY' }), null)).toBe('ORGANIC_SEARCH');
    expect(sourceKindOf(p({}), null)).toBe('DIRECT');
    expect(sourceKindOf(p({ landingKind: 'APP_OPEN' }), null)).toBe('DIRECT');
  });
  it('user agent becomes a class, the referrer becomes a host (own-site referrers vanish), cookies parse', () => {
    expect(uaClassOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1')).toBe('ios-safari');
    expect(uaClassOf('Googlebot/2.1 (+http://www.google.com/bot.html)')).toBe('bot');
    expect(uaClassOf(undefined)).toBe('unknown');
    expect(referrerHostOf('https://www.google.com/search?q=chest+pain+doctor', 'https://kiorex.com')).toBe('www.google.com');
    expect(referrerHostOf('https://kiorex.com/ar/eg/x?q=1', 'https://kiorex.com')).toBeNull();
    expect(referrerHostOf('not a url')).toBeNull();
    expect(parseCookies('a=1; kxv=kxv_abc; b=%20x')).toEqual({ a: '1', kxv: 'kxv_abc', b: ' x' });
  });
});
