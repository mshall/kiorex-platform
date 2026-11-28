// The console's access table is plain TypeScript without imports. It is loaded at run time (not as a typed import) because it lives outside this package's rootDir.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { canOpen, CONSOLE_ROLES } = require('../../ops/src/lib/roleAccess') as { canOpen: (roles: readonly string[], path: string) => boolean; CONSOLE_ROLES: readonly string[] };
import { createCtx, TestCtx } from './harness';

/**
 * The Ops console shows a role only the routes its access table (apps/ops/src/lib/roleAccess.ts) allows. This proves the table never OFFERS what the API refuses:
 * for every console route with a probe endpoint and every console role, canOpen => the API does not answer 403 FORBIDDEN_ROLE (the table may hide more than the API refuses, never less).
 */
const PROBES: Array<[string, string]> = [
  ['/providers', 'admin/providers'], ['/bookings', 'admin/bookings'], ['/outbox', 'admin/outbox'], ['/finance', 'admin/payments/dashboard'], ['/moderation', 'admin/moderation'],
  ['/liquidity', 'admin/liquidity'], ['/messaging', 'admin/messaging/stats'], ['/orders', 'admin/pharmacy/orders'], ['/fees', 'admin/fee-statements'], ['/policy', 'admin/policy'],
  ['/safety', 'admin/safety/summary'], ['/held-deposits', 'admin/payments/held-for-review'], ['/payments-connection', 'admin/payments/settings'], ['/reconciliation', 'admin/reconciliation/runs'],
  ['/home-gate', 'admin/home-visits/gate-metric'], ['/flags', 'admin/flags'], ['/commissions', 'admin/commissions/summary'], ['/commission-policy', 'admin/commissions/policy'],
  ['/pay-ops', 'admin/payments/matching/queue'], ['/leads', 'admin/leads'], ['/partner-leads', 'admin/partner-leads'], ['/onboarding', 'admin/onboarding/imports'],
  ['/partner-onboarding', 'admin/onboarding/partners'], ['/kiorly-markets', 'admin/kiorly-markets'], ['/kiorly-plans', 'admin/kiorly-plans'], ['/growth', 'ops/growth/overview'],
  ['/growth-analytics', 'ops/growth-analytics/overview'],
];

describe('console access table vs the API', () => {
  let c: TestCtx;
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => { await c.reset(); });

  it('canOpen never offers a route whose data call the API refuses with FORBIDDEN_ROLE', async () => {
    const bad: string[] = [];
    for (const role of CONSOLE_ROLES) {
      const h = { Authorization: `Bearer ${await c.token({ sub: `m_${role}`, roles: [role] })}` };
      for (const [path, api] of PROBES) {
        if (!canOpen([role], path)) continue;
        const r = await c.http().get(`/api/v1/${api}`).set(h);
        if (r.status === 403 && r.body?.code === 'FORBIDDEN_ROLE') bad.push(`${role} ${path} -> ${api}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('every console role holds at least its home and the table refuses a role nobody lists', () => {
    for (const r of CONSOLE_ROLES) expect(canOpen([r], '/home')).toBe(true);
    expect(canOpen(['patient'], '/home')).toBe(false);
    expect(canOpen([], '/providers')).toBe(false);
  });
});
