import { createCtx, futureSlot, seedProvider, TestCtx } from './harness';

/** Market default deposit (policy pay.deposit_default, PROPOSED_DEFAULT delegated by founder 23 Nov 2026): 10% of the consultation fee, capped at 200 EGP, only for providers that enabled deposits. */
describe('default deposit policy', () => {
  let c: TestCtx; let auth: { Authorization: string }; let admin: { Authorization: string };
  const slot = futureSlot(72);
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => {
    await c.reset(); c.kiorly.slots = [slot];
    auth = await c.as('sub_amira'); admin = await c.as('adm1', { roles: ['super_admin', 'ops_admin'] });
    await c.http().put('/api/v1/me/profile').set(auth).send({ nameEn: 'Amira Samy' }).expect(200);
    delete process.env.DEPOSIT_DEFAULT_MINOR;
  });
  const hold = async (pid: string) => (await c.http().post('/api/v1/bookings').set(auth).send({ providerId: pid, typeId: 'typ_1', ...slot }).expect(201)).body;

  it('provider that enabled deposits without an amount: 10% of the fee (300 EGP -> 30 EGP = 3000 minor); the hold records the policy', async () => {
    const pid = await seedProvider(c, { depositRequired: true, fee: 300 });
    const h = await hold(pid);
    expect(h).toMatchObject({ depositStatus: 'REQUIRED', depositAmountMinor: 3000 });
    const ev = await c.prisma.bookingEvent.findFirst({ where: { bookingId: h.id, kind: 'INTENT' } });
    expect(JSON.stringify(ev?.detail)).toContain('MARKET_DEFAULT_PERCENT');
  });

  it('capped at 200 EGP: a 3000 EGP consultation asks for 20000 minor, not 30000', async () => {
    const pid = await seedProvider(c, { depositRequired: true, fee: 3000 });
    expect((await hold(pid)).depositAmountMinor).toBe(20000);
  });

  it('providers that did not enable deposits get none (DEPOSIT_DEFAULT_MINOR stays 0 for them)', async () => {
    const pid = await seedProvider(c, { fee: 300 });
    const h = await hold(pid);
    expect(h.depositStatus).not.toBe('REQUIRED');
    expect(h.depositAmountMinor ?? 0).toBe(0);
  });

  it('an explicit provider amount wins over the market default', async () => {
    const pid = await seedProvider(c, { depositAmount: 150, fee: 300 });
    expect((await hold(pid)).depositAmountMinor).toBe(15000);
  });

  it('a fixed DEPOSIT_DEFAULT_MINOR still wins over the percentage default (backward compatible)', async () => {
    process.env.DEPOSIT_DEFAULT_MINOR = '5000';
    try { expect((await hold(await seedProvider(c, { depositRequired: true, fee: 300 }))).depositAmountMinor).toBe(5000); } finally { delete process.env.DEPOSIT_DEFAULT_MINOR; }
  });

  it('configurable per market and per organisation (never hard-coded): ops console API shows PROPOSED_DEFAULT, overrides change the amount, audited, clearing restores', async () => {
    const pid = await seedProvider(c, { depositRequired: true, fee: 300 });
    const d0 = (await c.http().get('/api/v1/admin/policy?market=EG').set(admin).expect(200)).body;
    const dep = d0.items.find((i: any) => i.key === 'pay.deposit_default');
    expect(dep).toMatchObject({ source: 'PROPOSED_DEFAULT', proposedDefault: true, value: { enabled: true, percentBps: 1000, capMajor: 200 } });
    expect(dep.note).toBe('PROPOSED_DEFAULT delegated by founder 23 Nov 2026');
    await c.http().put('/api/v1/admin/policy/pay.deposit_default').set(auth).send({ scope: 'MARKET', scopeId: 'EG', value: { enabled: true, percentBps: 2000, capMajor: 200 } }).expect(403); // super admin only
    await c.http().put('/api/v1/admin/policy/pay.deposit_default').set(admin).send({ scope: 'MARKET', scopeId: 'EG', value: { enabled: true, percentBps: 2000, capMajor: 50 } }).expect(200);
    expect((await hold(pid)).depositAmountMinor).toBe(5000); // 20% of 300 = 60 EGP, capped at the market's 50 EGP
    const d1 = (await c.http().get('/api/v1/admin/policy?market=EG').set(admin).expect(200)).body.items.find((i: any) => i.key === 'pay.deposit_default');
    expect(d1).toMatchObject({ source: 'MARKET', proposedDefault: false, value: { percentBps: 2000, capMajor: 50 } });
    expect(d1.overrides).toHaveLength(1);
    // an organisation override beats the market one (scopeId = the clinic organisation)
    const clinicId = (await c.prisma.provider.findUniqueOrThrow({ where: { id: pid } })).clinicId;
    await c.http().put('/api/v1/admin/policy/pay.deposit_default').set(admin).send({ scope: 'ORG', scopeId: clinicId, value: { enabled: false, percentBps: 1000, capMajor: 200 } }).expect(200);
    await c.http().post('/api/v1/bookings').set(auth).send({ providerId: pid, typeId: 'typ_1', ...futureSlot(73) }).expect(201).expect((r) => expect(r.body.depositAmountMinor ?? 0).toBe(0));
    expect(await c.prisma.auditLog.count({ where: { action: 'policy.set' } })).toBe(2);
    await c.http().put('/api/v1/admin/policy/pay.deposit_default').set(admin).send({ scope: 'MARKET', scopeId: 'EG', value: { enabled: true, percentBps: 20000, capMajor: 50 } }).expect(400); // bps out of range
    await c.http().delete(`/api/v1/admin/policy/pay.deposit_default?scope=ORG&scopeId=${clinicId}`).set(admin).expect(200);
    await c.http().delete('/api/v1/admin/policy/pay.deposit_default?scope=MARKET&scopeId=EG').set(admin).expect(200);
    const d2 = (await c.http().get('/api/v1/admin/policy?market=EG').set(admin).expect(200)).body.items.find((i: any) => i.key === 'pay.deposit_default');
    expect(d2).toMatchObject({ source: 'PROPOSED_DEFAULT', proposedDefault: true });
    await c.http().put('/api/v1/admin/policy/nope.key').set(admin).send({ scope: 'GLOBAL', value: {} }).expect(404);
  });
});
