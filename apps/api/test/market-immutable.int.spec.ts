import { createCtx, seedProvider, TestCtx } from './harness';
import { FakeKiorly } from './fake-kiorly';
import { CatalogService } from '../src/catalog/catalog-public';

/** Founder decision A (27 Nov 2026): a provider belongs to its country for life; Kiorex lists it only in that market and refuses any cross-market association. */
describe('market is fixed for life (platform side)', () => {
  let c: TestCtx;
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => { await c.reset(); });

  const makeSaLive = async () => {
    const def = await c.prisma.flagDefinition.findUniqueOrThrow({ where: { key: 'market.eg.live' } });
    const { key: _k, ...rest } = def as any;
    await c.prisma.flagDefinition.create({ data: { ...rest, key: 'market.sa.live' } });
    await c.prisma.flagGateEvidence.create({ data: { flagKey: 'market.sa.live', gateId: 'DEV-TEST-FIXTURE-NOT-A-REAL-GATE', approver: 'test fixture', approvedOn: new Date(), documentUrl: 'https://dev.invalid/test-fixture', recordedBy: 'TEST_FIXTURE' } });
    (c.get(CatalogService) as any).markets.flags?.invalidate?.();
  };

  it('the sync takes the market from the Clinic and never rewrites it: a listing that arrives under another country is refused and audited once', async () => {
    c.kiorly.providers = [FakeKiorly.provider({ id: 'lst_1', market: 'EG', updatedAt: new Date(Date.now() - 5000).toISOString() })];
    const svc = c.get(CatalogService);
    expect((await svc.syncOnce()).upserted).toBe(1);
    expect((await c.prisma.provider.findUniqueOrThrow({ where: { id: 'lst_1' } })).market).toBe('EG');
    c.kiorly.providers = [FakeKiorly.provider({ id: 'lst_1', market: 'SA', updatedAt: new Date().toISOString(), nameEn: 'Moved?' })];
    const r = await svc.syncOnce({ full: true });
    expect(r).toMatchObject({ upserted: 0, refused: 1 });
    const row = await c.prisma.provider.findUniqueOrThrow({ where: { id: 'lst_1' } });
    expect(row.market).toBe('EG');
    expect(row.nameEn).not.toBe('Moved?');
    await svc.syncOnce({ full: true });
    expect(await c.prisma.auditLog.count({ where: { action: 'provider.market_change_refused', resourceId: 'lst_1' } })).toBe(1);
  });

  it('a listing without a market (older Clinic) keeps its market; malformed markets are ignored, never stored', async () => {
    await seedProvider(c, { id: 'lst_old', market: 'EG' });
    c.kiorly.providers = [{ ...FakeKiorly.provider({ id: 'lst_old', updatedAt: new Date().toISOString() }), market: undefined }];
    expect((await c.get(CatalogService).syncOnce({ full: true })).refused).toBe(0);
    for (const bad of ['', 'egy', 'E', 'e g', '<script>', 7, null, ['EG'], { a: 1 }]) {
      c.kiorly.providers = [{ ...FakeKiorly.provider({ id: 'lst_old', updatedAt: new Date().toISOString() }), market: bad }];
      const r = await c.get(CatalogService).syncOnce({ full: true });
      expect(r.refused).toBe(0);
    }
    expect((await c.prisma.provider.findUniqueOrThrow({ where: { id: 'lst_old' } })).market).toBe('EG');
  });

  it('the database refuses a change of market on a provider and on a partner registration (last line of defence)', async () => {
    await seedProvider(c, { id: 'lst_db', market: 'EG' });
    await expect(c.prisma.provider.update({ where: { id: 'lst_db' }, data: { market: 'SA' } })).rejects.toThrow(/MARKET_IMMUTABLE/);
    await expect(c.prisma.provider.updateMany({ data: { market: 'SA' } })).rejects.toThrow(/MARKET_IMMUTABLE/);
    await c.prisma.provider.update({ where: { id: 'lst_db' }, data: { market: 'EG', nameEn: 'Same market is fine' } });
    const pc = await c.prisma.partnerConnection.create({ data: { id: 'pc_x', kind: 'PHARMACY', orgRef: 'org_x', name: 'P', market: 'EG', statusTokenHash: 'h' } });
    await expect(c.prisma.partnerConnection.update({ where: { id: pc.id }, data: { market: 'AE' } })).rejects.toThrow(/MARKET_IMMUTABLE/);
  });

  it('search shows a provider only in its own market (EG by default, ?market= for another); an unknown or malformed market is empty or 400', async () => {
    await makeSaLive();
    await seedProvider(c, { id: 'lst_eg', clinicianId: 'dr_eg', market: 'EG', nameEn: 'Dr Egypt' });
    await seedProvider(c, { id: 'lst_sa', clinicianId: 'dr_sa', market: 'SA', nameEn: 'Dr Saudi' });
    const ids = async (q = '') => (await c.http().get(`/api/v1/search/providers${q}`).expect(200)).body.items.map((i: any) => i.id);
    expect(await ids()).toEqual(['lst_eg']);
    expect(await ids('?market=EG')).toEqual(['lst_eg']);
    expect(await ids('?market=sa')).toEqual(['lst_sa']);
    expect(await ids('?market=ZZ')).toEqual([]);
    await c.http().get('/api/v1/search/providers?market=EGY').expect(400);
    await c.http().get('/api/v1/search/providers?market=%27%3B--').expect(400);
  });

  it('booking: a patient of another market cannot book the provider (403 CROSS_MARKET_BOOKING), and the Clinic is told the provider market', async () => {
    await makeSaLive();
    await seedProvider(c, { id: 'lst_sa2', clinicianId: 'dr_sa2', market: 'SA', nameEn: 'Dr Saudi 2' });
    c.kiorly.slots = [{ startsAt: new Date(Date.now() + 48 * 3600_000).toISOString(), endsAt: new Date(Date.now() + 49 * 3600_000).toISOString() }];
    const h = await c.as('sub_eg_patient');
    await c.prisma.patientProfile.create({ data: { sub: 'sub_eg_patient', phone: '+201000000001', market: 'EG' } });
    const r = await c.http().post('/api/v1/bookings').set(h).send({ providerId: 'lst_sa2', typeId: 'typ_1', startsAt: c.kiorly.slots[0]!.startsAt });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('CROSS_MARKET_BOOKING');
    expect(c.kiorly.callsTo('POST', '/holds')).toHaveLength(0);
    // same market: the hold request carries the market so the Clinic can refuse a mismatch too
    const h2 = await c.as('sub_sa_patient');
    await c.prisma.patientProfile.create({ data: { sub: 'sub_sa_patient', phone: '+966500000001', market: 'SA' } });
    const ok = await c.http().post('/api/v1/bookings').set(h2).send({ providerId: 'lst_sa2', typeId: 'typ_1', startsAt: c.kiorly.slots[0]!.startsAt });
    expect([200, 201]).toContain(ok.status);
    expect(c.kiorly.callsTo('POST', '/holds')[0]!.body.market).toBe('SA');
  });
});
