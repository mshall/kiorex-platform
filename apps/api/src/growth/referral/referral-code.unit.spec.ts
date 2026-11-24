import { REFERRAL_CODE_ALPHABET, isValidReferralCode } from '@kiorex/contracts';
import { generateReferralCode, inviteDeepLink, inviteUrl, isAcceptableCode, normalizeReferralCode, shareText } from './referral-code';

describe('referral codes', () => {
  it('generates 8 Crockford characters from the contract alphabet, 2,000 times, all acceptable and mostly distinct', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) { const c = generateReferralCode(); expect(isValidReferralCode(c)).toBe(true); expect(isAcceptableCode(c)).toBe(true); seen.add(c); }
    expect(seen.size).toBeGreaterThan(1990);
    for (const ch of 'ILOU') expect(REFERRAL_CODE_ALPHABET).not.toContain(ch);
  });
  it.each([['AAAA1234', false], ['A1B2C3D4', true], ['12345678', true], ['1AB11112', false], ['AB12AB12', true], ['AAB1AAB1', false], ['K7SEX2M9', false], ['XNAZI123', false], ['ZEB45678', false], ['abc', false], ['A1B2C3DU', false]])('acceptability of %s is %s', (code, ok) => { expect(isAcceptableCode(code)).toBe(ok); });
  it('the deny list also rejects at generation: a generator that always returns a banned word gives up loudly', () => {
    expect(() => generateReferralCode(() => 0)).toThrow(/exhausted/);
  });
  it.each([['k7q2-m9xa', 'K7Q2M9XA'], [' k7q2 m9xa ', 'K7Q2M9XA'], ['O1I1L1O1', '01111101'], ['K7Q2M9X', null], ['K7Q2M9XAB', null], ['K7Q2M9XU', null], [undefined, null], [42, null], ['x'.repeat(100), null]])('normalises %j to %j', (raw, out) => { expect(normalizeReferralCode(raw)).toBe(out); });
  it('invite links: locale and market in the path, noindex page, deep link, Arabic and English share text without a name', () => {
    expect(inviteUrl('K7Q2M9XA')).toBe('https://kiorex.com/ar/eg/invite/K7Q2M9XA');
    expect(inviteUrl('K7Q2M9XA', { locale: 'en', market: 'EG' })).toBe('https://kiorex.com/en/eg/invite/K7Q2M9XA');
    expect(inviteUrl('K7Q2M9XA', { locale: 'zz', market: 'bad' })).toBe('https://kiorex.com/ar/eg/invite/K7Q2M9XA');
    expect(inviteDeepLink('K7Q2M9XA')).toBe('kiorex://invite/K7Q2M9XA');
    expect(shareText('K7Q2M9XA', { locale: 'en' })).toContain('/en/eg/invite/K7Q2M9XA');
    expect(shareText('K7Q2M9XA')).toMatch(/[؀-ۿ]/);
  });
});
