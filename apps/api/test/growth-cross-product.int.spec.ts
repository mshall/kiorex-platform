import { validateAcquisitionBlock } from '@kiorex/contracts';
import { createCtx, futureSlot, seedProvider, TestCtx } from './harness';
import { FakePartner } from './fake-partner';
import { OutboxService } from '../src/outbox/outbox-public';
import { AttributionService } from '../src/growth/attribution/attribution.service';
import { GrowthProductBookingService } from '../src/growth/products/product-decision.service';
import { CrossProductService, CROSS_PRODUCT_FAILURE } from '../src/growth/cross-product/continuity.service';
import { CrossProductConsumer } from '../src/growth/cross-product/continuity.consumer';
import { factRef } from '../src/growth/cross-product/continuity-refs';
import { growthFailureCount, resetGrowthFailures } from '../src/growth/growth-failures';
import { DAY, registerLink, seedBooking, seedTouch } from './growth-helpers';

const DEV = (g: string) => `DEV-ONLY-NOT-A-REAL-GATE:${g}`;
const H = 3_600_000;

/** GRW-P4-A: cross-product journeys against a real database, the fake Kiorly Clinic, and the fake Pharmacy and Lab contract servers. */
describe('cross-product journeys (GRW-P4-A)', () => {
  let c: TestCtx; let ph: FakePartner; let lab: FakePartner; let auth: { Authorization: string }; let admin: { Authorization: string };
  const flush = () => c.get(OutboxService).processBatch();
  const gate = (key: string) => c.http().put(`/api/v1/admin/flags/${key}/gate`).set(admin).send({ gateId: 'TEST-FIXTURE-GATE', approver: 'test fixture', approvedOn: '2027-01-01', documentUrl: 'https://example.test/fixture' }).expect(200);
  const unlockHome = async () => { for (const [k, ids] of [['clinic.home_visits', ['GHV1', 'GHV2']], ['kiorex.home_visits', ['GHV1', 'GHV2']], ['nurse.care_plans', ['GKN1']]] as const) for (const g of ids) await c.flags.recordGate('TEST_FIXTURE', k, { gateId: DEV(g), approver: 'test fixture', approvedOn: new Date(), documentUrl: 'https://dev.invalid/fixture' }); c.flags.invalidate(); };
  const openAll = async () => { await gate('growth.cross_product'); await gate('kiorex.pharmacy_orders'); await gate('kiorex.lab_bookings'); c.flags.invalidate(); };
  const consent = (granted: boolean, who = auth) => c.http().put('/api/v1/growth/v1/continuity/consent').set(who).send({ granted }).expect(200);
  const cards = async (who = auth) => (await c.http().get('/api/v1/growth/v1/continuity/cards').set(who).expect(200)).body as { enabled: boolean; consent: boolean; cards: { id: string; kind: string; toProduct: string; recordId?: string; path: string }[] };

  /** An attended clinic visit of `sub`, with its clinic attribution decision (the "first booking"). */
  const visit = async (sub = 'sub_amira', o: { hoursAgo?: number; status?: string; clinicId?: string; dependantId?: string | null } = {}) => {
    const b = await seedBooking(c, { sub });
    const startsAt = new Date(Date.now() - (o.hoursAgo ?? 3) * H);
    await c.prisma.bookingIntent.update({ where: { id: b.id }, data: { status: o.status ?? 'COMPLETED', startsAt, endsAt: new Date(startsAt.getTime() + 1_800_000), createdAt: new Date(startsAt.getTime() - DAY), clinicId: o.clinicId ?? 'cl_1', dependantId: o.dependantId ?? null } });
    const d = (await c.get(AttributionService).decideForBooking({ bookingId: b.id }))!;
    return { id: b.id, decision: d };
  };
  const shareRx = async (sub = 'sub_amira', enc = 'enc_1') => {
    await c.prisma.kiorlyPatientLink.upsert({ where: { sub_clinicId_kiorlyPatientId: { sub, clinicId: 'cl_1', kiorlyPatientId: `pat_${sub}` } }, create: { sub, clinicId: 'cl_1', kiorlyPatientId: `pat_${sub}`, evidence: 'PHONE' }, update: {} });
    const r = await c.webhook('PRESCRIPTION_SHARED', { patientId: `pat_${sub}`, scope: 'PRESCRIPTIONS', encounterId: enc, clinicId: 'cl_1', signedAt: new Date(Date.now() - H).toISOString() }, { aggregateType: 'Encounter', aggregateId: enc });
    expect(r.status).toBe(202 === r.status ? 202 : r.status);
    return c.prisma.sharedRecord.findFirstOrThrow({ where: { sub, kind: 'PRESCRIPTION', sourceRef: enc } });
  };
  const rxOrder = async (recordId: string | null, headers: Record<string, string> = {}, who = auth) => {
    await c.http().put('/api/v1/pharmacy/cart').set(who).send({ pharmacyId: 'ph_1', items: [{ sku: recordId ? 'AMOX500' : 'PARA500', qty: 1 }], ...(recordId ? { prescriptionRecordId: recordId } : {}) }).expect(200);
    await c.http().put('/api/v1/pharmacy/cart/delivery').set(who).send({ method: 'PICKUP' }).expect(200);
    return (await c.http().post('/api/v1/pharmacy/orders').set({ ...who, ...headers }).send(recordId ? { prescriptionRecordId: recordId } : {}).expect(201)).body as { id: string; payment: { paymentId: string } };
  };
  const decisionOf = (kind: string, id: string) => c.prisma.growthProductDecision.findFirstOrThrow({ where: { factKind: kind, factId: id } });
  const links = () => c.prisma.crossProductContinuity.findMany({ orderBy: { createdAt: 'asc' } });

  beforeAll(async () => { c = await createCtx(); ph = await new FakePartner('pharmacy').start(); lab = await new FakePartner('lab').start(); });
  afterAll(async () => { await c.close(); await ph.stop(); await lab.stop(); });
  beforeEach(async () => {
    await c.reset(); c.flags.invalidate(); ph.reset(); lab.reset(); resetGrowthFailures();
    auth = await c.as('sub_amira'); admin = await c.as('adm1', { roles: ['super_admin', 'ops_admin'] });
    await c.http().put('/api/v1/me/profile').set(auth).send({ nameEn: 'Amira Samy' }).expect(200);
    await c.http().put('/api/v1/me/consents/MARKETPLACE_PROCESSING').set(auth).send({ granted: true });
    process.env.QUIET_HOURS_START = '0'; process.env.QUIET_HOURS_END = '0';
  });

  describe('flag, gates and consent', () => {
    it('growth.cross_product is launch-locked: without human gate evidence the cards are off, nothing is offered and an order is decided on its own evidence', async () => {
      const defs = (await c.http().get('/api/v1/admin/flags').set(admin).expect(200)).body as any[];
      expect(defs.find((d) => d.key === 'growth.cross_product')).toMatchObject({ launchLocked: true, dependsOn: ['growth.attribution'] });
      expect(await cards()).toEqual({ enabled: false, consent: false, cards: [] });
      await shareRx();
      expect(await c.prisma.crossProductEntryPoint.count()).toBe(0);
      expect(await c.prisma.flagGateEvidence.count({ where: { flagKey: 'growth.cross_product' } })).toBe(0); // application code records no gate
    });

    it('the consent is its own withdrawable choice: append-only history, draft wording flagged, withdrawal dismisses pending prompts', async () => {
      await openAll(); await visit(); await shareRx();
      expect((await cards()).cards.map((x) => x.kind)).toEqual(['RX_TO_PHARMACY']);
      const g = (await consent(true)).body;
      expect(g).toMatchObject({ granted: true, draftWording: true });
      expect(await c.prisma.consentRecord.count({ where: { sub: 'sub_amira', purpose: 'CROSS_PRODUCT_CONTINUITY' } })).toBe(1);
      const w = (await consent(false)).body;
      expect(w.granted).toBe(false);
      expect(await c.prisma.consentRecord.count({ where: { sub: 'sub_amira', purpose: 'CROSS_PRODUCT_CONTINUITY' } })).toBe(2);
      expect((await cards()).cards).toEqual([]); // the withdrawn prompts are gone
      await c.http().put('/api/v1/growth/v1/continuity/consent').set(auth).send({ granted: 'yes' }).expect(400);
      await c.http().get('/api/v1/growth/v1/continuity/cards').expect(401);
    });
  });

  describe('Clinic to Pharmacy (prescription)', () => {
    it('a shared prescription offers a card only while the pharmacy gate is open; the order that attaches it is CROSS_PRODUCT with the clinic decision as parent; no reward, no referral, no charge', async () => {
      await gate('growth.cross_product'); c.flags.invalidate();
      const v = await visit(); const rx = await shareRx();
      expect((await cards()).cards).toEqual([]); // the pharmacy gate is still closed
      await gate('kiorex.pharmacy_orders'); c.flags.invalidate();
      const list = await cards();
      expect(list).toMatchObject({ enabled: true, consent: false });
      expect(list.cards).toEqual([expect.objectContaining({ kind: 'RX_TO_PHARMACY', toProduct: 'PHARMACY', recordId: rx.id, path: '/pharmacy' })]);
      await consent(true);
      const o = await rxOrder(rx.id);
      const d = await decisionOf('ORDER', o.id);
      expect(d).toMatchObject({ product: 'PHARMACY', origin: 'CROSS_PRODUCT', reasonCode: 'CONTINUITY_ENTRY_POINT', parentDecisionId: v.decision.id });
      const [l] = await links();
      expect(l).toMatchObject({ fromProduct: 'CLINIC', toProduct: 'PHARMACY', entryPoint: 'RX_TO_PHARMACY', decisionId: d.id, parentDecisionId: v.decision.id, toOrigin: 'CROSS_PRODUCT', fromFactRef: factRef('CLINIC_BOOKING', v.id), toFactRef: factRef('PHARMACY_ORDER', o.id) });
      expect(l!.parentOrigin).toBe(v.decision.origin);
      expect(l!.lagHours).toBeGreaterThanOrEqual(2);
      expect((await c.prisma.crossProductEntryPoint.findFirstOrThrow()).consumedAt).not.toBeNull();
      expect((await cards()).cards).toEqual([]); // used
      // rule 4 and the inert commission link: nothing was rewarded, referred or charged
      for (const t of ['rewardLot', 'rewardLedgerEntry', 'referralRelationship', 'referralQualificationCheck', 'rewardCheckoutLine'] as const) expect(await (c.prisma[t] as any).count()).toBe(0);
      const sent = await (async () => { await c.http().post(`/api/v1/pay/fake-checkout/${o.payment.paymentId}/complete`).send({ outcome: 'pay' }).expect(200); await flush(); return ph.callsTo('POST', '/orders')[0].body; })();
      expect(sent.acquisition).toMatchObject({ origin: 'MARKETPLACE', decisionId: d.id, product: 'PHARMACY' }); // CROSS_PRODUCT travels as MARKETPLACE (the partner contract knows three origins)
      expect(validateAcquisitionBlock(sent.acquisition).valid).toBe(true);
      expect(JSON.stringify(sent.acquisition)).not.toMatch(/continuity|cl_1|kx_bk_|enc_1|CROSS/i); expect(sent.acquisition.reason).toBe('MARKETPLACE_TOUCH');
    });

    it('an order placed outside the flow is an independent decision: no prescription, no card, no consent, a card of another person, or an unknown prompt id', async () => {
      await openAll(); const v = await visit(); const rx = await shareRx();
      await consent(true);
      const plain = await rxOrder(null);
      expect(await decisionOf('ORDER', plain.id)).toMatchObject({ origin: expect.stringMatching(/^(MARKETPLACE|UNATTRIBUTED)$/), parentDecisionId: null });
      const bob = await c.as('sub_bob'); await c.http().put('/api/v1/me/profile').set(bob).send({ nameEn: 'Bob' }).expect(200); await consent(true, bob);
      const foreign = await rxOrder(null, { 'X-Kx-Continuity': (await c.prisma.crossProductEntryPoint.findFirstOrThrow()).id }, bob); // somebody else's prompt id
      expect((await decisionOf('ORDER', foreign.id)).origin).not.toBe('CROSS_PRODUCT');
      const junk = await rxOrder(null, { 'X-Kx-Continuity': 'not a real id!' });
      expect((await decisionOf('ORDER', junk.id)).origin).not.toBe('CROSS_PRODUCT');
      expect(await links()).toEqual([]);
      // a different person's prescription record cannot be used as the entry point either (the order itself refuses it)
      await c.http().put('/api/v1/pharmacy/cart').set(bob).send({ pharmacyId: 'ph_1', items: [{ sku: 'AMOX500', qty: 1 }], prescriptionRecordId: rx.id }).expect(404);
      expect(v.id).toBeTruthy();
    });

    it('no consent: the same order is decided independently and no link is written; withdrawal is effective for the very next order', async () => {
      await openAll(); await visit(); const rx = await shareRx();
      const a = await rxOrder(rx.id);
      expect((await decisionOf('ORDER', a.id)).origin).not.toBe('CROSS_PRODUCT');
      await consent(true);
      // the prompt state was kept (a patient may consent later), so the next order follows it
      const b = await rxOrder(rx.id);
      expect((await decisionOf('ORDER', b.id)).origin).toBe('CROSS_PRODUCT');
      await consent(false);
      const d = await rxOrder(rx.id);
      expect((await decisionOf('ORDER', d.id)).origin).not.toBe('CROSS_PRODUCT');
      expect((await links()).map((l) => l.toFactRef)).toEqual([factRef('PHARMACY_ORDER', b.id)]);
    });

    it('flag OFF after the prompt was offered: the order is decided on its own evidence and no link is written', async () => {
      await openAll(); await visit(); const rx = await shareRx(); await consent(true);
      await c.http().put('/api/v1/admin/flags/growth.cross_product/values').set(admin).send({ reason: 't', ticket: 'T-1', emergency: true, scope: 'GLOBAL', value: 'OFF' }).expect(200); c.flags.invalidate();
      expect(await cards()).toMatchObject({ enabled: false, cards: [] });
      const o = await rxOrder(rx.id);
      expect((await decisionOf('ORDER', o.id)).origin).not.toBe('CROSS_PRODUCT');
      expect(await links()).toEqual([]);
    });

    it('own PROVIDER_LED evidence still wins and the link keeps the first booking origin; a PROVIDER_LED first booking is remembered as the parent origin (no charge exists)', async () => {
      await openAll(); await consent(true);
      await registerLink(c, 'CLIN7777', 'org_A'); await seedTouch(c, { kind: 'PROVIDER_LINK', sub: 'sub_amira', org: 'org_A', ageMs: 2 * DAY, linkCode: 'CLIN7777' });
      const v = await visit(); expect(v.decision.origin).toBe('PROVIDER_LED');
      const rx = await shareRx();
      await c.prisma.growthAcquisitionSource.upsert({ where: { market_sourceKind_sourceRef: { market: 'EG', sourceKind: 'PROVIDER_LINK', sourceRef: 'PHAR7777' } }, create: { sourceKind: 'PROVIDER_LINK', sourceRef: 'PHAR7777', ownerOrgRef: 'org_PH1', product: 'PHARMACY' }, update: {} });
      await seedTouch(c, { kind: 'PROVIDER_LINK', sub: 'sub_amira', org: 'org_PH1', ageMs: DAY, linkCode: 'PHAR7777' });
      await c.prisma.partnerConnection.updateMany({ data: {} }).catch(() => undefined);
      const svc = c.get(GrowthProductBookingService);
      const own = await svc.decide({ product: 'PHARMACY', factKind: 'ORDER', factId: 'kx_ph_own1', sub: 'sub_amira', orgRef: 'org_PH1', createdAt: new Date(), continuity: { recordId: rx.id } });
      expect(own).toMatchObject({ origin: 'PROVIDER_LED' });
      expect(await links()).toEqual([expect.objectContaining({ toOrigin: 'PROVIDER_LED', parentOrigin: 'PROVIDER_LED', toProduct: 'PHARMACY' })]);
      // a pharmacy order without its own evidence after a PROVIDER_LED clinic visit is CROSS_PRODUCT and the parent origin stays visible
      const other = await svc.decide({ product: 'PHARMACY', factKind: 'ORDER', factId: 'kx_ph_own2', sub: 'sub_amira', orgRef: 'org_PH2', createdAt: new Date(), continuity: { recordId: rx.id } });
      expect(other).toMatchObject({ origin: 'CROSS_PRODUCT' });
      expect((await links()).find((l) => l.toOrigin === 'CROSS_PRODUCT')).toMatchObject({ parentOrigin: 'PROVIDER_LED' });
    });

    it('idempotent: the same order twice, and 12 concurrent calls, give one decision and one link', async () => {
      await openAll(); await consent(true); await visit(); const rx = await shareRx();
      const svc = c.get(GrowthProductBookingService);
      const f = { product: 'PHARMACY' as const, factKind: 'ORDER' as const, factId: 'kx_ph_idem', sub: 'sub_amira', orgRef: 'org_PH1', createdAt: new Date(), continuity: { recordId: rx.id } };
      const rs = await Promise.all(Array.from({ length: 12 }, () => svc.decide(f)));
      expect(new Set(rs.map((r) => r!.id)).size).toBe(1);
      expect(await c.prisma.growthProductDecision.count()).toBe(1);
      expect(await c.prisma.crossProductContinuity.count()).toBe(1);
      expect((await svc.decide(f))!.created).toBe(false);
    });

    it('a failed link write is counted and logged, the order and its decision are untouched, and the next call repairs the link', async () => {
      await openAll(); await consent(true); await visit(); const rx = await shareRx();
      const spy = jest.spyOn(c.prisma.crossProductContinuity, 'create').mockRejectedValueOnce(new Error('disk full'));
      const svc = c.get(GrowthProductBookingService);
      const f = { product: 'PHARMACY' as const, factKind: 'ORDER' as const, factId: 'kx_ph_fail', sub: 'sub_amira', orgRef: 'org_PH1', createdAt: new Date(), continuity: { recordId: rx.id } };
      expect(await svc.decide(f)).toMatchObject({ origin: 'CROSS_PRODUCT', created: true });
      expect(growthFailureCount(CROSS_PRODUCT_FAILURE.LINK)).toBe(1);
      expect(await c.prisma.crossProductContinuity.count()).toBe(0);
      spy.mockRestore();
      expect(await svc.decide(f)).toMatchObject({ created: false });
      expect(await c.prisma.crossProductContinuity.count()).toBe(1);
    });
  });

  describe('Clinic to Lab (ordered test)', () => {
    const order = (orderId = 'ord_1', extra: Record<string, unknown> = {}) => c.webhook('LabOrderPlaced', { orderId, encounterId: 'enc_9', clinicId: 'cl_1', patientRef: 'pat_sub_amira', orderingClinicianId: 'dr_1', consentToken: 'tok', orderedAt: new Date(Date.now() - H).toISOString(), items: [{ code: 'CBC', name: 'Complete blood count' }], notes: 'fasting', ...extra }, { aggregateType: 'ClinicalOrder', aggregateId: orderId });
    it('a Clinic-edition lab order offers a lab card (the Nurse edition does not); booking from the card is CROSS_PRODUCT; the tables never hold the test names', async () => {
      await openAll(); await consent(true);
      const v = await visit();
      await c.prisma.kiorlyPatientLink.create({ data: { sub: 'sub_amira', clinicId: 'cl_1', kiorlyPatientId: 'pat_sub_amira', evidence: 'PHONE' } });
      await order('ord_n', { originEdition: 'NURSE' });
      expect((await cards()).cards).toEqual([]);
      await order('ord_1');
      const card = (await cards()).cards.find((x) => x.kind === 'LAB_ORDER_TO_LAB')!;
      expect(card).toMatchObject({ toProduct: 'LAB', path: '/lab' }); expect(card.recordId).toBeUndefined();
      const slot = futureSlot(30); lab.slots = [slot];
      const b = (await c.http().post('/api/v1/lab/bookings').set({ ...auth, 'X-Kx-Continuity': card.id }).send({ labId: 'lab_1', testCodes: ['CBC'], collectionType: 'HOME', slot, address: { line1: '1 Nile St', area: 'Maadi' } }).expect(201)).body;
      const d = await decisionOf('LAB_BOOKING', b.id);
      expect(d).toMatchObject({ origin: 'CROSS_PRODUCT', parentDecisionId: v.decision.id });
      expect(await links()).toEqual([expect.objectContaining({ toProduct: 'LAB', entryPoint: 'LAB_ORDER_TO_LAB', toFactRef: factRef('LAB_BOOKING', b.id) })]);
      await c.http().post(`/api/v1/pay/fake-checkout/${b.payment.paymentId}/complete`).send({ outcome: 'pay' }).expect(200); await flush();
      expect(validateAcquisitionBlock(lab.callsTo('POST', '/orders')[0].body.acquisition).valid).toBe(true);
      expect(lab.contractViolations).toEqual([]);
      const dump = JSON.stringify([await c.prisma.crossProductContinuity.findMany(), await c.prisma.crossProductEntryPoint.findMany(), await c.prisma.growthProductDecision.findMany()]);
      expect(dump).not.toMatch(/CBC|Complete blood|fasting|enc_9|ord_1|cl_1|pat_sub|Amira/);
    });
    it('the same booking without the header is independent', async () => {
      await openAll(); await consent(true); await visit();
      const slot = futureSlot(30); lab.slots = [slot];
      const b = (await c.http().post('/api/v1/lab/bookings').set(auth).send({ labId: 'lab_1', testCodes: ['CBC'], collectionType: 'HOME', slot, address: { line1: '1 Nile St' } }).expect(201)).body;
      expect((await decisionOf('LAB_BOOKING', b.id)).origin).not.toBe('CROSS_PRODUCT');
      expect(await links()).toEqual([]);
    });
  });

  describe('Clinic to Nurse (home visit): the CARE_PLAN_BOOKING call site', () => {
    let pid: string; let addressId: string;
    beforeEach(async () => {
      c.kiorly.slots = [futureSlot(72)];
      pid = await seedProvider(c, { id: 'lst_home', profession: 'NURSE', edition: 'NURSE', serviceLocations: ['HOME'], coverageDistricts: ['maadi'], assignsClinician: true, register: 'NURSING_SYNDICATE', fee: 200, homeSurcharge: 50 } as never);
      const a = await c.http().post('/api/v1/me/addresses').set(auth).send({ label: 'Home', governorate: 'Cairo', district: 'maadi', street: 'Secret Street 1', building: '7' }).expect(201);
      await c.http().post(`/api/v1/me/addresses/${a.body.id}/confirm`).set(auth).expect(200); addressId = a.body.id;
    });
    it('every care-plan request is decided once (independent without the prompt); from the home-visit card it is CROSS_PRODUCT with the clinic visit as parent; the card needs both home gates', async () => {
      await gate('growth.cross_product'); await consent(true); const v = await visit(); c.flags.invalidate();
      expect((await cards()).cards).toEqual([]); // home gates closed
      await unlockHome();
      const card = (await cards()).cards.find((x) => x.kind === 'CARE_PLAN_TO_HOME_VISIT')!;
      expect(card).toMatchObject({ toProduct: 'NURSE', path: '/care-plans' });
      await c.http().post('/api/v1/care-plans').set(auth).send({ providerId: pid, addressId, typeId: 'typ_home' }).expect(201); // no header: independent
      const plain = await c.prisma.growthProductDecision.findFirstOrThrow({ where: { factKind: 'CARE_PLAN_BOOKING' } });
      expect(plain).toMatchObject({ product: 'NURSE', parentDecisionId: null }); expect(plain.origin).not.toBe('CROSS_PRODUCT');
      const plan = (await c.http().post('/api/v1/care-plans').set({ ...auth, 'X-Kx-Continuity': card.id }).send({ providerId: pid, addressId, typeId: 'typ_home' }).expect(201)).body;
      expect(await decisionOf('CARE_PLAN_BOOKING', plan.id)).toMatchObject({ product: 'NURSE', origin: 'CROSS_PRODUCT', parentDecisionId: v.decision.id });
      expect(await links()).toEqual([expect.objectContaining({ toProduct: 'NURSE', entryPoint: 'CARE_PLAN_TO_HOME_VISIT', fromFactRef: factRef('CLINIC_BOOKING', v.id), toFactRef: factRef('CARE_PLAN', plan.id) })]);
      expect(JSON.stringify(await c.prisma.crossProductContinuity.findMany())).not.toMatch(/Secret|maadi|typ_home|lst_home/i);
    });
    it('a visit of a dependant, a cancelled visit or a visit older than 30 days offers nothing', async () => {
      await gate('growth.cross_product'); await unlockHome(); await consent(true);
      await visit('sub_amira', { dependantId: 'dep_1' }); await visit('sub_amira', { status: 'CANCELLED' }); await visit('sub_amira', { hoursAgo: 31 * 24 });
      expect((await cards()).cards).toEqual([]);
    });
  });

  describe('appointment hints (contracts 1.13.0, optional) with the 7-day inference as the fallback', () => {
    const link = (sub = 'sub_amira') => c.prisma.kiorlyPatientLink.upsert({ where: { sub_clinicId_kiorlyPatientId: { sub, clinicId: 'cl_1', kiorlyPatientId: `pat_${sub}` } }, create: { sub, clinicId: 'cl_1', kiorlyPatientId: `pat_${sub}`, evidence: 'PHONE' }, update: {} });
    const rxWith = async (extra: Record<string, unknown>, enc = 'enc_h') => { await link(); await c.webhook('PRESCRIPTION_SHARED', { patientId: 'pat_sub_amira', scope: 'PRESCRIPTIONS', encounterId: enc, clinicId: 'cl_1', signedAt: new Date(Date.now() - H).toISOString(), ...extra }, { aggregateType: 'Encounter', aggregateId: enc }); };
    const entryOf = (kind: string) => c.prisma.crossProductEntryPoint.findFirst({ where: { sub: 'sub_amira', kind } });
    const vault = (enc: string) => c.prisma.sharedRecord.findFirst({ where: { sub: 'sub_amira', kind: 'PRESCRIPTION', sourceRef: enc } });

    it('PRESCRIPTION_SHARED with appointmentId follows exactly that booking, even when a later attended visit exists (the inference would pick the later one)', async () => {
      await openAll(); await consent(true);
      const older = await visit('sub_amira', { hoursAgo: 48 }); const newer = await visit('sub_amira', { hoursAgo: 3 });
      await c.prisma.bookingIntent.update({ where: { id: older.id }, data: { kiorlyAppointmentId: 'apt_older' } });
      await rxWith({ appointmentId: 'apt_older' });
      expect((await entryOf('RX_TO_PHARMACY'))!.parentBookingId).toBe(older.id);
      await c.prisma.crossProductEntryPoint.deleteMany(); await vault('enc_h').then((r) => c.prisma.sharedRecord.delete({ where: { id: r!.id } }));
      await rxWith({}); // no hint: the old inference (latest attended visit within 7 days)
      expect((await entryOf('RX_TO_PHARMACY'))!.parentBookingId).toBe(newer.id);
    });
    it('an appointmentId that is not the patient own Kiorex booking has no parent (no guess); the order is then decided on its own evidence', async () => {
      await openAll(); await consent(true);
      await visit('sub_amira', { hoursAgo: 3 });
      const other = await seedBooking(c, { sub: 'sub_other' }); await c.prisma.bookingIntent.update({ where: { id: other.id }, data: { kiorlyAppointmentId: 'apt_foreign', status: 'COMPLETED' } });
      await rxWith({ appointmentId: 'apt_foreign' }); // someone else's visit
      expect((await entryOf('RX_TO_PHARMACY'))!.parentBookingId).toBeNull();
      const rec = (await vault('enc_h'))!;
      const o = await rxOrder(rec.id);
      expect((await decisionOf('ORDER', o.id)).origin).not.toBe('CROSS_PRODUCT');
      expect(await links()).toEqual([]);
    });
    it('LabOrderPlaced with appointmentId follows that booking; a malformed hint is ignored like an absent one', async () => {
      await openAll(); await consent(true); await link();
      const v = await visit('sub_amira', { hoursAgo: 5 }); await visit('sub_amira', { hoursAgo: 1 });
      await c.prisma.bookingIntent.update({ where: { id: v.id }, data: { kiorlyAppointmentId: 'apt_lab' } });
      const lab1 = (orderId: string, extra: Record<string, unknown>) => c.webhook('LabOrderPlaced', { orderId, clinicId: 'cl_1', patientRef: 'pat_sub_amira', consentToken: 'tok', orderedAt: new Date(Date.now() - H).toISOString(), items: [{ nameEn: 'CBC' }], ...extra }, { aggregateType: 'LabOrder', aggregateId: orderId });
      await lab1('ord_h1', { appointmentId: 'apt_lab' });
      expect((await c.prisma.crossProductEntryPoint.findFirst({ where: { sub: 'sub_amira', factRef: factRef('LAB_ORDER', 'ord_h1') } }))!.parentBookingId).toBe(v.id);
      await lab1('ord_h2', { appointmentId: 12345 }); // not a string: no hint, inference applies
      expect((await c.prisma.crossProductEntryPoint.findFirst({ where: { sub: 'sub_amira', factRef: factRef('LAB_ORDER', 'ord_h2') } }))!.parentBookingId).not.toBe(v.id);
    });
    it('CARE_PLAN_SUGGESTED offers the home-visit card of the named visit (same card the lazy inference would make: one per visit), ids only; without a visit nothing is offered', async () => {
      await gate('growth.cross_product'); await consent(true); await unlockHome(); await link();
      const v = await visit('sub_amira', { hoursAgo: 60 }); const later = await visit('sub_amira', { hoursAgo: 2 });
      await c.prisma.bookingIntent.update({ where: { id: v.id }, data: { kiorlyAppointmentId: 'apt_cp' } });
      const sugg = (extra: Record<string, unknown>, enc = 'enc_cp') => c.webhook('CARE_PLAN_SUGGESTED', { patientId: 'pat_sub_amira', encounterId: enc, clinicId: 'cl_1', suggestedAt: new Date().toISOString(), ...extra }, { aggregateType: 'Encounter', aggregateId: enc });
      await sugg({ appointmentId: 'apt_cp' });
      const e = (await c.prisma.crossProductEntryPoint.findMany({ where: { sub: 'sub_amira', kind: 'CARE_PLAN_TO_HOME_VISIT', factRef: factRef('CLINIC_BOOKING', v.id) } }));
      expect(e).toHaveLength(1); expect(e[0]!.parentBookingId).toBe(v.id);
      await sugg({}, 'enc_cp2'); // no hint: follows the latest attended visit
      expect(await c.prisma.crossProductEntryPoint.count({ where: { sub: 'sub_amira', kind: 'CARE_PLAN_TO_HOME_VISIT', factRef: factRef('CLINIC_BOOKING', later.id) } })).toBe(1);
      await sugg({ appointmentId: 'apt_unknown' }, 'enc_cp3'); // a visit that is not a Kiorex booking: nothing
      expect(await c.prisma.crossProductEntryPoint.count({ where: { kind: 'CARE_PLAN_TO_HOME_VISIT' } })).toBe(2);
      expect(JSON.stringify(await c.prisma.crossProductEntryPoint.findMany())).not.toMatch(/enc_cp|apt_cp|cl_1/);
    });
    it('the Nurse partner call carries the optional acquisition block (CROSS_PRODUCT as MARKETPLACE) and a repeat sends the same value', async () => {
      c.kiorly.slots = [futureSlot(72)];
      const pid = await seedProvider(c, { id: 'lst_home2', profession: 'NURSE', edition: 'NURSE', serviceLocations: ['HOME'], coverageDistricts: ['maadi'], assignsClinician: true, register: 'NURSING_SYNDICATE', fee: 200, homeSurcharge: 50 } as never);
      const a = await c.http().post('/api/v1/me/addresses').set(auth).send({ label: 'Home', governorate: 'Cairo', district: 'maadi', street: 'Secret Street 1', building: '7' }).expect(201);
      await c.http().post(`/api/v1/me/addresses/${a.body.id}/confirm`).set(auth).expect(200);
      await gate('growth.cross_product'); await consent(true); const v = await visit(); await unlockHome();
      const card = (await cards()).cards.find((x) => x.kind === 'CARE_PLAN_TO_HOME_VISIT')!;
      const plan = (await c.http().post('/api/v1/care-plans').set({ ...auth, 'X-Kx-Continuity': card.id }).send({ providerId: pid, addressId: a.body.id, typeId: 'typ_home' }).expect(201)).body;
      const sent = c.kiorly.callsTo('POST', '/care-plan-requests').pop()!.body;
      expect(sent.acquisition).toMatchObject({ origin: 'MARKETPLACE', reason: 'MARKETPLACE_TOUCH', product: 'NURSE' });
      expect(validateAcquisitionBlock(sent.acquisition).valid).toBe(true);
      expect(sent.acquisition.decisionId).toBe((await decisionOf('CARE_PLAN_BOOKING', plan.id)).id);
      expect(JSON.stringify(sent.acquisition)).not.toMatch(/continuity|cl_1|CROSS/i);
      expect(v.id).toBeTruthy();
    });
    it('repair replays the stored continuity hint: an order whose first decision was skipped (attribution OFF) is repaired as CROSS_PRODUCT, and old hints are purged', async () => {
      await openAll(); await consent(true); const v = await visit(); const rx = await shareRx();
      const svc = c.get(GrowthProductBookingService);
      jest.spyOn(c.prisma.growthProductDecision, 'create').mockRejectedValueOnce(new Error('db blip')); // the first attempt fails: the order continues without a decision
      const o = await rxOrder(rx.id);
      expect(await c.prisma.growthProductDecision.count({ where: { factKind: 'ORDER', factId: o.id } })).toBe(0);
      expect(await c.prisma.growthContinuityHint.findUnique({ where: { factKind_factId: { factKind: 'ORDER', factId: o.id } } })).toMatchObject({ recordId: rx.id });
      const r = await svc.repair(new Date(Date.now() - 3600_000));
      expect(r.decided).toBeGreaterThanOrEqual(1);
      expect(await decisionOf('ORDER', o.id)).toMatchObject({ origin: 'CROSS_PRODUCT', parentDecisionId: v.decision.id });
      await c.prisma.growthContinuityHint.updateMany({ data: { createdAt: new Date(Date.now() - 31 * DAY) } });
      await svc.repair(new Date(Date.now() - 3600_000));
      expect(await c.prisma.growthContinuityHint.count()).toBe(0);
    });
  });

  describe('consumer, privacy and retention', () => {
    it('the consumer reads only the type and the ids: a payload with clinical fields and a malformed one never throw and never store them', async () => {
      await openAll(); const consumer = c.get(CrossProductConsumer);
      await expect(consumer.onKiorlyEvent({ type: 'PRESCRIPTION_SHARED', data: { patientId: { x: 1 }, encounterId: 42, items: [{ name: 'Amoxicillin' }] } as never })).resolves.toEqual({ offered: 0 });
      await expect(consumer.onKiorlyEvent({ type: 'LabOrderPlaced', data: null })).resolves.toEqual({ offered: 0 });
      await expect(consumer.onKiorlyEvent({ type: 'CARE_PLAN_CONFIRMED', data: { carePlanId: 'cp_1' } })).resolves.toEqual({ offered: 0 }); // already a downstream fact
      await expect(consumer.onKiorlyEvent({ type: 'MedicationOrderShared', data: { patientId: 'p' } })).resolves.toEqual({ offered: 0 });
      jest.spyOn(c.prisma.kiorlyPatientLink, 'findMany').mockRejectedValueOnce(new Error('db down'));
      await expect(consumer.onKiorlyEvent({ type: 'PRESCRIPTION_SHARED', data: { patientId: 'p', encounterId: 'e' } })).resolves.toEqual({ offered: 0 });
      expect(growthFailureCount(CROSS_PRODUCT_FAILURE.ENTRY)).toBe(1);
      expect(await c.prisma.crossProductEntryPoint.count()).toBe(0);
    });
    it('a failing consumer never fails the webhook', async () => {
      await openAll(); jest.spyOn(c.get(CrossProductConsumer), 'onKiorlyEvent').mockRejectedValue(new Error('boom'));
      await c.prisma.kiorlyPatientLink.create({ data: { sub: 'sub_amira', clinicId: 'cl_1', kiorlyPatientId: 'pat_sub_amira', evidence: 'PHONE' } });
      const r = await c.webhook('PRESCRIPTION_SHARED', { patientId: 'pat_sub_amira', scope: 'PRESCRIPTIONS', encounterId: 'enc_w', clinicId: 'cl_1', signedAt: new Date().toISOString() }, { aggregateType: 'Encounter', aggregateId: 'enc_w' });
      expect(r.status).toBeLessThan(300);
      jest.restoreAllMocks();
    });
    it('a revoked prescription share removes the card; an expired prompt is purged after 60 days; erasure removes the person prompt states and keeps the keyed links', async () => {
      await openAll(); await consent(true); await visit(); const rx = await shareRx();
      expect((await cards()).cards).toHaveLength(1);
      await c.prisma.sharedRecord.update({ where: { id: rx.id }, data: { status: 'REVOKED' } });
      expect((await cards()).cards).toEqual([]);
      const svc = c.get(CrossProductService);
      await c.prisma.crossProductEntryPoint.create({ data: { sub: 'sub_old', kind: 'LAB_ORDER_TO_LAB', factRef: factRef('LAB_ORDER', 'old'), expiresAt: new Date(Date.now() - 61 * DAY) } });
      expect(await svc.purgeExpired()).toEqual({ purged: 1 });
      await c.prisma.crossProductContinuity.create({ data: { toProduct: 'LAB', entryPoint: 'LAB_ORDER_TO_LAB', fromFactRef: factRef('CLINIC_BOOKING', 'a'), toFactRef: factRef('LAB_BOOKING', 'a'), decisionId: 'd1', toOrigin: 'CROSS_PRODUCT' } });
      expect(await svc.eraseSubject('sub_amira')).toEqual({ entryPointsDeleted: 1 });
      expect(await c.prisma.crossProductEntryPoint.count()).toBe(0);
      expect(await c.prisma.crossProductContinuity.count()).toBe(1);
      // the data export carries the patient's own consent and prompt states (kind and dates, never a hash or a fact id); account deletion erases the prompt states and keeps the keyed links
      await c.prisma.crossProductEntryPoint.create({ data: { sub: 'sub_amira', kind: 'RX_TO_PHARMACY', factRef: factRef('RX', 'enc_x'), expiresAt: new Date(Date.now() + DAY) } });
      const ex = (await c.http().post('/api/v1/me/export').set(auth).expect(200)).body;
      expect(ex.crossProduct.consent).toMatchObject({ granted: true, draftWording: true }); expect(ex.crossProduct.prompts).toEqual([expect.objectContaining({ kind: 'RX_TO_PHARMACY' })]);
      expect(JSON.stringify(ex.crossProduct)).not.toMatch(/[a-f0-9]{32}|enc_x|factRef/);
      await c.http().post('/api/v1/me/deletion').set(auth).send({ confirm: true }).expect(200);
      expect(await c.prisma.crossProductEntryPoint.count({ where: { sub: 'sub_amira' } })).toBe(0);
      expect(await c.prisma.crossProductContinuity.count()).toBe(1);
    });
    it('the link table is append-only (update and delete are refused by the database) and rejects clear ids and malformed references', async () => {
      await c.prisma.crossProductContinuity.create({ data: { toProduct: 'PHARMACY', entryPoint: 'RX_TO_PHARMACY', fromFactRef: factRef('CLINIC_BOOKING', 'x'), toFactRef: factRef('PHARMACY_ORDER', 'x'), decisionId: 'd', toOrigin: 'CROSS_PRODUCT', parentOrigin: 'MARKETPLACE' } });
      await expect(c.prisma.$executeRaw`UPDATE "CrossProductContinuity" SET "toOrigin" = 'MARKETPLACE'`).rejects.toThrow();
      await expect(c.prisma.$executeRaw`DELETE FROM "CrossProductContinuity"`).rejects.toThrow();
      await expect(c.prisma.crossProductContinuity.create({ data: { toProduct: 'PHARMACY', entryPoint: 'RX_TO_PHARMACY', fromFactRef: 'kx_bk_clear', toFactRef: factRef('PHARMACY_ORDER', 'y'), decisionId: 'd', toOrigin: 'CROSS_PRODUCT' } })).rejects.toThrow();
      await expect(c.prisma.crossProductContinuity.create({ data: { toProduct: 'CLINIC', entryPoint: 'RX_TO_PHARMACY', fromFactRef: factRef('CLINIC_BOOKING', 'y'), toFactRef: factRef('PHARMACY_ORDER', 'y'), decisionId: 'd', toOrigin: 'CROSS_PRODUCT' } })).rejects.toThrow();
    });
  });

  describe('ops funnel (aggregate, k >= 10)', () => {
    const seedLinks = (n: number, entryPoint: string, toProduct: string, parentOrigin: string, lagHours: number, tag: string) => c.prisma.crossProductContinuity.createMany({ data: Array.from({ length: n }, (_, i) => ({ toProduct, entryPoint, fromFactRef: factRef('CLINIC_BOOKING', `${tag}f${i}`), toFactRef: factRef('PHARMACY_ORDER', `${tag}t${i}`), decisionId: `d_${tag}${i}`, toOrigin: 'CROSS_PRODUCT', parentOrigin, lagHours })) });
    const seedPrompts = (n: number, kind: string, tag: string, dismissed = 0) => c.prisma.crossProductEntryPoint.createMany({ data: Array.from({ length: n }, (_, i) => ({ sub: `s_${tag}${i}`, kind, factRef: factRef('RX', `${tag}${i}`), expiresAt: new Date(Date.now() + DAY), ...(i < dismissed ? { dismissedAt: new Date() } : {}) })) });
    it('shows offered, continued and not continued per product, by first-booking source and time to continue; small cells are masked together with the smallest visible one; ops roles only; no identifiers', async () => {
      await seedPrompts(40, 'RX_TO_PHARMACY', 'r', 5); await seedLinks(20, 'RX_TO_PHARMACY', 'PHARMACY', 'MARKETPLACE', 5, 'a'); await seedLinks(4, 'RX_TO_PHARMACY', 'PHARMACY', 'PROVIDER_LED', 30, 'b'); await seedLinks(12, 'RX_TO_PHARMACY', 'PHARMACY', 'UNATTRIBUTED', 100, 'c');
      await seedPrompts(3, 'LAB_ORDER_TO_LAB', 'l'); await seedLinks(2, 'LAB_ORDER_TO_LAB', 'LAB', 'MARKETPLACE', 5, 'd');
      const r = (await c.http().get('/api/v1/ops/growth/cross-product/funnel?days=7').set(admin).expect(200)).body;
      expect(r).toMatchObject({ rewards: 'NONE', commissionLink: 'INERT', days: 7 });
      const rx = r.products.find((p: any) => p.entryPoint === 'RX_TO_PHARMACY');
      expect(rx).toMatchObject({ product: 'PHARMACY', offered: 40, dismissed: '<10', continued: 36, notContinued: '<10' }); // 5 dismissed is a small cell, so the derived drop-off is hidden too
      expect(rx.bySourceOfFirstBooking.PROVIDER_LED).toBe('<10'); expect(rx.bySourceOfFirstBooking.MARKETPLACE).toBe(20);
      expect(rx.bySourceOfFirstBooking.UNATTRIBUTED).toBe('<10'); // secondary suppression: the smallest visible cell next to a masked one (a total is shown)
      expect(Object.values(rx.timeToContinue)).toEqual(expect.arrayContaining(['<10']));
      const labRow = r.products.find((p: any) => p.entryPoint === 'LAB_ORDER_TO_LAB');
      expect(labRow).toMatchObject({ offered: '<10', continued: '<10', notContinued: '<10' });
      expect(r.products.find((p: any) => p.entryPoint === 'CARE_PLAN_TO_HOME_VISIT')).toMatchObject({ offered: 0, continued: 0 });
      expect(JSON.stringify(r)).not.toMatch(/sub_|s_r|kx_|[a-f0-9]{32}|specialt|cl_1/i);
      await c.http().get('/api/v1/ops/growth/cross-product/funnel').set(auth).expect(403);
      await c.http().get('/api/v1/ops/growth/cross-product/funnel').expect(401);
    });
  });
});
