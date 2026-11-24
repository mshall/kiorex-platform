import { buildUtm, token, trackedLinks, utmCampaignOf, validateUtmConfig, UTM_TOKEN, MEDIUM_BY_CHANNEL } from './campaign-utm';
import { UTM_PATTERN } from '../touch/touch-sanitizer';

describe('campaign UTM builder (GRW-P2-A)', () => {
  it('utm_campaign is <market lower case>-<key>', () => { expect(utmCampaignOf('EG', 'ramadan-checkup')).toBe('eg-ramadan-checkup'); });
  it('tokens are lower-case ASCII, hyphenated, capped, and every one passes the touch sanitiser pattern', () => {
    expect(token('Ramadan Check-up 2027!')).toBe('ramadan-check-up-2027');
    expect(token('  Café  Été ')).toBe('cafe-ete');
    expect(token('كلمة')).toBe(''); expect(token('a'.repeat(100), 40)).toHaveLength(40); expect(token('x'.repeat(100), 500)).toHaveLength(64);
    for (const v of ['Hello World', 'a_b-c', '2027 Promo', 'x--y']) { const t = token(v); expect(t === '' || UTM_TOKEN.test(t)).toBe(true); expect(t === '' || UTM_PATTERN.test(t)).toBe(true); }
  });
  it('config validation: tokens, a site-relative target path, a locale; unknown keys rejected', () => {
    expect(validateUtmConfig({ source: 'newsletter', medium: 'email', content: 'banner-a', term: 'checkup', targetPath: '/doctors', locale: 'en' }, 40)).toMatchObject({ valid: true });
    expect(validateUtmConfig(undefined, 40)).toEqual({ valid: true, value: {} });
    for (const bad of [{ source: 'Has Space' }, { source: 'UPPER' }, { source: 'x'.repeat(41) }, { targetPath: 'https://evil.example/' }, { targetPath: '//evil.example' }, { targetPath: '/a/../b' }, { targetPath: 'doctors' }, { locale: 'fr' }, { surprise: 1 }, 'x', []])
      expect(validateUtmConfig(bad, 40).valid).toBe(false);
  });
  it('the medium defaults from the first channel, an explicit one wins, and every channel has a medium', () => {
    expect(buildUtm({ market: 'EG', key: 'k1', channels: ['EMAIL'], config: {} })).toEqual({ utm_source: 'kiorex', utm_medium: 'email', utm_campaign: 'eg-k1' });
    expect(buildUtm({ market: 'EG', key: 'k1', channels: ['PAID_SEARCH'], config: {} }).utm_medium).toBe('cpc');
    expect(buildUtm({ market: 'EG', key: 'k1', channels: ['EMAIL'], config: { medium: 'newsletter', source: 'crm', content: 'a', term: 'b' } })).toEqual({ utm_source: 'crm', utm_medium: 'newsletter', utm_campaign: 'eg-k1', utm_content: 'a', utm_term: 'b' });
    expect(Object.keys(MEDIUM_BY_CHANNEL)).toHaveLength(12);
    for (const m of Object.values(MEDIUM_BY_CHANNEL)) expect(UTM_TOKEN.test(m)).toBe(true);
  });
  it('tracked links live on the public host with locale and market, carry every utm parameter, and the app link is the same universal link', () => {
    const l = trackedLinks({ market: 'EG', key: 'k1', channels: ['EMAIL'], config: { targetPath: '/doctors', content: 'banner' }, host: 'https://kiorex.com/' });
    expect(l.webUrl).toBe('https://kiorex.com/ar/eg/doctors?utm_source=kiorex&utm_medium=email&utm_campaign=eg-k1&utm_content=banner');
    expect(l.appLink).toBe(l.webUrl); expect(l.landingPath).toBe('/ar/eg/doctors');
    expect(trackedLinks({ market: 'EG', key: 'k1', channels: ['SMS'], config: { locale: 'en' }, host: 'https://kiorex.com' }).landingPath).toBe('/en/eg');
    expect(trackedLinks({ market: 'SA', key: 'k1', channels: ['SMS'], config: {}, host: 'https://kiorex.com', locale: 'en' }).webUrl).toContain('/en/sa?');
    expect(new URL(l.webUrl).searchParams.get('utm_campaign')).toBe('eg-k1');
  });
});
