import { NotFoundException } from '@nestjs/common';
import { SiteRoleGuard } from './site-mounter';
import { siteCfg } from './site.config';

const ctx = (url: string) => ({ switchToHttp: () => ({ getRequest: () => ({ originalUrl: url }) }) }) as never;

describe('site role selection (ADR-043: a role of the Kiorex API image)', () => {
  const keep = { ...process.env };
  afterEach(() => { process.env = { ...keep }; });
  it('defaults to role all, development, not indexable', () => {
    delete process.env.SITE_ROLE; delete process.env.SITE_ENVIRONMENT;
    expect(siteCfg()).toMatchObject({ role: 'all', mounted: true, environment: 'development', indexable: false });
  });
  it('api role mounts nothing; SITE_ENABLED=false is a hard off-switch; only production is indexable', () => {
    process.env.SITE_ROLE = 'api'; expect(siteCfg().mounted).toBe(false);
    process.env.SITE_ROLE = 'site'; process.env.SITE_ENABLED = 'false'; expect(siteCfg().mounted).toBe(false);
    process.env.SITE_ENABLED = 'true'; process.env.SITE_ENVIRONMENT = 'production'; expect(siteCfg()).toMatchObject({ mounted: true, indexable: true });
    process.env.SITE_ENVIRONMENT = 'staging'; expect(siteCfg().indexable).toBe(false);
    process.env.SITE_ENVIRONMENT = 'bogus'; expect(siteCfg().indexable).toBe(false);
  });
  it('site role refuses the /api/v1 surface except health; other roles allow everything', () => {
    const g = new SiteRoleGuard();
    process.env.SITE_ROLE = 'site';
    expect(() => g.canActivate(ctx('/api/v1/search/providers'))).toThrow(NotFoundException);
    expect(g.canActivate(ctx('/api/v1/health/live'))).toBe(true);
    expect(g.canActivate(ctx('/api/v1/health/ready'))).toBe(true);
    process.env.SITE_ROLE = 'all';
    expect(g.canActivate(ctx('/api/v1/search/providers'))).toBe(true);
  });
  it('the canonical host is configuration, never derived from a request', () => {
    process.env.SITE_CANONICAL_HOST = 'https://www.staging.kiorex.com/';
    expect(siteCfg().canonicalHost).toBe('https://www.staging.kiorex.com');
    expect(siteCfg().frameAncestors).toEqual([]);
  });
});
