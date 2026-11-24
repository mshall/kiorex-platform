import { SeoGateTriggerService } from './seo-trigger.service';

const mk = (enabled = true, fail = false) => {
  const runs: unknown[] = [];
  const seo: any = { run: async (o: unknown) => { runs.push(o); if (fail) throw new Error('boom'); return {}; } };
  const flags: any = { isEnabled: async () => enabled };
  return { svc: new SeoGateTriggerService(seo, flags), runs };
};

describe('SEO gate event trigger', () => {
  it('coalesces many requests of one market into one run and records every reason', async () => {
    const { svc, runs } = mk();
    svc.request('profile-updated'); svc.request('slug-changed'); svc.request('profile-updated');
    expect(svc.pendingMarkets()).toEqual(['EG']);
    const r = await svc.flush('EG');
    expect(r).toEqual({ ran: true, reasons: ['profile-updated', 'slug-changed'] });
    expect(runs).toHaveLength(1);
    expect(svc.pendingMarkets()).toEqual([]);
    svc.onModuleDestroy();
  });
  it('does nothing while growth.seo_automation is OFF and never throws when the run fails', async () => {
    const off = mk(false); off.svc.request('listing-status');
    expect((await off.svc.flush('EG')).ran).toBe(false); expect(off.runs).toHaveLength(0);
    const bad = mk(true, true); bad.svc.request('listing-status');
    await expect(bad.svc.flush('EG')).resolves.toMatchObject({ ran: false });
  });
  it('a flush with nothing pending is a no-op', async () => { expect(await mk().svc.flush('EG')).toEqual({ ran: false, reasons: [] }); });
});
