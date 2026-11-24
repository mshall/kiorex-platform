import { createCtx, seedProvider, TestCtx } from './harness';
import { FakeKiorly } from './fake-kiorly';
import { CatalogService } from '../src/catalog/catalog-public';

const soon = (h: number) => { const d = new Date(Date.now() + h * 3600_000); d.setUTCMinutes(0, 0, 0); return { startsAt: d.toISOString(), endsAt: new Date(d.getTime() + 1800_000).toISOString() }; };

describe('catalog & search (KXM-DS-01..08, KXM-PR)', () => {
  let c: TestCtx;
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => { await c.reset(); });

  it('KXM-DS-07 sync: upserts providers, signs requests, uses updatedSince cursor, never regresses source version', async () => {
    const t1 = new Date(Date.now() - 60_000).toISOString();
    c.kiorly.providers.push(FakeKiorly.provider({ id: 'lst_1', updatedAt: t1, nameEn: 'Dr One' }));
    const svc = c.get(CatalogService);
    expect((await svc.syncOnce()).upserted).toBe(1);
    expect(c.kiorly.bad).toBe(0);
    expect(c.kiorly.callsTo('GET', '/providers')[0].path).toBe('/providers');
    // second sync passes the cursor; nothing newer
    c.kiorly.calls = [];
    await svc.syncOnce();
    expect(c.kiorly.calls).toHaveLength(1);
    // stale update is skipped
    c.kiorly.providers = [FakeKiorly.provider({ id: 'lst_1', updatedAt: new Date(Date.now() - 3600_000).toISOString(), nameEn: 'Old Name' })];
    const r = await svc.syncOnce({ full: true });
    expect(r.skipped).toBe(1);
    expect((await c.prisma.provider.findUniqueOrThrow({ where: { id: 'lst_1' } })).nameEn).toBe('Dr One');
  });

  it('full resync marks providers Kiorly no longer lists as DELISTED', async () => {
    await seedProvider(c, { id: 'lst_gone' });
    c.kiorly.providers = [];
    await c.get(CatalogService).syncOnce({ full: true });
    expect((await c.prisma.provider.findUniqueOrThrow({ where: { id: 'lst_gone' } })).status).toBe('DELISTED');
  });

  it('KXM-DS-01..04 search: specialty/name/symptom, filters, sorts, 3 inline slots, PAUSED hidden', async () => {
    c.kiorly.slots = [soon(30), soon(31), soon(32), soon(33)];
    await seedProvider(c, { id: 'lst_a', clinicianId: 'dr_a', nameEn: 'Dr Sara Hassan', specialty: 'dermatology', fee: 300, area: 'Maadi' });
    await seedProvider(c, { id: 'lst_b', clinicianId: 'dr_b', nameEn: 'Dr Karim Adel', nameAr: 'د. كريم عادل', specialty: 'cardiology', fee: 600, area: 'Nasr City', gender: 'MALE', languages: ['ar'], lat: 30.05, lng: 31.34 });
    await seedProvider(c, { id: 'lst_p', clinicianId: 'dr_p', nameEn: 'Dr Paused', specialty: 'dermatology', status: 'PAUSED' });
    await c.prisma.provider.update({ where: { id: 'lst_b' }, data: { ratingAvg: 4.8, ratingCount: 10 } });
    const s = (q: string) => c.http().get(`/api/v1/search/providers?${q}`).expect(200).then((r) => r.body);
    let r = await s('specialty=dermatology');
    expect(r.items.map((i: any) => i.id)).toEqual(['lst_a']); // paused excluded
    expect(r.items[0].nextSlots).toHaveLength(3);
    expect(r.items[0].bookable).toBe(true);
    expect((await s('q=Karim')).items[0].id).toBe('lst_b'); // doctor name
    expect((await s('q=%D9%83%D8%B1%D9%8A%D9%85')).items[0].id).toBe('lst_b'); // Arabic name
    expect((await s('q=skin rash')).items[0].id).toBe('lst_a'); // symptom -> specialty
    expect((await s('q=Nile')).items).toHaveLength(2); // clinic name
    expect((await s('gender=MALE')).items.map((i: any) => i.id)).toEqual(['lst_b']);
    expect((await s('language=en')).items.map((i: any) => i.id)).toEqual(['lst_a']);
    expect((await s('minFee=500')).items.map((i: any) => i.id)).toEqual(['lst_b']);
    expect((await s('maxFee=400')).items.map((i: any) => i.id)).toEqual(['lst_a']);
    expect((await s('minRating=4')).items.map((i: any) => i.id)).toEqual(['lst_b']);
    expect((await s('area=Maadi')).items.map((i: any) => i.id)).toEqual(['lst_a']);
    expect((await s('sort=rating')).items[0].id).toBe('lst_b');
    expect((await s('sort=fee')).items[0].id).toBe('lst_a');
    const near = await s('sort=distance&lat=29.96&lng=31.25');
    expect(near.items[0].id).toBe('lst_a');
    expect(near.items[0].distanceKm).toBeLessThan(1);
    expect(typeof near.items[0].latitude).toBe('number'); // KXMDS05: clinic coordinates for the results map
    expect(typeof near.items[0].longitude).toBe('number');
    expect((await s('nextAvailable=today')).items).toHaveLength(0);
    expect((await s('nextAvailable=week')).items).toHaveLength(2);
    await c.http().get('/api/v1/search/providers?sort=bogus').expect(400);
  });

  it('default "earliest" sort covers the whole catalogue: unrated providers reachable, SQL pagination stable, no timeout at 130 providers', async () => {
    const N = 130;
    for (let i = 0; i < N; i++) {
      c.kiorly.providers.push(FakeKiorly.provider({ id: `lst_e${i}`, clinicianId: `dr_e${i}`, nameEn: `Dr E${i}` }));
      // earliest slot: provider i starts at +24h + (N - i) hours, so the LAST seeded (never rated) provider is the earliest
      c.kiorly.slotsByClinician.set(`dr_e${i}`, [soon(24 + (N - i))]);
    }
    await c.get(CatalogService).syncOnce();
    // only the first 5 are rated: the old 60-best-rated cut would have hidden 125 providers
    for (let i = 0; i < 5; i++) await c.prisma.provider.update({ where: { id: `lst_e${i}` }, data: { ratingAvg: 4.9, ratingCount: 20 } });
    const t0 = Date.now();
    const first = (await c.http().get('/api/v1/search/providers?pageSize=30&page=1').expect(200)).body;
    expect(Date.now() - t0).toBeLessThan(15_000);
    expect(first.total).toBe(N);
    expect(first.sort).toBe('earliest');
    expect(first.items[0].id).toBe(`lst_e${N - 1}`); // earliest slot wins although unrated
    const ids: string[] = first.items.map((i: any) => i.id);
    for (let page = 2; page <= 5; page++) ids.push(...(await c.http().get(`/api/v1/search/providers?pageSize=30&page=${page}`).expect(200)).body.items.map((i: any) => i.id));
    expect(ids).toHaveLength(N);
    expect(new Set(ids).size).toBe(N); // no duplicate / missing row across pages
    expect(ids).toEqual(Array.from({ length: N }, (_, k) => `lst_e${N - 1 - k}`)); // strictly by next slot
    // the index is warm now: a second search asks the clinic for slots only for its own page (<= 30), not for the catalogue
    c.kiorly.calls = [];
    await c.http().get('/api/v1/search/providers?pageSize=10&page=2').expect(200);
    expect(c.kiorly.callsTo('GET', '/slots').length).toBeLessThanOrEqual(10);
    // nextAvailable filters in SQL: total reflects it
    const wk = (await c.http().get('/api/v1/search/providers?nextAvailable=week&pageSize=30').expect(200)).body;
    expect(wk.total).toBe(N);
    expect((await c.http().get('/api/v1/search/providers?nextAvailable=today').expect(200)).body.total).toBe(0);
  });

  it('earliest: providers without slots sort after those with slots (rating then id as tie-break); a booking-side invalidation re-indexes', async () => {
    c.kiorly.providers.push(FakeKiorly.provider({ id: 'lst_n1', clinicianId: 'dr_n1' }), FakeKiorly.provider({ id: 'lst_n2', clinicianId: 'dr_n2' }), FakeKiorly.provider({ id: 'lst_s', clinicianId: 'dr_s' }));
    c.kiorly.slotsByClinician.set('dr_n1', []); c.kiorly.slotsByClinician.set('dr_n2', []); c.kiorly.slotsByClinician.set('dr_s', [soon(40)]);
    await c.get(CatalogService).syncOnce();
    await c.prisma.provider.update({ where: { id: 'lst_n2' }, data: { ratingAvg: 4.5, ratingCount: 3 } });
    const ids = async () => (await c.http().get('/api/v1/search/providers').expect(200)).body.items.map((i: any) => i.id);
    expect(await ids()).toEqual(['lst_s', 'lst_n2', 'lst_n1']);
    c.kiorly.slotsByClinician.set('dr_n1', [soon(26)]);
    c.get(CatalogService).invalidateSlots('dr_n1');
    await new Promise((r) => setTimeout(r, 200));
    expect(await ids()).toEqual(['lst_n1', 'lst_s', 'lst_n2']);
  });

  it('KXM-DS-06 emergency keywords (EN + AR) return 123 guidance and never results', async () => {
    await seedProvider(c, {});
    for (const q of ['severe chest pain', "I can't breathe", 'ألم في الصدر', 'نزيف شديد', 'عايز اموت']) {
      const r = await c.http().get(`/api/v1/search/providers?q=${encodeURIComponent(q)}`).expect(200);
      expect(r.body.emergency.number).toBe('123');
      expect(r.body.emergency.bookingBlocked).toBe(true);
      expect(r.body.items).toEqual([]);
    }
    const ok = await c.http().get('/api/v1/search/providers?q=dermatology').expect(200);
    expect(ok.body.emergency).toBeUndefined();
    // no symptom text in analytics
    const ev = await c.prisma.analyticsEvent.findMany();
    expect(JSON.stringify(ev)).not.toMatch(/chest|breathe|الصدر/);
  });

  it('KXM-PR-01/02/04 provider profile; KXM-BK-01 slots cached 60 s and invalidated by SLOTS_CHANGED', async () => {
    c.kiorly.slots = [soon(30)];
    const id = await seedProvider(c, {});
    const p = await c.http().get(`/api/v1/providers/${id}`).expect(200);
    expect(p.body.verified).toBe(true);
    expect(p.body.fees[0].amountMinor).toBe(30000);
    expect(p.body.cancellationPolicy).toBeTruthy();
    expect(p.body.clinic.phone).toBeTruthy();
    const q = `/api/v1/providers/${id}/slots?typeId=typ_1`;
    await c.http().get(q).expect(200);
    await c.http().get(q).expect(200);
    expect(c.kiorly.callsTo('GET', '/slots')).toHaveLength(1);
    const wh = await c.webhook('SLOTS_CHANGED', { clinicianId: 'dr_1' }, { aggregateId: 'dr_1', aggregateType: 'Clinic' });
    expect(wh.body.status).toBe('APPLIED');
    await c.http().get(q).expect(200);
    expect(c.kiorly.callsTo('GET', '/slots')).toHaveLength(2);
    await c.http().get('/api/v1/providers/nope').expect(404);
  });

  it('listing/profile webhooks reindex; LISTING_STATUS_CHANGED PAUSED hides from search', async () => {
    const id = await seedProvider(c, { updatedAt: new Date(Date.now() - 10_000).toISOString() });
    c.kiorly.providers = [FakeKiorly.provider({ id, status: 'PAUSED', updatedAt: new Date().toISOString() })];
    await c.webhook('LISTING_STATUS_CHANGED', { clinicId: 'cl_1' }, { aggregateType: 'MarketplaceListing', aggregateId: id });
    const r = await c.http().get('/api/v1/search/providers').expect(200);
    expect(r.body.items).toHaveLength(0);
  });

  it('KXM-DS-08 profile views are counted and pushed daily (replace semantics)', async () => {
    const id = await seedProvider(c, {});
    await c.http().post(`/api/v1/providers/${id}/view`).expect(200);
    await c.http().post(`/api/v1/providers/${id}/view`).expect(200);
    const svc = c.get(CatalogService);
    expect((await svc.pushProfileViews()).pushed).toBe(0); // today is not complete yet
    await c.prisma.profileViewDaily.updateMany({ data: { date: new Date(Date.now() - 86400_000 - 3600_000 * 1) } });
    const r = await svc.pushProfileViews();
    expect(r.pushed).toBe(1);
    expect(c.kiorly.profileViews[0]).toMatchObject({ clinicId: 'cl_1', items: [{ clinicianId: 'dr_1', views: 2 }] });
    expect((await svc.pushProfileViews()).pushed).toBe(0);
  });

  it('kiorex.marketplace OFF: search still shows providers with clinic phone only, no slots', async () => {
    c.kiorly.slots = [soon(30)];
    await seedProvider(c, {});
    await c.flags.setValue('admin', { key: 'kiorex.marketplace', scope: 'GLOBAL', value: 'OFF', reason: 'test', ticket: 'T-1' });
    const r = await c.http().get('/api/v1/search/providers').expect(200);
    expect(r.body.items[0].bookable).toBe(false);
    expect(r.body.items[0].nextSlots).toBeNull();
    expect(r.body.items[0].clinicPhone).toBeTruthy();
  });
});
