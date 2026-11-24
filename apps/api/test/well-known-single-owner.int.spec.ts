import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createCtx, TestCtx } from './harness';

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') && !p.endsWith('.spec.ts') ? [p] : []; });

/** Packages E (public site) and H (deep links) once both wanted /.well-known/*: exactly ONE module owns the route (H, market/app-links.controller.ts); E never registers it. */
describe('/.well-known/* has exactly one owner', () => {
  let c: TestCtx;
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });

  it('only market/app-links.controller.ts declares a .well-known route in the source tree', () => {
    const src = join(__dirname, '../src');
    const owners = walk(src).filter((f) => /@Controller\(\s*['"]\/?\.well-known|\.(get|use|all)\(\s*\[?\s*['"]\/\.well-known/.test(readFileSync(f, 'utf8')));
    expect(owners.map((f) => f.slice(src.length + 1))).toEqual(['market/app-links.controller.ts']);
  });

  it.each(['/.well-known/apple-app-site-association', '/.well-known/assetlinks.json'])('%s answers JSON with no redirect and no HTML shell', async (path) => {
    const r = await c.http().get(path).redirects(0);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/application\/json/);
    expect(r.text).not.toMatch(/<html/i);
  });

  it('/.well-known/security.txt (RFC 9116) answers text with Contact and Expires, no redirect; the contact is a flagged placeholder until a person sets SECURITY_CONTACT', async () => {
    const r = await c.http().get('/.well-known/security.txt').redirects(0);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/plain/);
    expect(r.text).toMatch(/^Contact: .+$/m); expect(r.text).toMatch(/^Expires: \d{4}-\d{2}-\d{2}T/m);
    expect(r.text).toContain('TODO_NEEDS_HUMAN'); expect(r.headers['x-kiorex-security-txt']).toBe('placeholder');
    process.env.SECURITY_CONTACT = 'mailto:security@example.test';
    try { const s = await c.http().get('/.well-known/security.txt'); expect(s.text).toContain('Contact: mailto:security@example.test'); expect(s.text).not.toContain('TODO_NEEDS_HUMAN'); } finally { delete process.env.SECURITY_CONTACT; }
  });
});
