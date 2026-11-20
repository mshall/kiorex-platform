import { Logger } from '@nestjs/common';
import { createCtx, futureSlot, seedProvider, TestCtx } from './harness';
import { homeEvents } from './fake-kiorly';
import { OutboxService } from '../src/outbox/outbox-public';
import { CatalogService } from '../src/catalog/catalog-public';
import { MockSafetyDelivery } from '../src/homecare/safety-delivery.adapter';

const STREET = '12 Secret Street Unique-9431';
const LANDMARK = 'Opposite the blue mosque 7788';
const DEV = (g: string) => `DEV-ONLY-NOT-A-REAL-GATE:${g}`;

describe('Rev 2.3 home visits: KXMHV01-10, KXMPAY07, KXMOP12 (extended fake Kiorly, contracts 1.5.0)', () => {
  let c: TestCtx; let auth: { Authorization: string }; let admin: { Authorization: string }; let pid: string; let addressId: string;
  const slot = futureSlot(72);
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });

  /** TEST FIXTURE gates (labelled DEV-ONLY, never a real approval): application code never records gates. */
  const unlock = async (...keys: string[]) => {
    for (const k of keys) {
      const need = k === 'kiorex.category.physiotherapy' ? ['GPR1'] : k === 'nurse.care_plans' ? ['GKN1'] : ['GHV1', 'GHV2'];
      for (const g of need) await c.flags.recordGate('TEST_FIXTURE', k, { gateId: DEV(g), approver: 'test fixture', approvedOn: new Date(), documentUrl: 'https://dev.invalid/fixture' });
    }
  };
  const homeOn = () => unlock('clinic.home_visits', 'kiorex.home_visits');
  const mkAddress = async (district = 'maadi', confirm = true) => {
    const a = await c.http().post('/api/v1/me/addresses').set(auth).send({ label: 'Home', governorate: 'Cairo', district, street: STREET, building: '7', floor: '3', flat: '9', landmark: LANDMARK }).expect(201);
    if (confirm) await c.http().post(`/api/v1/me/addresses/${a.body.id}/confirm`).set(auth).expect(200);
    return a.body.id as string;
  };
  const hold = (extra: object = {}) => c.http().post('/api/v1/bookings').set(auth).send({ providerId: pid, typeId: 'typ_home', ...slot, addressId, ...extra });
  const confirm = (id: string) => c.http().post(`/api/v1/bookings/${id}/confirm`).set(auth).send({ marketplaceConsent: true });
  const book = async () => { const h = await hold().expect(201); await confirm(h.body.id).expect(200); return h.body.id as string; };
  const row = (id: string) => c.prisma.bookingIntent.findUniqueOrThrow({ where: { id } });

  beforeEach(async () => {
    await c.reset();
    c.kiorly.slots = [slot, futureSlot(73)];
    pid = await seedProvider(c, { id: 'lst_home', profession: 'NURSE', edition: 'NURSE', serviceLocations: ['HOME'], coverageDistricts: ['maadi', 'nasr-city'], assignsClinician: true, register: 'NURSING_SYNDICATE', fee: 200, homeSurcharge: 50, feeServiceLocation: 'HOME', typeId: 'typ_home', depositAmount: 100, specialty: 'internal_medicine' });
    auth = await c.as('sub_amira'); admin = await c.as('adm1', { roles: ['super_admin', 'ops_admin'] });
    await c.http().put('/api/v1/me/profile').set(auth).send({ nameEn: 'Amira Samy' }).expect(200);
    await c.http().put('/api/v1/me/consents/REMINDERS').set(auth).send({ granted: true });
    await unlock('kiorex.category.physiotherapy');
    await homeOn();
    addressId = await mkAddress();
  });

  describe('flag catalogue + control plane', () => {
    it('15 new keys are registered; nurse.* is served in the kiorly-clinic snapshot; GHV needs BOTH gates', async () => {
      const keys = ['clinic.profession.physiotherapy', 'clinic.home_visits', 'clinic.home_route_view', 'clinic.home_dispatch', 'nurse.edition', 'nurse.individual_tenants', 'nurse.care_plans', 'nurse.mar', 'nurse.private_duty_shifts', 'nurse.family_updates', 'nurse.individual_kiorex_listing', 'kiorex.home_visits', 'kiorex.category.physiotherapy', 'kiorex.category.nursing', 'kiorex.visit_tracking'];
      const defs = await c.prisma.flagDefinition.findMany({ where: { key: { in: keys } } });
      expect(defs).toHaveLength(15);
      expect(defs.find((d) => d.key === 'nurse.mar')).toMatchObject({ launchLocked: true, gateIds: ['GKN1'], edition: 'NURSE', product: 'kiorly-nurse' });
      const snap = await c.flags.snapshot('kiorly-clinic');
      expect(snap.body.flags.map((f) => f.key)).toEqual(expect.arrayContaining(['nurse.edition', 'nurse.care_plans', 'clinic.home_visits']));
      await c.reset(); // pristine: no evidence at all
      expect((await c.flags.evaluate('kiorex.home_visits', { market: 'EG' })).reason).toBe('AWAITING_GATE');
      await c.flags.recordGate('t', 'clinic.home_visits', { gateId: DEV('GHV1'), approver: 'x', approvedOn: new Date(), documentUrl: 'https://dev.invalid/x' });
      expect((await c.flags.evaluate('clinic.home_visits')).effective).toBe(false); // GHV2 still missing
      await c.flags.recordGate('t', 'clinic.home_visits', { gateId: DEV('GHV2'), approver: 'x', approvedOn: new Date(), documentUrl: 'https://dev.invalid/x' });
      expect((await c.flags.evaluate('clinic.home_visits')).effective).toBe(true);
    });

    it('gate ids are validated, one human call can record a shared gate, and the board shows missing gates; app code records nothing', async () => {
      await c.reset();
      const bad = await c.http().put('/api/v1/admin/flags/kiorex.home_visits/gate').set(admin).send({ gateId: 'GPR1', approver: 'CEO', approvedOn: '2027-01-01', documentUrl: 'https://example.test/m' });
      expect(bad.status).toBe(400); expect(bad.body.code).toBe('GATE_ID_NOT_REQUIRED');
      expect(await c.prisma.flagGateEvidence.count({ where: { flagKey: { startsWith: 'kiorex.home' } } })).toBe(0);
      await c.http().put('/api/v1/admin/gates/GHV1').set(admin).send({ approver: 'CEO + counsel', approvedOn: '2027-01-01', documentUrl: 'https://example.test/ghv1' }).expect(200);
      const list = (await c.http().get('/api/v1/admin/flags').set(admin).expect(200)).body.find((f: any) => f.key === 'kiorex.home_visits');
      expect(list).toMatchObject({ gateIds: ['GHV1', 'GHV2'], missingGates: ['GHV2'], state: 'ON_AWAITING_GATE' });
      const board = (await c.http().get('/api/v1/admin/gates').set(admin).expect(200)).body;
      expect(board.gates.map((g: any) => g.gateId)).toEqual(expect.arrayContaining(['GHV1', 'GHV2', 'GPR1', 'GKN1', 'GKN2']));
    });

    it('kiorex.home_visits is a money-path flag: global OFF needs a second admin (two-person rule)', async () => {
      const a2 = await c.as('adm2', { roles: ['super_admin', 'ops_admin'] });
      const r = await c.http().put('/api/v1/admin/flags/kiorex.home_visits/values').set(admin).send({ scope: 'GLOBAL', value: 'OFF', reason: 'r', ticket: 'T-1' }).expect(200);
      expect(r.body.status).toBe('PENDING_APPROVAL');
      expect((await c.flags.evaluate('kiorex.home_visits', { market: 'EG' })).effective).toBe(true);
      await c.http().post(`/api/v1/admin/flags/requests/${r.body.requestId}/approve`).set(admin).expect(403);
      await c.http().post(`/api/v1/admin/flags/requests/${r.body.requestId}/approve`).set(a2).expect(200);
      expect((await c.flags.evaluate('kiorex.home_visits', { market: 'EG' })).effective).toBe(false);
    });

    it('per-cluster >=50 home-enabled provider gate metric (cluster = governorate); never satisfies a gate', async () => {
      const m = (await c.http().get('/api/v1/admin/home-visits/gate-metric').set(admin).expect(200)).body;
      expect(m.threshold).toBe(50);
      expect(m.clusters).toEqual([expect.objectContaining({ cluster: 'cairo', homeEnabledProviders: 1, met: false })]);
      expect(m).toMatchObject({ anyMet: false, allMet: false, safetyConsoleLive: true });
      for (let i = 2; i <= 50; i++) c.kiorly.providers.push({ ...c.kiorly.providers[0], listingId: `lst_h${i}`, clinicianId: `dr_h${i}` });
      await c.get(CatalogService).syncOnce();
      const m2 = (await c.http().get('/api/v1/admin/home-visits/gate-metric').set(admin).expect(200)).body;
      expect(m2.clusters[0]).toMatchObject({ homeEnabledProviders: 50, met: true, byCareType: { homeNursing: 50 } });
      expect(m2.gates.GHV1.requiredFor).toContain('kiorex.home_visits');
    });
  });

  describe('catalog projections and care types', () => {
    it('projects profession, care type, home capability and coverage districts (never an address); slots carry serviceLocation + district', async () => {
      const p = (await c.http().get(`/api/v1/providers/${pid}`).expect(200)).body;
      expect(p).toMatchObject({ profession: 'NURSE', careType: 'HOME_NURSING', edition: 'NURSE', verificationRegister: 'NURSING_SYNDICATE', assignsClinician: true, serviceLocations: ['HOME'] });
      expect(p.homeVisit).toEqual({ enabled: true, coverageDistricts: ['maadi', 'nasr-city'], homeSurchargeMinor: 5000 });
      expect(p.fees[0]).toMatchObject({ serviceLocation: 'HOME', amountMinor: 20000, homeSurchargeMinor: 5000, totalMinor: 25000 });
      expect(p.professionBadge.en).toBe('Verified nurse');
      const s = (await c.http().get(`/api/v1/providers/${pid}/slots?typeId=typ_home&serviceLocation=HOME&district=maadi`).expect(200)).body;
      expect(s.slots[0]).toMatchObject({ serviceLocation: 'HOME', district: 'maadi' });
      const call = c.kiorly.callsTo('GET', '/slots').pop()!;
      expect(call.path).toContain('/slots'); // query sent to Kiorly
    });

    it('home search: only in-zone providers; DISTRICT_REQUIRED; 422 OUT_OF_COVERAGE (explained, with suggestions) on slots', async () => {
      c.kiorly.providers.push({ ...c.kiorly.providers[0], listingId: 'lst_h2', clinicianId: 'dr_h2', coverageDistricts: ['heliopolis'] });
      await c.get(CatalogService).syncOnce();
      const r = (await c.http().get('/api/v1/search/providers?serviceLocation=HOME&district=maadi').expect(200)).body;
      expect(r.items.map((i: any) => i.id)).toEqual(['lst_home']);
      expect(r.items[0].homeVisit).toMatchObject({ enabled: true, homeSurchargeMinor: 5000, visitFeeIncludingSurchargeMinor: 25000 });
      expect(r.items[0].nextSlots[0]).toMatchObject({ serviceLocation: 'HOME', district: 'maadi' });
      await c.http().get('/api/v1/search/providers?serviceLocation=HOME').expect(400);
      const oc = await c.http().get(`/api/v1/providers/lst_h2/slots?typeId=typ_home&serviceLocation=HOME&district=maadi`);
      expect(oc.status).toBe(422);
      expect(oc.body).toMatchObject({ code: 'OUT_OF_COVERAGE', district: 'maadi', coverageDistricts: ['heliopolis'] });
      expect(oc.body.suggestedProviders.map((x: any) => x.id)).toEqual(['lst_home']);
      expect(oc.body.explanation.ar).toBeTruthy();
      c.kiorly.slotsMode = '422-coverage'; // Kiorly is the authority even when our projection says covered
      const k = await c.http().get(`/api/v1/providers/${pid}/slots?typeId=typ_home&serviceLocation=HOME&district=maadi&from=${encodeURIComponent(new Date(Date.now() + 5 * 86400_000).toISOString())}`);
      expect(k.status).toBe(422); expect(k.body.code).toBe('OUT_OF_COVERAGE');
    });

    it('care-type categories (Doctors · Physiotherapy · Home nursing) follow their flags; explicit disabled category is 403; emergency language still routes to 123', async () => {
      const ct = (await c.http().get('/api/v1/care-types').expect(200)).body;
      expect(ct.map((x: any) => [x.code, x.enabled])).toEqual([['DOCTORS', true], ['PHYSIOTHERAPY', true], ['HOME_NURSING', true]]);
      expect((await c.http().get('/api/v1/search/providers?careType=HOME_NURSING').expect(200)).body.items).toHaveLength(1);
      expect((await c.http().get('/api/v1/search/providers?careType=DOCTORS').expect(200)).body.items).toHaveLength(0);
      await c.flags.revokeGate('t', 'kiorex.category.physiotherapy', 'test');
      const r = await c.http().get('/api/v1/search/providers?careType=PHYSIOTHERAPY');
      expect(r.status).toBe(403); expect(r.body).toMatchObject({ code: 'FEATURE_DISABLED', key: 'kiorex.category.physiotherapy', scope: 'GATE' });
      const e = (await c.http().get('/api/v1/search/providers?careType=HOME_NURSING&q=chest%20pain').expect(200)).body;
      expect(e.emergency).toMatchObject({ number: '123' }); expect(e.items).toEqual([]);
      expect((await c.http().get('/api/v1/home/districts').expect(200)).body).toEqual([{ district: 'maadi', governorate: 'Cairo', homeEnabledProviders: 1 }, { district: 'nasr-city', governorate: 'Cairo', homeEnabledProviders: 1 }]);
    });
  });

  describe('address book (KXMHV01) and home booking (KXMHV02-04)', () => {
    it('address is encrypted at rest, only the owner gets doorstep lines, district must be a code, confirmation uses the verified phone', async () => {
      const raw = await c.prisma.patientAddress.findUniqueOrThrow({ where: { id: addressId } });
      expect(raw.addressEnc).not.toContain('Secret'); expect(raw.addressEnc.startsWith('v1.')).toBe(true);
      expect(raw.confirmedAt).toBeTruthy();
      const mine = (await c.http().get('/api/v1/me/addresses').set(auth).expect(200)).body;
      expect(mine[0]).toMatchObject({ street: STREET, landmark: LANDMARK, district: 'maadi', confirmed: true, isDefault: true, hasPin: true, pinSource: 'GEOCODED' });
      expect((await c.http().get('/api/v1/me/addresses').set(await c.as('sub_hassan')).expect(200)).body).toEqual([]);
      await c.http().put(`/api/v1/me/addresses/${addressId}`).set(await c.as('sub_hassan')).send({ label: 'x' }).expect(404);
      await c.http().post('/api/v1/me/addresses').set(auth).send({ label: 'x', governorate: 'Cairo', district: '12 Some Street, 3rd floor!', street: 's' }).expect(400);
      expect((await c.http().get('/api/v1/me/export').set(auth)).status).toBeLessThan(500);
      const ex = (await c.http().post('/api/v1/me/export').set(auth).expect(200)).body;
      expect(JSON.stringify(ex.addresses)).not.toContain('Secret'); // exports are persisted: district-level only
    });

    it('first home booking needs a confirmed address; a booking needs addressId; the hold carries visitAddress; fee incl. surcharge + deposit by default', async () => {
      const other = await mkAddress('nasr-city', false);
      await c.prisma.patientAddress.updateMany({ where: { id: addressId }, data: { confirmedAt: null } });
      const nc = await hold({ addressId: other });
      expect(nc.status).toBe(409); expect(nc.body.code).toBe('ADDRESS_NOT_CONFIRMED');
      await c.http().post(`/api/v1/me/addresses/${addressId}/confirm`).set(auth).expect(200);
      expect((await c.http().post('/api/v1/bookings').set(auth).send({ providerId: pid, typeId: 'typ_home', ...slot }).expect(400)).body.code).toBe('ADDRESS_REQUIRED');
      const h = await hold().expect(201);
      const holdCall = c.kiorly.callsTo('POST', '/holds')[0];
      expect(holdCall.body.visitAddress).toMatchObject({ district: 'maadi', line1: STREET, building: '7', floor: '3', flat: '9', landmark: LANDMARK });
      expect(h.body).toMatchObject({ serviceLocation: 'HOME', careType: 'HOME_NURSING', visitDistrict: 'maadi', feeMinor: 20000, depositStatus: 'REQUIRED', depositAmountMinor: 10000 });
      expect(h.body.home.fee).toMatchObject({ visitFeeMinor: 20000, homeSurchargeMinor: 5000, totalMinor: 25000, depositRequired: true });
      const done = (await confirm(h.body.id).expect(200)).body;
      expect(done.status).toBe('CONFIRMED');
      expect(done.home.assignmentPending).toBe(true); // agency: waits for HOME_VISIT_ASSIGNED
      expect(c.kiorly.callsTo('POST', '/bookings')[0].body).toMatchObject({ serviceLocation: 'HOME' });
      expect(JSON.stringify(c.kiorly.callsTo('POST', '/bookings')[0].body)).not.toContain('Secret'); // address is carried from the hold, not re-sent
      expect(c.kiorly.bad).toBe(0);
    });

    it('Kiorly 422 OUT_OF_COVERAGE on the hold and on book (zone changed): booking expires, hold released, in-zone suggestions', async () => {
      c.kiorly.holdMode = '422-coverage';
      const a = await hold();
      expect(a.status).toBe(422); expect(a.body).toMatchObject({ code: 'OUT_OF_COVERAGE', district: 'maadi' });
      expect((await c.prisma.bookingIntent.findFirstOrThrow({})).failureCode).toBe('OUT_OF_COVERAGE');
      c.kiorly.holdMode = undefined;
      const h = await hold().expect(201);
      c.kiorly.bookingMode = '422-coverage';
      const b = await confirm(h.body.id);
      expect(b.status).toBe(422); expect(b.body.code).toBe('OUT_OF_COVERAGE');
      expect((await row(h.body.id)).status).toBe('EXPIRED');
      expect(c.kiorly.callsTo('DELETE', '/holds/')).toHaveLength(1);
    });

    it('kiorex.home_visits OFF => 403 FEATURE_DISABLED for new home searches/holds/shares; booked visits stay readable; reversible', async () => {
      const id = await book();
      await c.http().put('/api/v1/admin/flags/kiorex.home_visits/values').set(admin).send({ scope: 'GLOBAL', value: 'OFF', reason: 't', ticket: 'T-1', emergency: true }).expect(200);
      for (const r of [await hold(), await c.http().get('/api/v1/search/providers?serviceLocation=HOME&district=maadi'), await c.http().get(`/api/v1/providers/${pid}/slots?typeId=typ_home&serviceLocation=HOME&district=maadi`), await c.http().post(`/api/v1/bookings/${id}/family-shares`).set(auth).send({ contactName: 'A', phone: '+201111111111', consentAttested: true })]) {
        expect(r.status).toBe(403); expect(r.body).toMatchObject({ code: 'FEATURE_DISABLED' });
      }
      expect((await c.http().get(`/api/v1/bookings/${id}`).set(auth).expect(200)).body.home.district).toBe('maadi');
      await c.http().put('/api/v1/admin/flags/kiorex.home_visits/values').set(admin).send({ scope: 'GLOBAL', value: 'ON', reason: 'r', ticket: 'T-1' }).expect(200);
      await hold().expect(201);
    });
  });

  describe('events: status timeline, agency assignment, unsafe abort (KXMHV05/06, KXMPAY07)', () => {
    it('ASSIGNED → EN_ROUTE → CHECKED_IN → COMPLETED drives the timeline; assignee shown (never a phone); stale events ignored; deduped', async () => {
      const id = await book(); const ref = { bookingId: id };
      expect((await c.webhook('HOME_VISIT_ASSIGNED', homeEvents.assigned(ref), { eventId: 'e_as' })).body.status).toBe('APPLIED');
      expect((await c.webhook('HOME_VISIT_ASSIGNED', homeEvents.assigned(ref), { eventId: 'e_as' })).body.status).toBe('DUPLICATE');
      let b = (await c.http().get(`/api/v1/bookings/${id}`).set(auth).expect(200)).body;
      expect(b.home.assignee).toEqual({ displayName: 'Nurse Mona Adel', photoUrl: 'https://cdn.kiorly.test/p/clin_9.jpg', badge: 'Verified nurse', profession: 'NURSE' });
      expect(b.home.assignmentPending).toBe(false); expect(b.home.subState).toBe('ASSIGNED');
      await c.webhook('HOME_VISIT_EN_ROUTE', homeEvents.enRoute({ ...ref, etaMinutes: 25 }));
      b = (await c.http().get(`/api/v1/bookings/${id}`).set(auth).expect(200)).body;
      expect(b.home.steps.map((s: any) => [s.key, s.reached])).toEqual([['CONFIRMED', true], ['ON_THE_WAY', true], ['ARRIVED', false], ['FINISHED', false]]);
      expect(b.home.eta).toEqual({ minutes: 25, shared: true });
      expect((await c.webhook('HOME_VISIT_ASSIGNED', homeEvents.assigned(ref), { eventId: 'e_late' })).body.status).toBe('IGNORED'); // stale
      await c.webhook('CHECKED_IN', { externalReference: id });
      expect((await row(id)).homeState).toBe('ARRIVED');
      expect((await c.webhook('HOME_VISIT_EN_ROUTE', homeEvents.enRoute(ref), { eventId: 'e_late2' })).body.status).toBe('IGNORED');
      await c.webhook('COMPLETED', { externalReference: id });
      b = (await c.http().get(`/api/v1/bookings/${id}`).set(auth).expect(200)).body;
      expect(b.home.steps.every((s: any) => s.reached)).toBe(true);
      expect(await c.prisma.message.count({ where: { bookingId: id, channel: 'INAPP' } })).toBeGreaterThanOrEqual(3); // confirmed, assigned, on the way
      const kinds = (await c.prisma.message.findMany({ where: { bookingId: id, channel: 'INAPP' } })).map((m) => (m.params as any).kind);
      expect(kinds).toEqual(expect.arrayContaining(['HOME_VISIT_ASSIGNED', 'HOME_VISIT_EN_ROUTE']));
    });

    it('kiorex.visit_tracking OFF: on-the-way updates are suppressed (timeline without them)', async () => {
      const id = await book();
      await c.http().put('/api/v1/admin/flags/kiorex.visit_tracking/values').set(admin).send({ scope: 'GLOBAL', value: 'OFF', reason: 't', ticket: 'T-1' }).expect(200);
      expect((await c.webhook('HOME_VISIT_EN_ROUTE', homeEvents.enRoute({ bookingId: id, etaMinutes: 10 }))).body.status).toBe('IGNORED');
      const b = (await c.http().get(`/api/v1/bookings/${id}`).set(auth).expect(200)).body;
      expect(b.home).toMatchObject({ subState: null, trackingEnabled: false });
    });

    it('home events for a clinic booking or an unknown booking are ignored safely', async () => {
      c.kiorly.slots = [slot]; const clinicPid = await seedProvider(c, { id: 'lst_cl', clinicianId: 'dr_cl' });
      const h = await c.http().post('/api/v1/bookings').set(auth).send({ providerId: clinicPid, typeId: 'typ_1', ...slot }).expect(201);
      await c.http().post(`/api/v1/bookings/${h.body.id}/confirm`).set(auth).send({ marketplaceConsent: true }).expect(200);
      expect((await c.webhook('HOME_VISIT_EN_ROUTE', homeEvents.enRoute({ bookingId: h.body.id }))).body.status).toBe('IGNORED');
      expect((await c.webhook('HOME_VISIT_EN_ROUTE', homeEvents.enRoute({ bookingId: 'kx_bk_nope', appointmentId: 'apt_nope' }))).status).toBe(200);
    });

    const payDeposit = async (id: string) => {
      const co = await c.http().post(`/api/v1/bookings/${id}/deposit-checkout`).set(auth).expect(200);
      await c.http().post(`/api/v1/pay/fake-checkout/${co.body.paymentId}/complete`).send({ outcome: 'pay' }).expect(200);
      await c.get(OutboxService).processBatch();
      return co.body.paymentId as string;
    };
    it('unsafe abort: CANCELLED (never no-show, no counter, no forfeiture), deposit HOLD_FOR_REVIEW, ops releases or refunds with a reason', async () => {
      const id = await book(); const payId = await payDeposit(id);
      expect((await row(id)).depositStatus).toBe('PAID');
      expect((await c.webhook('HOME_VISIT_ABORTED_UNSAFE', homeEvents.abortedUnsafe({ bookingId: id, district: 'maadi' }))).body.status).toBe('APPLIED');
      const b = await row(id);
      expect(b).toMatchObject({ status: 'CANCELLED', cancelledBy: 'SAFETY', cancellationReason: 'UNSAFE_ABORT', homeState: 'ABORTED_UNSAFE', depositStatus: 'HOLD_FOR_REVIEW' });
      expect((await c.prisma.patientProfile.findFirstOrThrow({ where: { sub: 'sub_amira' } })).noShowCount).toBe(0);
      expect((await c.webhook('NO_SHOW', { externalReference: id })).body.status).toBe('IGNORED'); // never a no-show
      const pay = await c.prisma.paymentIntent.findUniqueOrThrow({ where: { id: payId } });
      expect(pay).toMatchObject({ reviewState: 'HELD_FOR_REVIEW', releasedAt: null, refundedMinor: 0 });
      const bal = (acct: string) => c.prisma.ledgerEntry.aggregate({ where: { account: acct }, _sum: { debitMinor: true, creditMinor: true } }).then((x) => (x._sum.creditMinor ?? 0) - (x._sum.debitMinor ?? 0));
      expect(await bal('REVIEW_HOLD:cl_1')).toBe(10000); expect(await bal('HELD:cl_1')).toBe(0);
      const view = (await c.http().get(`/api/v1/bookings/${id}`).set(auth).expect(200)).body;
      expect(view.home.aborted).toMatchObject({ noShow: false, depositUnderReview: true });
      // nothing moves it automatically
      await c.get(CatalogService); await c.http().post('/api/v1/admin/payouts/run').set(admin).expect(200);
      await c.http().post('/api/v1/admin/reconciliation/bookings/run').set(admin).expect(200);
      expect((await c.prisma.paymentIntent.findUniqueOrThrow({ where: { id: payId } })).reviewState).toBe('HELD_FOR_REVIEW');
      const q = (await c.http().get('/api/v1/admin/payments/held-for-review').set(admin).expect(200)).body;
      expect(q[0]).toMatchObject({ paymentId: payId, bookingId: id, amountMinor: 10000, district: 'maadi' });
      expect((await c.http().get('/api/v1/admin/payments/dashboard').set(admin).expect(200)).body.heldForReview).toEqual({ count: 1, amountMinor: 10000 });
      await c.http().post(`/api/v1/admin/payments/${payId}/review/refund`).set(admin).send({}).expect(400);
      await c.http().post(`/api/v1/admin/payments/${payId}/review/refund`).set(admin).send({ reason: 'patient not at fault' }).expect(200);
      await c.get(OutboxService).processBatch();
      expect(await bal('REVIEW_HOLD:cl_1')).toBe(0);
      expect((await row(id)).depositStatus).toBe('REFUNDED');
      await c.http().post(`/api/v1/admin/payments/${payId}/review/release`).set(admin).send({ reason: 'x' }).expect(409);
      expect((await c.http().get('/api/v1/admin/reconciliation/runs').set(admin).expect(200)).body).toBeDefined();
    });

    it('review release sends the deposit to the provider payable; ledger stays balanced', async () => {
      const id = await book(); const payId = await payDeposit(id);
      await c.webhook('HOME_VISIT_ABORTED_UNSAFE', homeEvents.abortedUnsafe({ bookingId: id }));
      await c.http().post(`/api/v1/admin/payments/${payId}/review/release`).set(admin).send({ reason: 'provider not at fault; reviewed' }).expect(200);
      await c.get(OutboxService).processBatch();
      expect((await row(id)).depositStatus).toBe('RELEASED');
      const t = await c.prisma.ledgerEntry.aggregate({ _sum: { debitMinor: true, creditMinor: true } });
      expect(t._sum.debitMinor).toBe(t._sum.creditMinor);
      const payable = await c.prisma.ledgerEntry.aggregate({ where: { account: 'PAYABLE:cl_1' }, _sum: { creditMinor: true } });
      expect(payable._sum.creditMinor).toBe(10000);
      expect((await c.prisma.auditLog.findMany({ where: { action: 'pay.review_release' } }))).toHaveLength(1);
    });

    it('an abort before any deposit was paid just cancels (nothing to hold)', async () => {
      const id = await book();
      await c.webhook('HOME_VISIT_ABORTED_UNSAFE', homeEvents.abortedUnsafe({ bookingId: id }));
      expect(await row(id)).toMatchObject({ status: 'CANCELLED', depositStatus: 'NONE' });
    });
  });

  describe('address masking after the visit (KXMHV10) and no leaks', () => {
    it('address visible to the owner until 24 h after the visit, then district only; the sweep wipes the ciphertext', async () => {
      const id = await book();
      expect((await c.http().get(`/api/v1/bookings/${id}`).set(auth).expect(200)).body.home.address).toMatchObject({ masked: false, address: { street: STREET } });
      await c.webhook('COMPLETED', { externalReference: id });
      expect((await c.prisma.bookingVisitAddress.findUniqueOrThrow({ where: { bookingId: id } })).maskAfter).toBeTruthy();
      expect((await c.http().get(`/api/v1/bookings/${id}`).set(auth).expect(200)).body.home.address.masked).toBe(false); // < 24 h
      await c.prisma.bookingVisitAddress.update({ where: { bookingId: id }, data: { maskAfter: new Date(Date.now() - 1000) } });
      const v = (await c.http().get(`/api/v1/bookings/${id}`).set(auth).expect(200)).body.home.address; // lazily masked even before the sweep
      expect(v).toMatchObject({ masked: true, district: 'maadi', address: null });
      await c.prisma.bookingVisitAddress.update({ where: { bookingId: id }, data: { maskAfter: new Date(Date.now() - 1000) } });
      const { AddressService } = await import('../src/address/address-public');
      expect(await c.get(AddressService).maskExpired()).toBe(1);
      expect((await c.prisma.bookingVisitAddress.findUniqueOrThrow({ where: { bookingId: id } })).addressEnc).toBeNull();
    });

    it('PHI/address leak test: street, building, landmark never reach logs, analytics, receipts, audit, booking events or the message log', async () => {
      const lines: string[] = [];
      const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((m) => jest.spyOn(Logger.prototype, m).mockImplementation((...a: any[]) => { lines.push(a.map(String).join(' ')); }));
      const out = jest.spyOn(process.stdout, 'write').mockImplementation(((s: any) => { lines.push(String(s)); return true; }) as any);
      const cons = (['log', 'warn', 'error', 'info'] as const).map((m) => jest.spyOn(console, m).mockImplementation((...a: any[]) => { lines.push(a.map(String).join(' ')); }));
      try {
        const id = await book();
        await c.http().post(`/api/v1/bookings/${id}/family-shares`).set(auth).send({ contactName: 'Mum', phone: '+201111111111', consentAttested: true, visitStatusSharingConsent: true }).expect(201);
        await c.webhook('HOME_VISIT_ASSIGNED', homeEvents.assigned({ bookingId: id }));
        await c.webhook('HOME_VISIT_EN_ROUTE', homeEvents.enRoute({ bookingId: id }));
        await c.webhook('SAFETY_ALERT_RAISED', homeEvents.safetyAlert({ bookingId: id, district: 'maadi' }));
        await c.webhook('HOME_VISIT_ABORTED_UNSAFE', homeEvents.abortedUnsafe({ bookingId: id, district: 'maadi' }));
        await c.http().get(`/api/v1/admin/bookings/${id}/timeline`).set(admin).expect(200);
        await c.http().post('/api/v1/analytics/events').send({ events: [{ name: 'home_search_started', props: { district: 'maadi', careType: 'HOME_NURSING', serviceLocation: 'HOME' } }] }).expect(202);
      } finally { [...spies, out, ...cons].forEach((s) => s.mockRestore()); }
      const needles = [STREET, 'Unique-9431', LANDMARK, '7788'];
      const dump = async () => JSON.stringify([
        lines, await c.prisma.analyticsEvent.findMany(), await c.prisma.webhookReceipt.findMany(), await c.prisma.auditLog.findMany(), await c.prisma.bookingEvent.findMany(), await c.prisma.messageLog.findMany(), await c.prisma.message.findMany(),
        await c.prisma.outboxEvent.findMany(), await c.prisma.safetyAlert.findMany(), await c.prisma.complaint.findMany(), await c.prisma.provider.findMany({ select: { raw: true, coverageDistricts: true } }),
      ]);
      const all = await dump();
      for (const n of needles) expect(all).not.toContain(n);
      // the encrypted columns hold ciphertext only
      for (const r of await c.prisma.patientAddress.findMany()) expect(r.addressEnc).not.toContain('Secret');
      const ev = await c.prisma.analyticsEvent.findMany({ where: { district: { not: null } } });
      expect(ev.length).toBeGreaterThan(0); expect(ev.every((e) => /^[a-z0-9-]+$/.test(e.district!))).toBe(true);
    });

    it('analytics rules: district-level whitelist only; addresses, coordinates and free text rejected; server events carry location dims', async () => {
      const post = (props: object) => c.http().post('/api/v1/analytics/events').send({ events: [{ name: 'home_search_started', props }] });
      await post({ district: 'maadi', careType: 'HOME_NURSING', serviceLocation: 'HOME' }).expect(202);
      for (const bad of [{ district: STREET }, { district: 'Maadi, 12 Street' }, { line1: 'x' }, { address: 'x' }, { lat: '30.1' }, { lng: '31.2' }, { careType: 'NURSE_X' }, { serviceLocation: 'MOON' }]) expect((await post(bad)).status).toBe(400);
      const id = await book();
      await c.webhook('CHECKED_IN', { externalReference: id }); await c.webhook('COMPLETED', { externalReference: id });
      const att = await c.prisma.analyticsEvent.findFirstOrThrow({ where: { name: 'visit_attended' } });
      expect(att).toMatchObject({ careType: 'HOME_NURSING', serviceLocation: 'HOME', district: 'maadi' });
    });
  });

  describe('family share (KXMHV07), safety card + report (KXMHV09), safety console (KXMOP12/05)', () => {
    it('family share: needs both consents, max 3, WhatsApp via the mock adapter, status-only public link, STOP, updates follow events', async () => {
      const id = await book();
      const share = (n: number, extra: object = {}) => c.http().post(`/api/v1/bookings/${id}/family-shares`).set(auth).send({ contactName: `C${n}`, phone: `+20111111111${n}`, consentAttested: true, visitStatusSharingConsent: true, ...extra });
      expect((await share(1, { consentAttested: false })).body.code).toBe('CONTACT_CONSENT_REQUIRED');
      expect((await share(1, { visitStatusSharingConsent: false })).body.code).toBe('CONSENT_REQUIRED'.replace('CONSENT_REQUIRED', 'CONSENT_REQUIRED'));
      const s1 = (await share(1).expect(201)).body;
      expect(s1.link).toContain('/visit-status/'); expect(s1.phoneMasked).toContain('****');
      const invite = await c.prisma.messageLog.findFirstOrThrow({ where: { channel: 'WHATSAPP', templateId: 'TODO_NEEDS_HUMAN_home_visit_family_invite' } });
      expect(invite.body).toContain(s1.link); expect(invite.mode).toBe('mock');
      expect((await share(1)).body.code).toBe('FAMILY_CONTACT_EXISTS');
      await share(2).expect(201); await share(3).expect(201);
      expect((await share(4)).body.code).toBe('FAMILY_SHARE_LIMIT');
      const token = s1.link.split('/visit-status/')[1];
      await c.webhook('HOME_VISIT_EN_ROUTE', homeEvents.enRoute({ bookingId: id, etaMinutes: 12 }));
      expect(await c.prisma.messageLog.count({ where: { templateId: 'TODO_NEEDS_HUMAN_home_visit_family_update' } })).toBe(3);
      const pub = (await c.http().get(`/api/v1/public/visit-status/${token}`).expect(200)).body;
      expect(pub).toMatchObject({ patientFirstName: 'Amira', subState: 'EN_ROUTE', stopped: false });
      const text = JSON.stringify(pub);
      for (const n of [STREET, 'maadi', '20000', 'sub_amira', 'typ_home']) expect(text).not.toContain(n);
      await c.http().post(`/api/v1/public/visit-status/${token}/stop`).expect(200);
      await c.http().get(`/api/v1/public/visit-status/${token}`).expect(404);
      await c.http().get('/api/v1/public/visit-status/not-a-token').expect(404);
      await c.webhook('CHECKED_IN', { externalReference: id });
      expect(await c.prisma.messageLog.count({ where: { templateId: 'TODO_NEEDS_HUMAN_home_visit_family_update' } })).toBe(5); // 2 remaining contacts only
      await c.http().put('/api/v1/me/consents/VISIT_STATUS_SHARING').set(auth).send({ granted: false });
      await c.webhook('COMPLETED', { externalReference: id });
      expect(await c.prisma.messageLog.count({ where: { templateId: 'TODO_NEEDS_HUMAN_home_visit_family_update' } })).toBe(5); // consent withdrawn => stops
      expect(await c.prisma.familyShare.count({ where: { status: 'ACTIVE' } })).toBe(0);
    });

    it('safety card shows provider photo, name and badge; report a problem routes to ops with a 1 h SLA (home) vs 24 h (clinic)', async () => {
      const id = await book();
      await c.webhook('HOME_VISIT_ASSIGNED', homeEvents.assigned({ bookingId: id }));
      const card = (await c.http().get(`/api/v1/bookings/${id}/safety-card`).set(auth).expect(200)).body;
      expect(card).toMatchObject({ emergencyNumber: '123', assignmentPending: false, provider: { displayName: 'Nurse Mona Adel', badge: 'Verified nurse', photoUrl: expect.any(String), verified: true } });
      await c.http().get(`/api/v1/bookings/${id}/safety-card`).set(await c.as('sub_hassan')).expect(404);
      const r = (await c.http().post(`/api/v1/bookings/${id}/report-problem`).set(auth).send({ category: 'SAFETY', body: 'felt unsafe' }).expect(201)).body;
      expect(r.homeVisit).toBe(true);
      const mins = (new Date(r.slaDueAt).getTime() - Date.now()) / 60_000;
      expect(mins).toBeGreaterThan(55); expect(mins).toBeLessThanOrEqual(60);
      const q = (await c.http().get('/api/v1/admin/complaints').set(admin).expect(200)).body;
      expect(q[0]).toMatchObject({ homeVisit: true, category: 'HOME_SAFETY' }); expect(q[0].minutesToSla).toBeLessThanOrEqual(60);
      const cl = (await c.http().post('/api/v1/complaints').set(auth).send({ category: 'SERVICE', body: 'slow' }).expect(201)).body;
      expect((new Date(cl.slaDueAt).getTime() - Date.now()) / 3600_000).toBeGreaterThan(20);
    });

    it('SAFETY_ALERT_RAISED: stored once (alertId), delivered to ops with SLO fields, acknowledge / escalate / resolve, feed + summary + escalation log; undelivered alerts are retried and auto-escalated', async () => {
      const id = await book();
      const alertData = homeEvents.safetyAlert({ bookingId: id, alertId: 'al_1', district: 'maadi' });
      expect((await c.webhook('SAFETY_ALERT_RAISED', alertData, { aggregateType: 'SafetyAlert', aggregateId: 'al_1' })).body.status).toBe('APPLIED');
      expect((await c.webhook('SAFETY_ALERT_RAISED', alertData, { aggregateId: 'al_1' })).body.status).toBe('IGNORED'); // different eventId, same alertId
      expect((await c.webhook('SAFETY_ALERT_RAISED', { ...alertData, alertId: 'al_org', deliverTo: ['ORG_SAFETY_CONTACT'] })).body.status).toBe('IGNORED');
      const feed = (await c.http().get('/api/v1/admin/safety/alerts').set(admin).expect(200)).body.items;
      expect(feed).toHaveLength(1);
      expect(feed[0]).toMatchObject({ alertId: 'al_1', kind: 'SOS', status: 'RAISED', bookingId: id, district: 'maadi', slo: { seconds: 60, met: true, breached: false }, delivery: { mode: 'mock' }, needsEscalation: false });
      expect(feed[0].slo.deliveryLagSeconds).toBeLessThan(60);
      const sid = feed[0].id;
      const ack = (await c.http().post(`/api/v1/admin/safety/alerts/${sid}/acknowledge`).set(admin).send({ note: 'calling provider' }).expect(200)).body;
      expect(ack).toMatchObject({ status: 'ACKNOWLEDGED', acknowledgedBy: 'adm1' });
      const esc = (await c.http().post(`/api/v1/admin/safety/alerts/${sid}/escalate`).set(admin).send({ note: 'no answer' }).expect(200)).body;
      expect(esc).toMatchObject({ status: 'ESCALATED', escalationLevel: 1 });
      expect(esc.actions.map((a: any) => a.action)).toEqual(expect.arrayContaining(['RECEIVED', 'DELIVERED', 'ACKNOWLEDGE', 'ESCALATE']));
      expect((await c.http().get('/api/v1/admin/safety/escalations').set(admin).expect(200)).body[0]).toMatchObject({ alertId: 'al_1', action: 'ESCALATE' });
      await c.http().post(`/api/v1/admin/safety/alerts/${sid}/resolve`).set(admin).send({}).expect(200);
      await c.http().post(`/api/v1/admin/safety/alerts/${sid}/escalate`).set(admin).send({}).expect(409);
      // undelivered: retried by the sweep, auto-escalated after 10 min unacknowledged
      MockSafetyDelivery.failNext = 1;
      await c.webhook('SAFETY_ALERT_RAISED', homeEvents.safetyAlert({ alertId: 'al_2', bookingId: id, kind: 'TIMER_EXPIRED', raisedAt: new Date(Date.now() - 11 * 60_000).toISOString() }));
      const al2 = (await c.http().get('/api/v1/admin/safety/alerts?kind=TIMER_EXPIRED').set(admin).expect(200)).body.items[0];
      expect(al2).toMatchObject({ delivery: { error: 'MOCK_PAGER_DOWN' }, needsEscalation: true, slo: { breached: true } });
      const sw = (await c.http().post('/api/v1/admin/safety/sweep').set(admin).expect(200)).body;
      expect(sw).toEqual({ retried: 1, escalated: 1 });
      expect((await c.http().get(`/api/v1/admin/safety/alerts/${al2.id}`).set(admin).expect(200)).body).toMatchObject({ status: 'ESCALATED', slo: { met: false }, escalationLevel: 1 });
      const sum = (await c.http().get('/api/v1/admin/safety/summary').set(admin).expect(200)).body;
      expect(sum).toMatchObject({ total: 2, sloSeconds: 60, ackEscalateMinutes: 10, deliveryMode: 'mock' });
      expect((await c.http().get('/api/v1/admin/safety/unsafe-aborts').set(admin).expect(200)).body).toEqual([]);
      await c.http().get('/api/v1/admin/safety/alerts').set(auth).expect(403);
      expect((await c.http().get('/api/v1/admin/liquidity').set(admin).expect(200)).body.safetyAlerts.total).toBe(2);
    });
  });

  describe('care plans (KXMHV08, P3 draft)', () => {
    it('behind nurse.care_plans (GKN1): 403 GATE until a human records it; then request → CARE_PLAN_CONFIRMED creates one booking with a schedule → visits have own status → plan end', async () => {
      const body = { providerId: pid, addressId, typeId: 'typ_home', notes: 'wound care' };
      const locked = await c.http().post('/api/v1/care-plans').set(auth).send(body);
      expect(locked.status).toBe(403); expect(locked.body).toMatchObject({ code: 'FEATURE_DISABLED', key: 'nurse.care_plans', scope: 'GATE' });
      await unlock('nurse.care_plans');
      const plan = (await c.http().post('/api/v1/care-plans').set(auth).send(body).expect(201)).body;
      expect(plan).toMatchObject({ status: 'REQUESTED', district: 'maadi', visits: [] });
      expect(c.kiorly.carePlanRequests.get(plan.id)!.body).toMatchObject({ requestRef: plan.id, clinicId: 'cl_1', visitAddress: { district: 'maadi', line1: STREET } });
      const v = [futureSlot(100), futureSlot(124)].map((s, i) => ({ appointmentId: `apt_cp${i}`, ...s }));
      expect((await c.webhook('CARE_PLAN_CONFIRMED', homeEvents.carePlanConfirmed({ requestRef: plan.id, visits: v }), { aggregateType: 'CarePlan', aggregateId: 'cp_1' })).body.status).toBe('APPLIED');
      let p = (await c.http().get(`/api/v1/care-plans/${plan.id}`).set(auth).expect(200)).body;
      expect(p.status).toBe('CONFIRMED'); expect(p.visits).toHaveLength(2);
      await c.webhook('CHECKED_IN', { appointmentId: 'apt_cp0' }, { aggregateId: 'apt_cp0' }); await c.webhook('COMPLETED', { appointmentId: 'apt_cp0' }, { aggregateId: 'apt_cp0' });
      p = (await c.http().get(`/api/v1/care-plans/${plan.id}`).set(auth).expect(200)).body;
      expect(p.visits.map((x: any) => x.status)).toEqual(['COMPLETED', 'CONFIRMED']); expect(p.completedVisits).toBe(1);
      await c.webhook('CARE_PLAN_ENDED', homeEvents.carePlanEnded({ requestRef: plan.id, reason: 'CANCELLED_BY_PROVIDER', completed: 1, cancelledAppointmentIds: ['apt_cp1'] }), { aggregateType: 'CarePlan' });
      p = (await c.http().get(`/api/v1/care-plans/${plan.id}`).set(auth).expect(200)).body;
      expect(p).toMatchObject({ status: 'ENDED', endedReason: 'CANCELLED_BY_PROVIDER' }); expect(p.visits.map((x: any) => x.status)).toEqual(['COMPLETED', 'CANCELLED']);
      expect((await c.http().get('/api/v1/care-plans').set(auth).expect(200)).body).toHaveLength(1);
    });
    it('provider that does not offer care plans: 422 from Kiorly surfaces as a rejected request', async () => {
      await unlock('nurse.care_plans'); c.kiorly.carePlanMode = '422-not-offered';
      const r = await c.http().post('/api/v1/care-plans').set(auth).send({ providerId: pid, addressId });
      expect(r.status).toBe(400); expect(r.body.code).toBe('CARE_PLANS_NOT_OFFERED');
    });
  });
});
