import { chooseMarket, isProviderLinkCode, isRefCode, isSafeSegment, looksLikeUrlOrTraversal, normalizeCc, normalizeLocale, normalizeProviderCode, URL_VALUED_PARAMS } from './deep-link-rules';

const MALICIOUS = [
  'https://evil.example', 'http://evil.example/x', '//evil.example', '/\\evil.example', '\\\\evil.example', 'javascript:alert(1)', 'data:text/html,<script>1</script>', 'kiorex://evil',
  '../../etc/passwd', '..%2f..%2fx', '%2e%2e/%2e%2e', '%252e%252e%252f', 'a/b', 'a\\b', 'a b', 'a%00b', 'a\u0000b', 'a\nb', 'a?x=1', 'a#frag', 'a@evil.example', 'kiorex.com@evil.example', '<script>', '"><img src=x>', "' OR 1=1 --", ''.padEnd(500, 'a'), '.', '..', '-abc', '‮abc', 'ａｂｃ',
];

describe('link parameter validators (GRW-P1-H)', () => {
  it('provider link codes: 8 Crockford base32 characters (no I L O U), case-insensitive input', () => {
    expect(isProviderLinkCode('7XK2M9QP')).toBe(true);
    expect(normalizeProviderCode('7xk2m9qp')).toBe('7XK2M9QP');
    for (const bad of ['7XK2M9Q', '7XK2M9QPP', '7XK2M9QI', '7XK2M9QL', '7XK2M9QO', '7XK2M9QU', '7XK2M9Q!', '', '        ']) { expect(isProviderLinkCode(bad)).toBe(false); expect(normalizeProviderCode(bad)).toBeNull(); }
    expect(normalizeProviderCode(undefined)).toBeNull();
    expect(normalizeProviderCode(['7XK2M9QP'])).toBeNull();
  });
  it('referral codes: 4 to 16 alphanumerics', () => {
    for (const ok of ['ABCD', 'abcd1234', 'A1b2C3d4E5f6G7h8']) expect(isRefCode(ok)).toBe(true);
    for (const bad of ['ABC', 'A1b2C3d4E5f6G7h8X', 'AB-CD', 'AB CD', 'AB.CD']) expect(isRefCode(bad)).toBe(false);
  });
  it('every malicious value is rejected by every validator', () => {
    for (const m of MALICIOUS) {
      expect(isRefCode(m)).toBe(false); expect(isProviderLinkCode(m)).toBe(false); expect(normalizeProviderCode(m)).toBeNull(); expect(isSafeSegment(m)).toBe(false);
      expect(normalizeCc(m)).toBeNull();
    }
  });
  it('safe segments: ids and ASCII slugs only', () => {
    for (const ok of ['dr-amira-samy', 'clx9a8b7c0001', 'A_b-1']) expect(isSafeSegment(ok)).toBe(true);
    for (const bad of ['..', '.', 'a/b', 'a.b', 'د-أمير', '']) expect(isSafeSegment(bad)).toBe(false);
  });
  it('locale falls back to ar; cc is two letters only', () => {
    expect(normalizeLocale('EN')).toBe('en'); expect(normalizeLocale('fr')).toBe('ar'); expect(normalizeLocale('https://x')).toBe('ar'); expect(normalizeLocale(undefined, 'en')).toBe('en');
    expect(normalizeCc('EG')).toBe('eg'); expect(normalizeCc('egy')).toBeNull(); expect(normalizeCc('e')).toBeNull(); expect(normalizeCc('1a')).toBeNull();
  });
  it('market routing: a live link cc wins; a non-live or malformed cc falls back to the live default; never throws', () => {
    expect(chooseMarket('sa', ['EG', 'SA'], 'EG')).toBe('SA');
    expect(chooseMarket('sa', ['EG'], 'EG')).toBe('EG'); // SA is not live
    expect(chooseMarket('zz', ['EG'], 'EG')).toBe('EG');
    expect(chooseMarket('https://evil', ['EG'], 'EG')).toBe('EG');
    expect(chooseMarket(undefined, ['EG'], 'EG')).toBe('EG');
    expect(chooseMarket('eg', [], 'EG')).toBe('EG');
    expect(chooseMarket('sa', ['AE'], 'EG')).toBe('AE'); // default not live: first live market
  });
  it('detects URL-like and traversal values including double encoding', () => {
    for (const m of ['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', 'data:text/html,x', 'kiorex://evil', '../../etc/passwd', '..%2f..%2fx', '%2e%2e/%2e%2e', '%252e%252e%252f', 'a/b', 'a\\b', 'a%00b', 'a\u0000b', 'a\nb', '%zz']) expect({ m, v: looksLikeUrlOrTraversal(m) }).toEqual({ m, v: true });
    expect(looksLikeUrlOrTraversal('dr-amira-samy')).toBe(false);
  });
  it('the URL-valued parameter list covers the usual redirect names', () => { for (const n of ['to', 'url', 'redirect', 'next', 'returnTo', 'continue']) expect(URL_VALUED_PARAMS).toContain(n); });
});
