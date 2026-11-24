import { ELIGIBILITY_KEYS, isEligible, validateEligibility } from './campaign-eligibility';

const NOW = new Date('2027-01-10T10:00:00Z');
describe('campaign eligibility (GRW-P2-A, ARCH section 9 allowlist)', () => {
  it('accepts every allowlisted non-clinical key and returns a normalised value', () => {
    const r = validateEligibility({ markets: ['EG'], cities: ['Cairo', 'Giza'], districts: ['Maadi'], platforms: ['ios', 'web', 'ios'], patientType: 'NEW', registrationAgeDaysMax: 30, registrationAgeDaysMin: 0, lifecycleStages: ['REGISTERED'], careTypes: ['VIDEO'], languages: ['ar'] });
    expect(r).toMatchObject({ valid: true, value: { platforms: ['ios', 'web'], patientType: 'NEW' } });
    expect(validateEligibility(undefined)).toEqual({ valid: true, value: {} }); expect(validateEligibility({})).toEqual({ valid: true, value: {} });
  });
  it('rejects every key outside the allowlist, at type level and at runtime: no specialty, provider, doctor, diagnosis, medication, lab, age band or health attribute', () => {
    for (const k of ['specialty', 'specialties', 'provider', 'providerId', 'doctor', 'clinic', 'diagnosis', 'condition', 'medication', 'drug', 'lab', 'labTest', 'symptom', 'visitReason', 'insurance', 'gender', 'age', 'ageBand', 'health', 'phone', 'email', 'sub', 'patientId', 'nationalId', 'weight']) {
      const r = validateEligibility({ [k]: ['x'] });
      expect(r.valid).toBe(false);
      expect(JSON.stringify(r)).toContain('not an allowed eligibility key');
    }
    expect([...ELIGIBILITY_KEYS].join(' ')).not.toMatch(/specialty|provider|doctor|diagnos|medic|drug|lab|symptom|reason|phone|email|health/i);
  });
  it('rejects malformed values, oversize lists, unknown enums and inverted ages', () => {
    for (const bad of [{ markets: ['egypt'] }, { markets: 'EG' }, { cities: ['<script>'] }, { platforms: ['windows'] }, { careTypes: ['SURGERY'] }, { languages: ['fr'] }, { patientType: 'VIP' }, { registrationAgeDaysMax: -1 }, { registrationAgeDaysMax: 99999 }, { registrationAgeDaysMax: 1.5 }, { registrationAgeDaysMin: 40, registrationAgeDaysMax: 10 }, { lifecycleStages: ['lower'] }, { districts: new Array(101).fill('Maadi') }, 'string', [], 5])
      expect(validateEligibility(bad as never).valid).toBe(false);
  });
  it('isEligible: an empty rule admits everyone; each restriction needs its fact (unknown facts fail, never guessed)', () => {
    expect(isEligible({}, { market: 'EG' }, NOW)).toBe(true);
    expect(isEligible({ markets: ['EG'] }, { market: 'SA' }, NOW)).toBe(false);
    expect(isEligible({ cities: ['Cairo'] }, { market: 'EG' }, NOW)).toBe(false);
    expect(isEligible({ cities: ['Cairo'] }, { market: 'EG', city: 'Cairo' }, NOW)).toBe(true);
    expect(isEligible({ districts: ['Maadi'] }, { market: 'EG', district: 'Zamalek' }, NOW)).toBe(false);
    expect(isEligible({ platforms: ['ios'] }, { market: 'EG', platform: 'android' }, NOW)).toBe(false);
    expect(isEligible({ languages: ['ar'] }, { market: 'EG', language: 'ar' }, NOW)).toBe(true);
    expect(isEligible({ careTypes: ['VIDEO'] }, { market: 'EG', careType: 'HOME_VISIT' }, NOW)).toBe(false);
    expect(isEligible({ lifecycleStages: ['REGISTERED'] }, { market: 'EG', lifecycleStage: 'REGISTERED' }, NOW)).toBe(true);
    expect(isEligible({ patientType: 'NEW' }, { market: 'EG', hasBooking: true }, NOW)).toBe(false);
    expect(isEligible({ patientType: 'NEW' }, { market: 'EG', hasBooking: false }, NOW)).toBe(true);
    expect(isEligible({ patientType: 'RETURNING' }, { market: 'EG' }, NOW)).toBe(false);
    expect(isEligible({ patientType: 'RETURNING' }, { market: 'EG', hasBooking: true }, NOW)).toBe(true);
  });
  it('registration age windows use whole days and need a registration date', () => {
    const f = (d: number) => ({ market: 'EG', registeredAt: new Date(NOW.getTime() - d * 86_400_000) });
    expect(isEligible({ registrationAgeDaysMax: 30 }, f(30), NOW)).toBe(true); expect(isEligible({ registrationAgeDaysMax: 30 }, f(31), NOW)).toBe(false);
    expect(isEligible({ registrationAgeDaysMin: 7 }, f(6), NOW)).toBe(false); expect(isEligible({ registrationAgeDaysMin: 7 }, f(7), NOW)).toBe(true);
    expect(isEligible({ registrationAgeDaysMax: 30 }, { market: 'EG' }, NOW)).toBe(false);
  });
});
