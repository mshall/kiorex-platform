import { allowedOrigins, devOrigins, frameAncestorsOf, isOriginAllowed, originOfUrl, sanitizeRegisteredOrigins, widgetSelfOrigin } from './widget-origins';

describe('widget origins (GRW-P1-G)', () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; });

  it('stores only contract-valid exact https origins: wildcard, http, paths, userinfo, duplicates and the 11th origin never survive', () => {
    const many = Array.from({ length: 14 }, (_, i) => `https://s${i}.example.com`);
    expect(sanitizeRegisteredOrigins(['https://clinic.example', 'https://*.example.com', 'http://clinic.example', 'https://clinic.example/path', 'https://user@clinic.example', 'https://CLINIC.example', 'https://localhost', 'javascript:alert(1)', 5, null])).toEqual(['https://clinic.example']);
    expect(sanitizeRegisteredOrigins(many)).toHaveLength(10);
    expect(sanitizeRegisteredOrigins('https://a.example')).toEqual([]);
  });

  it('frame-ancestors is the exact list, or none; never a wildcard even if one was somehow stored', () => {
    expect(frameAncestorsOf([])).toBe("'none'");
    expect(frameAncestorsOf(['https://a.example', 'https://b.example:8443'])).toBe('https://a.example https://b.example:8443');
    const stored = allowedOrigins(['https://*', '*', 'https://ok.example']);
    expect(stored).toEqual(['https://ok.example']);
    expect(frameAncestorsOf(stored)).not.toContain('*');
  });

  it('matches exactly: no subdomain, suffix or scheme confusion', () => {
    const allowed = ['https://clinic.example'];
    expect(isOriginAllowed('https://clinic.example', allowed)).toBe(true);
    expect(isOriginAllowed('HTTPS://CLINIC.EXAMPLE', allowed)).toBe(true);
    for (const bad of ['https://evil.clinic.example', 'https://clinic.example.evil.test', 'http://clinic.example', 'https://clinic.example:444', 'https://notclinic.example', '', null, undefined, 'null']) expect(isOriginAllowed(bad as string, allowed)).toBe(false);
  });

  it('originOfUrl never throws and reduces a URL to its origin', () => {
    expect(originOfUrl('https://Clinic.Example/a/b?x=1#h')).toBe('https://clinic.example');
    expect(originOfUrl('ftp://x.example')).toBeNull();
    expect(originOfUrl('not a url')).toBeNull();
    expect(originOfUrl(undefined)).toBeNull();
    expect(originOfUrl('https://x.example/' + 'a'.repeat(3000))).toBeNull();
  });

  it('dev origins exist only outside production/staging and only for localhost over http', () => {
    process.env.WIDGET_DEV_ORIGINS = 'http://localhost:4392, http://127.0.0.1:4392, http://evil.example, https://x.example';
    process.env.NODE_ENV = 'test'; delete process.env.SITE_ENVIRONMENT;
    expect(devOrigins()).toEqual(['http://localhost:4392', 'http://127.0.0.1:4392']);
    process.env.NODE_ENV = 'production';
    expect(devOrigins()).toEqual([]);
    process.env.NODE_ENV = 'test'; process.env.SITE_ENVIRONMENT = 'staging';
    expect(devOrigins()).toEqual([]);
  });

  it('the widget own origin comes from configuration, https in production, never from a forwarded header', () => {
    process.env.WIDGET_HOST = 'book.kiorex.com';
    expect(widgetSelfOrigin('http', 'attacker.example')).toBe('https://book.kiorex.com');
    delete process.env.WIDGET_HOST; process.env.NODE_ENV = 'test';
    expect(widgetSelfOrigin('http', 'localhost:4000')).toBe('http://localhost:4000');
  });
});
