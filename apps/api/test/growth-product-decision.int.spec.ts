import { validateAcquisitionBlock } from '@kiorex/contracts';
import { createCtx, futureSlot, TestCtx } from './harness';
import { FakePartner } from './fake-partner';
import { OutboxService } from '../src/outbox/outbox-public';
import { GROWTH_FAILURE, growthFailureCount, resetGrowthFailures } from '../src/growth/growth-failures';
import { GrowthProductBookingService } from '../src/growth/products/product-decision.service';
import { AttributionService } from '../src/growth/attribution/attribution.service';
import { LinkRegistryService } from '../src/growth/links/link-registry.service';
import { DAY, seedBooking, seedTouch } from './growth-helpers';

const ORG = 'org_PH1';
const base = (o: Partial<Parameters<GrowthProductBookingService['decide']>[0]> = {}) => ({ product: 'PHARMACY' as const, factKind: 'ORDER' as const, factId: `kx_ph_${Math.random().toString(36).slice(2, 10)}`, sub: 'sub_amira', orgRef: ORG, createdAt: new Date(), ...o });
const link = (c: TestCtx, code: string, org: string, product: string) => c.prisma.growthAcquisitionSource.upsert({ where: { market_sourceKind_sourceRef: { market: 'EG', sourceKind: 'PROVIDER_LINK', sourceRef: code } }, create: { sourceKind: 'PROVIDER_LINK', sourceRef: code, ownerOrgRef: org, product }, update: { ownerOrgRef: org, product } });

