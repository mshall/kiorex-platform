import { DEFAULT_LEAD_CONFIG, LEAD_STATUSES, LEAD_TRANSITIONS, validateLeadConfig, type LeadConfig } from './lead-config';
import { csvCell, toCsv } from './lead-csv';
import { looksLikeTest, normalisePhone, parseSubmission, payloadHashOf } from './lead-validation';
import { ackMessage } from './lead-notifier';

const base = () => ({
  mode: 'STANDALONE', providerType: 'CLINIC', legalName: 'Nile Family Clinic LLC', contactName: 'Dr Sample Person', phone: '+20 100 123 4567', modules: ['CLINIC'],
  consent: { accepted: true, textVersion: 'draft-2' }, locale: 'en',
});
const cfg = (over: Partial<LeadConfig> = {}): LeadConfig => ({ ...DEFAULT_LEAD_CONFIG, ...over });

describe('normalisePhone', () => {
  it('normalises Egyptian mobile numbers typed several ways, including Arabic digits', () => {
    for (const raw of ['+201001234567', '01001234567', '0100 123 4567', '00201001234567', '٠١٠٠١٢٣٤٥٦٧', '+20 (100) 123-4567']) expect(normalisePhone(raw, '+20')).toEqual({ ok: true, e164: '+201001234567' });
  });
  it('rejects malformed Egyptian numbers and non-numbers; accepts other countries as E.164', () => {
    for (const raw of ['+20123', 'abc', '+2010012345678901', '', '+201701234567']) expect(normalisePhone(raw, '+20').ok).toBe(false);
    expect(normalisePhone('+966501234567', '+20')).toEqual({ ok: true, e164: '+966501234567' });
    expect(normalisePhone('+20223456789', '+20').ok).toBe(true); // Cairo landline
  });
});

