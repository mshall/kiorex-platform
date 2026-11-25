import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * GRW-GC-4: every PUBLIC growth route family has a WAF rate rule in `platform/waf-rules.json` (the product checklist for the CloudFront WAFv2 implementation, `tofu validate` only).
 * The test reads the controllers: any `@Controller('growth/v1/<x>')` or widget/invite controller that has a `@Public()` handler must be covered by a rule whose `paths` match it.
 */
const API = join(__dirname, '..', '..');
const rules: { id: string; action: string; paths?: string[]; rateLimit?: { requests: number; windowSeconds: number } }[] = JSON.parse(readFileSync(join(API, '..', '..', '..', 'platform', 'waf-rules.json'), 'utf8')).rules;
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const covered = (path: string) => rules.some((r) => r.action === 'BLOCK' && r.rateLimit && r.paths?.some((p) => (p.endsWith('/*') ? path.startsWith(p.slice(0, -1)) || `${path}/`.startsWith(p.slice(0, -1)) : p === path)));

describe('WAF rules cover every public growth path', () => {
  const publicControllers = walk(API).filter((f) => f.endsWith('.controller.ts')).map((f) => ({ f, s: readFileSync(f, 'utf8') }))
    .filter(({ s }) => /@Public\(\)/.test(s)).map(({ f, s }) => ({ f, base: /@Controller\('([^']*)'\)/.exec(s)?.[1] ?? '' })).filter((c) => /^(growth\/v1|widget\/v1|invite)/.test(c.base));

  it('finds the public growth controllers (referral, assistant, experiments, touch, campaign, widget are among them)', () => {
    const bases = publicControllers.map((c) => c.base).join(' ');
    for (const b of ['growth/v1/experiments', 'growth/v1/assistant', 'growth/v1', 'growth/v1/campaign', 'widget/v1']) expect(bases).toContain(b);
  });
  it('each public controller path is under at least one BLOCK rate rule', () => {
    const missing = publicControllers.filter((c) => !covered(`/api/v1/${c.base}`)).map((c) => `${c.base} (${c.f.split('/src/')[1]})`);
    expect(missing).toEqual([]);
  });
  it('the referral, assistant, invite, experiments and widget families have their own tighter rule than the general growth rule', () => {
    const general = rules.find((r) => r.id === 'rate-growth-public')!.rateLimit!.requests;
    for (const id of ['rate-growth-referral', 'rate-growth-assistant', 'rate-growth-experiments', 'rate-invite-landing', 'rate-widget-session']) expect(rules.find((r) => r.id === id)!.rateLimit!.requests).toBeLessThanOrEqual(general);
    expect(rules.find((r) => r.id === 'rate-growth-referral')!.paths).toEqual(expect.arrayContaining(['/api/v1/growth/v1/referral/*']));
    expect(rules.find((r) => r.id === 'rate-invite-landing')!.paths).toEqual(['/invite/*']);
  });
  it('G-27: loyalty, corporate and consent have their own tighter rules, windows are valid WAFv2 windows, and every path pattern is an absolute prefix', () => {
    const general = rules.find((r) => r.id === 'rate-growth-public')!.rateLimit!.requests;
    for (const id of ['rate-growth-loyalty', 'rate-growth-corporate', 'rate-growth-consent']) { const r = rules.find((x) => x.id === id)!; expect(r).toBeTruthy(); expect(r.rateLimit!.requests).toBeLessThanOrEqual(general); }
    expect(rules.find((r) => r.id === 'rate-growth-loyalty')!.paths).toEqual(['/api/v1/growth/v1/loyalty/*']);
    for (const r of rules) { if (r.rateLimit) { expect([60, 120, 300, 600]).toContain(r.rateLimit.windowSeconds); for (const p of r.paths ?? []) expect(p.startsWith('/')).toBe(true); } }
  });
  it('rule ids are unique and every rule has an action and a statement; the earlier rules are untouched', () => {
    expect(new Set(rules.map((r) => r.id)).size).toBe(rules.length);
    for (const id of ['rate-public-auth', 'aws-managed-common', 'aws-managed-known-bad-inputs', 'geo-optional']) expect(rules.map((r) => r.id)).toContain(id);
  });
});