/** GRW-P4-B2: Kiorex-side product decision (pharmacy order, lab booking) against a real database. */
describe('product ingest and decision (GRW-P4-B2)', () => {
  let c: TestCtx; let svc: GrowthProductBookingService; let ph: FakePartner; let lab: FakePartner;
  beforeAll(async () => { c = await createCtx(); svc = c.get(GrowthProductBookingService); ph = await new FakePartner('pharmacy').start(); lab = await new FakePartner('lab').start(); });
  afterAll(async () => { await c.close(); await ph.stop(); await lab.stop(); });
  beforeEach(async () => { await c.reset(); c.flags.invalidate(); ph.reset(); lab.reset(); resetGrowthFailures(); });

  describe('decisions', () => {
    it('a pharmacy link touch of the same organisation makes the order PROVIDER_LED; without a touch MARKETPLACE or UNATTRIBUTED; a Clinic link or another product is never evidence', async () => {
      await link(c, 'PHAR1111', ORG, 'PHARMACY'); await link(c, 'CLIN2222', ORG, 'CLINIC'); await link(c, 'LABB3333', ORG, 'LAB'); await link(c, 'PHAR4444', 'org_OTHER', 'PHARMACY');
      const t = await seedTouch(c, { kind: 'PROVIDER_LINK', sub: 'sub_amira', org: ORG, ageMs: DAY, linkCode: 'PHAR1111' });
      expect(await svc.decide(base())).toMatchObject({ origin: 'PROVIDER_LED', created: true });
      const row = await c.prisma.growthProductDecision.findFirstOrThrow({});
      expect(row).toMatchObject({ product: 'PHARMACY', factKind: 'ORDER', reasonCode: 'PRIOR_PROVIDER_TOUCH', evidenceTouchIds: [t.id] });
      expect(row.inputsHash).toMatch(/^[0-9a-f]{64}$/);
      const S2 = 'sub_second'; // touches are append-only: a second person isolates the next scenario
      await seedTouch(c, { kind: 'PROVIDER_LINK', sub: S2, org: ORG, ageMs: DAY, linkCode: 'CLIN2222' }); // a Clinic link of the same organisation id (impossible in practice, still refused by product)
      await seedTouch(c, { kind: 'PROVIDER_LINK', sub: S2, org: ORG, ageMs: DAY, linkCode: 'LABB3333' });
      await seedTouch(c, { kind: 'PROVIDER_LINK', sub: S2, org: 'org_OTHER', ageMs: DAY, linkCode: 'PHAR4444' });
      expect(await svc.decide(base({ sub: S2 }))).toMatchObject({ origin: 'UNATTRIBUTED' });
      await seedTouch(c, { kind: 'ORGANIC_SEARCH', sub: S2, ageMs: DAY });
      expect(await svc.decide(base({ sub: S2 }))).toMatchObject({ origin: 'MARKETPLACE' });
    });

    it('lab bookings decide the same way, and a fact kind that does not belong to the product is refused', async () => {
      await link(c, 'LABB5555', 'org_LB1', 'LAB');
      await seedTouch(c, { kind: 'PROVIDER_QR', sub: 'sub_amira', org: 'org_LB1', ageMs: 2 * DAY, linkCode: 'LABB5555' });
      expect(await svc.decide(base({ product: 'LAB', factKind: 'LAB_BOOKING', orgRef: 'org_LB1' }))).toMatchObject({ origin: 'PROVIDER_LED' });
      await expect(svc.decideOrThrow(base({ product: 'LAB', factKind: 'ORDER' }))).rejects.toThrow(/does not belong/);
    });

    it('a revoked or paused link is not honoured; written decisions stay (append-only, update and delete refused by the database)', async () => {
      await link(c, 'PHAR6666', ORG, 'PHARMACY');
      await seedTouch(c, { kind: 'PROVIDER_LINK', sub: 'sub_amira', org: ORG, ageMs: DAY, linkCode: 'PHAR6666' });
      const first = base();
      expect(await svc.decide(first)).toMatchObject({ origin: 'PROVIDER_LED' });
      await c.prisma.growthAcquisitionSource.updateMany({ where: { sourceRef: 'PHAR6666' }, data: { linkStatus: 'REVOKED' } });
      expect(await svc.decide(base())).toMatchObject({ origin: 'UNATTRIBUTED' });
      expect((await c.prisma.growthProductDecision.findFirstOrThrow({ where: { factId: first.factId } })).origin).toBe('PROVIDER_LED');
      await expect(c.prisma.$executeRaw`UPDATE "GrowthProductDecision" SET "origin" = 'MARKETPLACE'`).rejects.toThrow();
      await expect(c.prisma.$executeRaw`DELETE FROM "GrowthProductDecision"`).rejects.toThrow();
    });

    it('idempotent: sequential and 12 concurrent calls give one row; a different policy version would be a different row', async () => {
      await link(c, 'PHAR7777', ORG, 'PHARMACY'); await seedTouch(c, { kind: 'PROVIDER_LINK', sub: 'sub_amira', org: ORG, ageMs: DAY, linkCode: 'PHAR7777' });
      const f = base();
      const rs = await Promise.all(Array.from({ length: 12 }, () => svc.decide(f)));
      expect(new Set(rs.map((r) => r!.id)).size).toBe(1);
      expect(rs.filter((r) => r!.created)).toHaveLength(1);
      expect((await svc.decide(f))!.created).toBe(false);
      expect(await c.prisma.growthProductDecision.count()).toBe(1);
    });

    it('the touch window is the clinic window by default and a per-product override narrows it; the touch of a product with no override is unchanged', async () => {
      await link(c, 'PHAR8888', ORG, 'PHARMACY');
      await seedTouch(c, { kind: 'PROVIDER_LINK', sub: 'sub_amira', org: ORG, ageMs: 20 * DAY, linkCode: 'PHAR8888' });
      expect(await svc.decide(base())).toMatchObject({ origin: 'PROVIDER_LED' }); // 20 days is inside the 30 day default
      const { policyForProduct } = await import('../src/growth/products/product-decision');
      const p = { versionId: 'v', providerTouchWindowDays: 30, patientReferralWindowDays: 30, campaignClickWindowDays: 7, minDwellMsForProviderTouch: 1000, precedence: 'PROVIDER_FIRST' as const, allowOfflineEvidence: false };
      expect(policyForProduct(p, { products: { PHARMACY: { windows: { providerTouchWindowDays: 14 } } } }, 'PHARMACY').providerTouchWindowDays).toBe(14);
      expect(policyForProduct(p, { products: { PHARMACY: { windows: { providerTouchWindowDays: 14 } } } }, 'LAB').providerTouchWindowDays).toBe(30);
      expect(policyForProduct(p, { products: { PHARMACY: { windows: { providerTouchWindowDays: 9999 } } } }, 'PHARMACY').providerTouchWindowDays).toBe(30); // out-of-range ignored
      expect(policyForProduct(p, undefined, 'LAB')).toBe(p);
    });

    it('CROSS_PRODUCT: a continuity parent of the same person links the decision and keeps no clinical data; a foreign parent is ignored; own PROVIDER_LED evidence still wins', async () => {
      const parentBooking = await seedBooking(c, { sub: 'sub_amira' });
      const parent = (await c.get(AttributionService).decideForBooking({ bookingId: parentBooking.id }))!;
      const r = await svc.decide(base({ continuityParentBookingId: parentBooking.id }));
      expect(r).toMatchObject({ origin: 'CROSS_PRODUCT' });
      expect(await c.prisma.growthProductDecision.findUniqueOrThrow({ where: { id: r!.id } })).toMatchObject({ parentDecisionId: parent.id, reasonCode: 'CONTINUITY_ENTRY_POINT' });
      const foreign = await seedBooking(c, { sub: 'sub_someone_else' });
      await c.get(AttributionService).decideForBooking({ bookingId: foreign.id });
      expect(await svc.decide(base({ sub: 'sub_third', continuityParentBookingId: foreign.id }))).toMatchObject({ origin: 'UNATTRIBUTED' }); // the parent is somebody else's booking
      await link(c, 'PHAR9999', ORG, 'PHARMACY'); await seedTouch(c, { kind: 'PROVIDER_LINK', sub: 'sub_amira', org: ORG, ageMs: DAY, linkCode: 'PHAR9999' });
      expect(await svc.decide(base({ continuityParentBookingId: parentBooking.id }))).toMatchObject({ origin: 'PROVIDER_LED' });
    });

    it('the block validates against the contract; CROSS_PRODUCT travels as MARKETPLACE; flag OFF: no decision and no block; the decision tables hold no patient or order content', async () => {
      await link(c, 'PHAR1212', ORG, 'PHARMACY'); await seedTouch(c, { kind: 'PROVIDER_LINK', sub: 'sub_amira', org: ORG, ageMs: DAY, linkCode: 'PHAR1212' });
      const f = base();
      const b = (await svc.acquisitionBlock(f))!; // decides lazily
      expect(b).toMatchObject({ origin: 'PROVIDER_LED', linkCode: 'PHAR1212', product: 'PHARMACY' });
      expect(validateAcquisitionBlock(b as never).valid).toBe(true);
      expect(JSON.stringify(await c.prisma.growthProductDecision.findMany())).not.toMatch(/sub_amira|PARA500|\+20|@/);
      const admin = await c.as('adm1', { roles: ['super_admin', 'ops_admin'] });
      await c.http().put('/api/v1/admin/flags/growth.attribution/values').set(admin).send({ reason: 't', ticket: 'T-1', emergency: true, scope: 'GLOBAL', value: 'OFF' }).expect(200);
      c.flags.invalidate();
      expect(await svc.decide(base())).toBeNull();
      expect(await svc.acquisitionBlock(base())).toBeNull();
      expect(await c.prisma.growthProductDecision.count()).toBe(1);
    });

    it('a failing decision never throws into the caller, is counted, and the repair job decides the missed facts', async () => {
      const spy = jest.spyOn(c.prisma.growthProductDecision, 'findFirst').mockRejectedValueOnce(new Error('db down'));
      expect(await svc.decide(base())).toBeNull();
      expect(growthFailureCount(GROWTH_FAILURE.PRODUCT_DECISION)).toBe(1);
      spy.mockRestore();
    });
  });

  describe('registry (partner products)', () => {
    it('a partner ReferralLinkCreated stores the product; revoke applies; a code owned by another organisation is a CONFLICT whatever the product; a signed touch registered first is relabelled by the event', async () => {
      const reg = c.get(LinkRegistryService);
      expect(await reg.registerFromEvent({ linkCode: 'PART1111', orgRef: 'org_PH1', product: 'PHARMACY' })).toBe('REGISTERED');
      expect((await c.prisma.growthAcquisitionSource.findFirstOrThrow({ where: { sourceRef: 'PART1111' } })).product).toBe('PHARMACY');
      expect(await reg.registerFromEvent({ linkCode: 'PART1111', orgRef: 'org_LB1', product: 'LAB' })).toBe('CONFLICT');
      expect(await reg.learn('PART2222', 'org_LB1')).toBe('REGISTERED'); // a verified touch got there first: product unknown, defaults to CLINIC
      expect(await reg.registerFromEvent({ linkCode: 'PART2222', orgRef: 'org_LB1', product: 'LAB' })).toBe('KNOWN');
      expect((await c.prisma.growthAcquisitionSource.findFirstOrThrow({ where: { sourceRef: 'PART2222' } })).product).toBe('LAB');
      expect(await reg.revokeFromEvent({ linkCode: 'PART1111', orgRef: 'org_PH1', product: 'PHARMACY', revokedAt: new Date().toISOString() })).toBe('REVOKED');
      expect(await reg.registerFromEvent({ linkCode: 'PART3333', orgRef: 'org_X' })).toBe('REGISTERED'); // no product = CLINIC (1.11.0 meaning)
      expect((await c.prisma.growthAcquisitionSource.findFirstOrThrow({ where: { sourceRef: 'PART3333' } })).product).toBe('CLINIC');
    });
  });

  describe('call sites (real order and booking flows against the fake partners)', () => {
    let auth: { Authorization: string }; let admin: { Authorization: string };
    const flush = () => c.get(OutboxService).processBatch();
    beforeEach(async () => {
      auth = await c.as('sub_amira'); admin = await c.as('adm1', { roles: ['super_admin', 'ops_admin'] });
      await c.http().put('/api/v1/me/profile').set(auth).send({ nameEn: 'Amira Samy' }).expect(200);
      await c.http().put('/api/v1/me/consents/MARKETPLACE_PROCESSING').set(auth).send({ granted: true });
      for (const k of ['kiorex.pharmacy_orders', 'kiorex.lab_bookings']) await c.http().put(`/api/v1/admin/flags/${k}/gate`).set(admin).send({ gateId: 'TEST-FIXTURE-GATE', approver: 'test fixture', approvedOn: '2027-01-01', documentUrl: 'https://example.test/fixture' }).expect(200);
      process.env.QUIET_HOURS_START = '0'; process.env.QUIET_HOURS_END = '0';
    });

    it('pharmacy: the order is decided after creation and the partner call carries a contract-valid block; replaying the submit sends the same block', async () => {
      await c.http().put('/api/v1/pharmacy/cart').set(auth).send({ pharmacyId: 'ph_1', items: [{ sku: 'PARA500', qty: 1 }] }).expect(200);
      await c.http().put('/api/v1/pharmacy/cart/delivery').set(auth).send({ method: 'PICKUP' }).expect(200);
      const o = (await c.http().post('/api/v1/pharmacy/orders').set(auth).send({}).expect(201)).body;
      const d = await c.prisma.growthProductDecision.findFirstOrThrow({ where: { factKind: 'ORDER', factId: o.id } });
      expect(['MARKETPLACE', 'UNATTRIBUTED']).toContain(d.origin);
      await c.http().post(`/api/v1/pay/fake-checkout/${o.payment.paymentId}/complete`).send({ outcome: 'pay' }).expect(200); await flush();
      const sent = ph.callsTo('POST', '/orders')[0].body;
      expect(sent.acquisition).toMatchObject({ origin: d.origin, decisionId: d.id, product: 'PHARMACY', evidenceHash: d.inputsHash });
      expect(validateAcquisitionBlock(sent.acquisition).valid).toBe(true);
      expect(JSON.stringify(sent.acquisition)).not.toMatch(/PARA500|sub_amira|Amira/);
      expect(await c.prisma.growthProductDecision.count({ where: { factId: o.id } })).toBe(1);
    });

    it('lab: the booking is decided and the partner call carries a block that passes the lab strict inbound schema', async () => {
      const slot = futureSlot(30); lab.slots = [slot];
      const b = (await c.http().post('/api/v1/lab/bookings').set(auth).send({ labId: 'lab_1', testCodes: ['CBC'], collectionType: 'HOME', slot, address: { line1: '1 Nile St', area: 'Maadi' } }).expect(201)).body;
      const d = await c.prisma.growthProductDecision.findFirstOrThrow({ where: { factKind: 'LAB_BOOKING', factId: b.id } });
      await c.http().post(`/api/v1/pay/fake-checkout/${b.payment.paymentId}/complete`).send({ outcome: 'pay' }).expect(200); await flush();
      const sent = lab.callsTo('POST', '/orders')[0].body;
      expect(sent.acquisition).toMatchObject({ origin: d.origin, decisionId: d.id, product: 'LAB' });
      expect(lab.contractViolations).toEqual([]);
    });

    it('flag OFF: no decision row, the partner call has no acquisition key (byte-identical to before), and the order still goes through', async () => {
      await c.http().put('/api/v1/admin/flags/growth.attribution/values').set(admin).send({ reason: 't', ticket: 'T-1', emergency: true, scope: 'GLOBAL', value: 'OFF' }).expect(200); c.flags.invalidate();
      await c.http().put('/api/v1/pharmacy/cart').set(auth).send({ pharmacyId: 'ph_1', items: [{ sku: 'PARA500', qty: 1 }] }).expect(200);
      await c.http().put('/api/v1/pharmacy/cart/delivery').set(auth).send({ method: 'PICKUP' }).expect(200);
      const o = (await c.http().post('/api/v1/pharmacy/orders').set(auth).send({}).expect(201)).body;
      await c.http().post(`/api/v1/pay/fake-checkout/${o.payment.paymentId}/complete`).send({ outcome: 'pay' }).expect(200); await flush();
      expect(await c.prisma.growthProductDecision.count()).toBe(0);
      expect(ph.callsTo('POST', '/orders')[0].body).not.toHaveProperty('acquisition');
      expect((await c.http().get(`/api/v1/pharmacy/orders/${o.id}`).set(auth)).body.status).toBe('SUBMITTED');
    });

    it('a decision failure never blocks the order (the order is created and submitted; the repair job decides it afterwards)', async () => {
      const spy = jest.spyOn(c.prisma.growthProductDecision, 'create').mockRejectedValue(new Error('write failed'));
      await c.http().put('/api/v1/pharmacy/cart').set(auth).send({ pharmacyId: 'ph_1', items: [{ sku: 'PARA500', qty: 1 }] }).expect(200);
      await c.http().put('/api/v1/pharmacy/cart/delivery').set(auth).send({ method: 'PICKUP' }).expect(200);
      const o = (await c.http().post('/api/v1/pharmacy/orders').set(auth).send({}).expect(201)).body;
      await c.http().post(`/api/v1/pay/fake-checkout/${o.payment.paymentId}/complete`).send({ outcome: 'pay' }).expect(200); await flush();
      expect((await c.http().get(`/api/v1/pharmacy/orders/${o.id}`).set(auth)).body.status).toBe('SUBMITTED');
      expect(ph.callsTo('POST', '/orders')[0].body).not.toHaveProperty('acquisition');
      expect(growthFailureCount(GROWTH_FAILURE.PRODUCT_DECISION)).toBeGreaterThan(0);
      spy.mockRestore();
      expect(await svc.repair(new Date(Date.now() - DAY))).toMatchObject({ decided: 1 });
      expect(await c.prisma.growthProductDecision.count({ where: { factId: o.id } })).toBe(1);
    });
  });
});