describe('parseSubmission', () => {
  it('accepts a minimal clinic request and normalises it', () => {
    const r = parseSubmission(base(), cfg());
    expect(r.errors).toEqual({});
    expect(r.value).toMatchObject({ providerType: 'CLINIC', phone: '+201001234567', market: 'EG', specialties: [], modules: ['CLINIC'], locale: 'en', honeypot: false });
  });
  it('reports required, invalid and not_allowed per field and never throws on junk', () => {
    expect(parseSubmission(null, cfg()).errors).toEqual({ body: 'invalid' });
    expect(parseSubmission('x', cfg()).errors).toEqual({ body: 'invalid' });
    const r = parseSubmission({ ...base(), legalName: '', contactName: '  ', phone: '12', email: 'nope', providerType: 'SPACESHIP', hacker: 1 }, cfg());
    expect(r.errors).toEqual({ hacker: 'not_allowed' });
    const r2 = parseSubmission({ ...base(), legalName: '', contactName: '  ', phone: '12', email: 'nope', providerType: 'SPACESHIP', consent: { accepted: false } }, cfg());
    expect(r2.errors).toMatchObject({ legalName: 'required', contactName: 'required', phone: 'invalid', email: 'invalid', providerType: 'invalid', consent: 'required' });
  });
  it('rejects markup, control characters and over-long text', () => {
    expect(parseSubmission({ ...base(), legalName: '<script>' }, cfg()).errors.legalName).toBe('invalid');
    expect(parseSubmission({ ...base(), legalName: 'a\u0000b' }, cfg()).errors.legalName).toBe('invalid');
    expect(parseSubmission({ ...base(), legalName: 'x'.repeat(121) }, cfg()).errors.legalName).toBe('too_long');
    expect(parseSubmission({ ...base(), note: 'n'.repeat(1001) }, cfg()).errors.note).toBe('too_long');
  });
  it('conditional fields: a chain needs 2 or more branches; fields that do not apply are ignored; unknown answers are refused', () => {
    expect(parseSubmission({ ...base(), providerType: 'CHAIN', branches: 1 }, cfg()).errors.branches).toBe('too_short');
    expect(parseSubmission({ ...base(), providerType: 'CHAIN', branches: 5, answers: { centralBilling: true, citiesCount: 3 } }, cfg()).value).toMatchObject({ branches: 5, extra: { centralBilling: true, citiesCount: 3 } });
    const doc = parseSubmission({ ...base(), providerType: 'INDEPENDENT_DOCTOR', branches: 9, staffCount: 9, licences: { facilityLicence: 'F1', professionalLicence: 'P-77/2020' } }, cfg());
    expect(doc.value?.branches).toBeUndefined(); expect(doc.value?.staffCount).toBeUndefined();
    expect(doc.value?.licences).toEqual({ professionalLicence: 'P-77/2020' });
    expect(parseSubmission({ ...base(), answers: { beds: 10 } }, cfg()).errors['answers.beds']).toBe('not_allowed');
    expect(parseSubmission({ ...base(), providerType: 'OTHER' }, cfg()).errors['answers.otherDescription']).toBe('required');
    expect(parseSubmission({ ...base(), providerType: 'NURSE', answers: { homeVisits: 'yes' } }, cfg()).errors['answers.homeVisits']).toBe('invalid');
  });
  it('licence numbers are free text, never checked against an authority: only the character set and length', () => {
    expect(parseSubmission({ ...base(), licences: { taxCard: '123-456-789' } }, cfg()).value?.licences.taxCard).toBe('123-456-789');
    expect(parseSubmission({ ...base(), licences: { taxCard: '<b>' } }, cfg()).errors.taxCard).toBe('invalid');
    expect(parseSubmission({ ...base(), licences: { passport: '1' } }, cfg()).errors['licences.passport']).toBe('not_allowed');
  });
  it('team-configured required fields are enforced only where they apply', () => {
    const c = cfg({ requiredFields: ['modules', 'email', 'facilityLicence', 'branches', 'governorate'] });
    const r = parseSubmission({ ...base(), modules: [] }, c);
    expect(r.errors).toMatchObject({ modules: 'required', email: 'required', facilityLicence: 'required', branches: 'required', governorate: 'required' });
    const d = parseSubmission({ ...base(), providerType: 'INDEPENDENT_DOCTOR', modules: ['CLINIC'], email: 'a@b.co', governorate: 'CAIRO' }, c);
    expect(d.errors).toEqual({}); // facility licence and branches do not apply to an independent doctor
  });
  it('picklist values come from the configuration: an inactive option is refused', () => {
    const c = cfg({ specialties: DEFAULT_LEAD_CONFIG.specialties.map((s) => (s.key === 'DENTISTRY' ? { ...s, active: false } : s)) });
    expect(parseSubmission({ ...base(), specialties: ['DENTISTRY'] }, c).errors.specialties).toBe('invalid');
    expect(parseSubmission({ ...base(), specialties: ['CARDIOLOGY', 'CARDIOLOGY'] }, c).value?.specialties).toEqual(['CARDIOLOGY']);
    expect(parseSubmission({ ...base(), governorate: 'ATLANTIS' }, c).errors.governorate).toBe('invalid');
    expect(parseSubmission({ ...base(), market: 'FR' }, c).errors.market).toBe('invalid');
  });
  it('the honeypot is detected but the request otherwise validates (the service answers like a success and stores nothing)', () => {
    expect(parseSubmission({ ...base(), website: 'http://spam' }, cfg()).value?.honeypot).toBe(true);
  });
  it('the payload hash ignores key order, the submission time and the source environment', () => {
    const a = parseSubmission({ ...base(), env: 'test', submittedAt: '2026-01-01T00:00:00Z' }, cfg()).value!;
    const b = parseSubmission(Object.fromEntries(Object.entries({ ...base(), env: 'prod' }).reverse()), cfg()).value!;
    expect(payloadHashOf(a)).toBe(payloadHashOf(b));
    expect(payloadHashOf(a)).not.toBe(payloadHashOf({ ...a, legalName: 'Other' }));
  });
  it('test tagging: reserved e-mail domains and name prefixes', () => {
    const v = (over: object) => parseSubmission({ ...base(), ...over }, cfg()).value!;
    expect(looksLikeTest(v({ email: 'x@example.test' }), cfg())).toBe(true);
    expect(looksLikeTest(v({ email: 'x@sub.example.invalid' }), cfg())).toBe(true);
    expect(looksLikeTest(v({ legalName: '[test] Clinic' }), cfg())).toBe(true);
    expect(looksLikeTest(v({ email: 'x@clinic.com' }), cfg())).toBe(false);
  });
});

