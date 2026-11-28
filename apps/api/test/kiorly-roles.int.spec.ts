import { RequestMethod } from '@nestjs/common';
import { ModulesContainer, Reflector } from '@nestjs/core';
import { IS_PUBLIC, ROLES_KEY } from '../src/common/auth';
import { KIORLY_ALLOW, kiorlyLevelOf, kiorlyRouteKey } from '../src/auth/kiorly-roles';
import { createCtx, TestCtx } from './harness';

/**
 * ADR-062: the Kiorly-only roles `kiorly_ops` and `kiorly_admin` are DENY BY DEFAULT. This suite builds the route table of the running application
 * (every controller, every handler, from Nest's own metadata) and proves, for the whole table and not for a hand-written sample:
 *   - every route that is not on the allow-list answers 403 FORBIDDEN_ROLE for both roles (a NEW route is therefore closed to them until it is listed),
 *   - every allow-listed route exists (no dead entry), is reachable (never 401/403) with the right level, and `admin` entries stay closed to kiorly_ops,
 *   - a token that mixes a Kiorly role with any other role is refused everywhere (FORBIDDEN_MIXED_ROLES),
 *   - the existing roles are unchanged on a sample of routes.
 */
interface Row { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string; pub: boolean; roles?: string[] }
const M: Record<number, Row['method']> = { [RequestMethod.GET]: 'GET', [RequestMethod.POST]: 'POST', [RequestMethod.PUT]: 'PUT', [RequestMethod.PATCH]: 'PATCH', [RequestMethod.DELETE]: 'DELETE' };

function routeTable(c: TestCtx): Row[] {
  const refl = new Reflector(); const rows: Row[] = [];
  const wrappers = [...c.app.get(ModulesContainer, { strict: false }).values()].flatMap((m) => [...m.controllers.values()]);
  for (const w of wrappers) {
    const inst = w.instance as Record<string, unknown> | undefined; const cls = w.metatype as Function | null;
    if (!inst || !cls) continue;
    const cps = ([] as string[]).concat((Reflect.getMetadata('path', cls) as string | string[] | undefined) ?? '');
    for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(inst))) {
      const h = (inst as any)[name]; if (name === 'constructor' || typeof h !== 'function') continue;
      const m = M[Reflect.getMetadata('method', h) as number]; if (!m) continue;
      const hps = ([] as string[]).concat((Reflect.getMetadata('path', h) as string | string[] | undefined) ?? '');
      const pub = !!refl.getAllAndOverride<boolean>(IS_PUBLIC, [h, cls]); const roles = refl.getAllAndOverride<string[] | undefined>(ROLES_KEY, [h, cls]);
      for (const cp of cps) for (const hp of hps) rows.push({ method: m, path: `${cp}/${hp}`.split('/').filter(Boolean).join('/'), pub, roles });
    }
  }
  return rows;
}
const url = (path: string) => `/api/v1/${path.replace(/:[A-Za-z]+/g, 'x1')}`;

