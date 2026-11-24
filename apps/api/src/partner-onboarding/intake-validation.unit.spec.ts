import { parseIntakeBody } from './intake-validation';

const base = { nonce: 'abcdefghijklmnop1234', kind: 'CLINIC', orgRef: 'org_1', name: 'Nile Clinic' };
const code = (o: object) => { try { parseIntakeBody(JSON.stringify(o)); return 'OK'; } catch (e: any) { return e.code; } };
const lab = { ...base, kind: 'LAB', baseUrl: 'http://localhost:3200/', clientKey: 'k', clientSecret: 's', webhookSecret: 'w' };

describe('partner intake validation (strict)', () => {
  it('accepts a minimal clinic request and a full lab request', () => {
    expect(code(base)).toBe('OK');
    expect(parseIntakeBody(JSON.stringify(lab)).baseUrl).toBe('http://localhost:3200');
  });
  it('refuses unknown fields, bad JSON, arrays and wrong kinds', () => {
    expect(code({ ...base, extra: 1 })).toBe('INVALID_REQUEST');
    expect(parseIntakeBody.bind(null, '{')).toThrow();
    expect(code([] as any)).toBe('INVALID_REQUEST');
    expect(code({ ...base, kind: 'BANK' })).toBe('INVALID_KIND');
  });
  it('checks nonce, orgRef, market, email, locale, statusToken and control characters', () => {
    expect(code({ ...base, nonce: 'short' })).toBe('INVALID_REQUEST');
    expect(code({ ...base, orgRef: 'a b' })).toBe('INVALID_REQUEST');
    expect(code({ ...base, orgRef: 'x'.repeat(81) })).toBe('INVALID_REQUEST');
    expect(code({ ...base, market: 'EGY' })).toBe('INVALID_REQUEST');
    expect(code({ ...base, contactEmail: 'nope' })).toBe('INVALID_REQUEST');
    expect(code({ ...base, locale: 'fr' })).toBe('INVALID_REQUEST');
    expect(code({ ...base, statusToken: 'short' })).toBe('INVALID_REQUEST');
    expect(code({ ...base, name: 'bad\u0000name' })).toBe('INVALID_REQUEST');
    expect(code({ ...base, name: 12 })).toBe('INVALID_REQUEST');
  });
  it('pharmacy and lab need a host baseUrl and all three credentials; clinic and nurse must not send them', () => {
    expect(code({ ...lab, baseUrl: 'http://h/path' })).toBe('INVALID_BASE_URL');
    expect(code({ ...lab, clientSecret: '' })).toBe('CREDENTIALS_REQUIRED');
    expect(code({ ...base, clientKey: 'k' })).toBe('INVALID_REQUEST');
  });
  it('caps the readiness snapshot', () => {
    expect(code({ ...base, readiness: { a: 'x'.repeat(9000) } })).toBe('READINESS_TOO_LARGE');
    expect(code({ ...base, readiness: [] })).toBe('INVALID_REQUEST');
  });
});