describe('lead configuration', () => {
  it('the shipped defaults validate and contain no price or fee', () => {
    const r = validateLeadConfig(JSON.parse(JSON.stringify(DEFAULT_LEAD_CONFIG)));
    expect(r.ok).toBe(true);
    expect(JSON.stringify(DEFAULT_LEAD_CONFIG)).not.toMatch(/\b(price|pricing|egp|usd|fee|tariff|vat)\b/i);
  });
  it('refuses bad keys, duplicates, markup, unknown required fields and a market without a dial code', () => {
    const d = JSON.parse(JSON.stringify(DEFAULT_LEAD_CONFIG));
    d.providerTypes.push({ key: 'bad key', en: '<b>x</b>', ar: 'x', active: true }, { key: 'CLINIC', en: 'dup', ar: 'dup', active: true });
    d.requiredFields = ['password']; d.markets[0].dialCode = '20';
    const r = validateLeadConfig(d);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join('|')).toMatch(/providerTypes\[9\].key[\s\S]*en: 1 to 80[\s\S]*duplicate "CLINIC"[\s\S]*dialCode[\s\S]*password/);
    expect(validateLeadConfig(null).ok).toBe(false);
  });
  it('needs at least one active provider type, module and market', () => {
    const d = JSON.parse(JSON.stringify(DEFAULT_LEAD_CONFIG)); d.markets[0].active = false;
    const r = validateLeadConfig(d); expect(r.ok).toBe(false);
  });
  it('every status has a path out except by design and no transition leaves the set', () => {
    for (const s of LEAD_STATUSES) { expect(LEAD_TRANSITIONS[s].length).toBeGreaterThan(0); for (const t of LEAD_TRANSITIONS[s]) expect(LEAD_STATUSES).toContain(t); }
    expect(LEAD_TRANSITIONS.NEW).not.toContain('WON'); // no jumping to won
  });
});

describe('csv', () => {
  it('quotes, escapes and defuses formulas; keeps E.164 phones; BOM for Excel', () => {
    expect(csvCell('a,b')).toBe('"a,b"'); expect(csvCell('say "hi"')).toBe('"say ""hi"""'); expect(csvCell('=1+1')).toBe("'=1+1"); expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('+201001234567')).toBe('+201001234567'); expect(csvCell('+SUM(A1)')).toBe("'+SUM(A1)");
    expect(csvCell(['a', 'b'])).toBe('a; b'); expect(csvCell(null)).toBe(''); expect(csvCell(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-01T00:00:00.000Z');
    const out = toCsv(['h'], [['x'], ['y']]); expect(out.startsWith('﻿')).toBe(true); expect(out).toContain('h\r\nx\r\ny');
  });
});

describe('acknowledgement', () => {
  it('carries the reference, no contact details, both languages', () => {
    const n = { id: 'ld_1', ref: 'KL-ABCD2345', providerType: 'CLINIC', mode: 'STANDALONE', locale: 'ar' as const, email: 'a@b.co' };
    expect(ackMessage(n).body).toContain('KL-ABCD2345'); expect(ackMessage({ ...n, locale: 'en' }).subject).toContain('KL-ABCD2345');
    expect(JSON.stringify(ackMessage(n))).not.toContain('a@b.co');
  });
});