describe('Kiorly-only roles: deny by default, explicit allow-list (ADR-062)', () => {
  let c: TestCtx; let table: Row[];
  const tok = async (roles: string[]) => ({ Authorization: `Bearer ${await c.token({ sub: `k_${roles.join('_')}`, roles })}` });
  const call = async (r: Row, h: { Authorization: string }) => { const q = (c.http() as any)[r.method.toLowerCase()](url(r.path)).set(h); return r.method === 'GET' || r.method === 'DELETE' ? q : q.send({}); };
  beforeAll(async () => { c = await createCtx(); table = routeTable(c); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => { await c.reset(); });

  it('the route table is real: it holds hundreds of routes, public ones are known and the allow-list is a small subset', () => {
    expect(table.length).toBeGreaterThan(300);
    expect(table.some((r) => r.pub)).toBe(true);
    expect(table.filter((r) => !r.pub && r.method === 'GET' && r.path === 'admin/providers')).toHaveLength(1);
    expect(KIORLY_ALLOW.length).toBeLessThan(table.length / 5);
  });

  it('every allow-list entry names a route that exists and is not public (no dead or misspelled entry)', () => {
    const have = new Set(table.filter((r) => !r.pub).map((r) => kiorlyRouteKey(r.method, r.path)));
    const dead = KIORLY_ALLOW.filter((e) => !have.has(kiorlyRouteKey(e.m, e.path))).map((e) => `${e.m} ${e.path}`);
    expect(dead).toEqual([]);
  });

  it('GENERATED: every authenticated route that is not on the allow-list answers 403 FORBIDDEN_ROLE to kiorly_ops and to kiorly_admin', async () => {
    const closed = table.filter((r) => !r.pub && !kiorlyLevelOf(kiorlyRouteKey(r.method, r.path)));
    expect(closed.length).toBeGreaterThan(300);
    const ops = await tok(['kiorly_ops']); const adm = await tok(['kiorly_admin']); const bad: string[] = [];
    for (const r of closed) for (const [who, h] of [['ops', ops], ['admin', adm]] as const) {
      const res = await call(r, h);
      if (res.status !== 403 || res.body?.code !== 'FORBIDDEN_ROLE') bad.push(`${who} ${r.method} ${r.path} -> ${res.status} ${res.body?.code}`);
    }
    expect(bad).toEqual([]);
  }, 180_000);

  it('GENERATED: every allow-listed route is reachable at its level (never 401 or 403) and admin-level routes stay closed to kiorly_ops', async () => {
    c.kiorly.markets = [];
    const ops = await tok(['kiorly_ops']); const adm = await tok(['kiorly_admin']); const bad: string[] = [];
    for (const e of KIORLY_ALLOW) {
      const r: Row = { method: e.m, path: e.path, pub: false };
      const a = await call(r, adm);
      if (a.status === 401 || (a.status === 403 && a.body?.code === 'FORBIDDEN_ROLE')) bad.push(`admin ${e.m} ${e.path} -> ${a.status} ${a.body?.code}`);
      const o = await call(r, ops);
      if (e.level === 'admin') { if (o.status !== 403 || o.body?.code !== 'FORBIDDEN_ROLE') bad.push(`ops must be refused ${e.m} ${e.path} -> ${o.status}`); }
      else if (o.status === 401 || (o.status === 403 && o.body?.code === 'FORBIDDEN_ROLE')) bad.push(`ops ${e.m} ${e.path} -> ${o.status} ${o.body?.code}`);
    }
    expect(bad).toEqual([]);
  }, 120_000);

  it('the listed reads answer 200 with data of the right shape', async () => {
    c.kiorly.markets = [];
    const h = await tok(['kiorly_ops']);
    for (const p of ['auth/me', 'admin/providers', 'admin/leads', 'admin/leads/summary', 'admin/leads/owners', 'admin/leads/settings', 'admin/partner-leads', 'admin/partner-leads/funnel',
      'admin/onboarding/imports', 'admin/onboarding/partners', 'admin/onboarding/enrolments', 'admin/onboarding/verification-updates', 'admin/commissions/capabilities', 'admin/commissions/policy',
      'admin/commissions/rates/defaults', 'admin/fee-statements', 'admin/kiorly-markets', 'admin/kiorly-plans']) {
      const res = await c.http().get(`/api/v1/${p}`).set(h);
      expect([p, res.status]).toEqual([p, 200]);
    }
    const me = (await c.http().get('/api/v1/auth/me').set(h)).body; expect(me.roles).toEqual(['kiorly_ops']);
    expect((await c.http().get('/api/v1/admin/kiorly-markets').set(h)).body.canChange).toBe(false);
  });

  it('the commission maker-checker, market launch and price approval are super_admin only: both Kiorly roles are refused on each', async () => {
    for (const roles of [['kiorly_ops'], ['kiorly_admin']]) {
      const h = await tok(roles);
      const refused: Array<[string, string]> = [['post', 'admin/commissions/policy/EG/propose'], ['post', 'admin/commissions/policy/versions/v1/decide'], ['post', 'admin/commissions/rates/defaults'],
        ['post', 'admin/commissions/rates/orgs/o1'], ['post', 'admin/commissions/rates/v1/decide'], ['post', 'admin/commissions/config'], ['post', 'admin/commissions/config/v1/decide'],
        ['post', 'admin/kiorly-markets'], ['post', 'admin/kiorly-markets/m1/launch'], ['post', 'admin/kiorly-markets/m1/change-requests/r1/approve'], ['put', 'admin/kiorly-plans/content'],
        ['post', 'admin/kiorly-plans/clinic/p1/prices'], ['post', 'admin/onboarding/partners/p1/approve'], ['put', 'admin/leads/settings'], ['post', 'admin/leads/test/remove']];
      for (const [m, p] of refused) { const r = await (c.http() as any)[m](`/api/v1/${p}`).set(h).send({}); expect([roles[0], m, p, r.status, r.body.code]).toEqual([roles[0], m, p, 403, 'FORBIDDEN_ROLE']); }
    }
  });

  it('a token that mixes a Kiorly role with any other role is refused everywhere, even on a listed route', async () => {
    for (const roles of [['kiorly_ops', 'ops_admin'], ['kiorly_admin', 'super_admin'], ['kiorly_admin', 'patient'], ['kiorly_ops', 'finance'], ['kiorly_ops', 'kiorly_admin', 'growth_admin']]) {
      const h = await tok(roles);
      for (const p of ['admin/providers', 'auth/me', 'admin/pharmacy/orders']) {
        const r = await c.http().get(`/api/v1/${p}`).set(h);
        expect([roles.join(','), p, r.status, r.body.code]).toEqual([roles.join(','), p, 403, 'FORBIDDEN_MIXED_ROLES']);
      }
    }
  });

  it('the existing roles are unchanged: ops_admin and super_admin still read the Kiorex and Kiorly routes, a patient is still refused, nobody is let in without a token', async () => {
    for (const roles of [['ops_admin'], ['super_admin']]) { const h = await tok(roles); expect((await c.http().get('/api/v1/admin/providers').set(h)).status).toBe(200); expect((await c.http().get('/api/v1/admin/leads').set(h)).status).toBe(200); }
    expect((await c.http().get('/api/v1/admin/providers').set(await tok(['patient']))).status).toBe(403);
    expect((await c.http().get('/api/v1/admin/providers')).status).toBe(401);
    expect((await c.http().get('/api/v1/admin/providers').set(await tok(['finance']))).status).toBe(403);
  });

  it('kiorly_ops may review a join request and kiorly_admin may export; the export is closed to kiorly_ops', async () => {
    const o = await tok(['kiorly_ops']); const a = await tok(['kiorly_admin']);
    expect((await c.http().get('/api/v1/admin/leads/export.csv').set(o)).status).toBe(403);
    expect((await c.http().get('/api/v1/admin/leads/export.csv').set(a)).status).toBe(200);
  });
});
