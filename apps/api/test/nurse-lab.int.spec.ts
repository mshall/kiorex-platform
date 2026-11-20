import { createCtx, TestCtx } from './harness';
import { FakePartner } from './fake-partner';
import { OutboxService } from '../src/outbox/outbox-public';
import { NurseLabRelayService } from '../src/lab/lab-public';
import { PartnerRegistry } from '../src/partners/partners-public';

const NOW = () => new Date().toISOString();

/** A Nurse-edition `LabOrderPlaced` exactly as Kiorly Clinic emits it (kiorex-contracts 1.6.0, fixtures/nurse-lab-handoff-v1.6.json shape). */
const placed = (o: Record<string, unknown> = {}) => ({
  orderId: 'ord_n1', encounterId: undefined, clinicId: 'cl_n1', patientRef: 'pat_n1', orderingClinicianId: 'usr_nurse', consentToken: 'rsc_0123456789abcdef0123456789abcdef', orderedAt: NOW(),
  items: [{ code: 'CBC', nameEn: 'Complete blood count' }], originEdition: 'NURSE', prescriberName: 'Dr Hesham Nabil', identifiersChecked: ['fullName', 'dateOfBirth'],
  patient: { fullName: 'Amira Samy', dateOfBirth: '1990-04-12', sex: 'F', phone: '+201000000001' },
  nurseCollection: { visitRef: 'apt_n1', collectorRef: 'usr_nurse', collectorName: 'Nurse Mona', collectedAt: new Date(Date.now() - 1_200_000).toISOString(), handedOverAt: new Date(Date.now() - 300_000).toISOString(), temperatureC: 5, samples: [{ label: 'NRS-0001-A', specimenType: 'BLOOD', container: 'EDTA' }] },
  ...o,
});

describe('KNLAB01 Nurse -> Kiorex -> Lab relay (fake clinic + fake lab that enforces the ratified inbound-order contract)', () => {
  let c: TestCtx; let lab: FakePartner;
  beforeAll(async () => { c = await createCtx(); lab = await new FakePartner('lab').start(); });
  afterAll(async () => { await c.close(); await lab.stop(); });
  beforeEach(async () => { await c.reset(); lab.reset(); });
  const flush = () => c.get(OutboxService).processBatch();
  const send = (type: string, data: Record<string, unknown>, o: Record<string, unknown> = {}) => c.webhook(type, data, { aggregateType: 'LabOrder', aggregateId: String(data.orderId ?? 'x'), ...o });
  const labEvent = (type: string, data: Record<string, unknown>) => { const e = lab.event(type, data, { aggregateId: String(data.orderId) }); return c.http().post(e.path).set(e.headers).send(e.body); };

  it('relays a Nurse LabOrderPlaced to the lab with the KIORLY_NURSE client (contract-valid strict body), then tells the clinic ACCEPTED', async () => {
    const r = await send('LabOrderPlaced', placed());
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('APPLIED');
    const call = lab.callsTo('POST', '/orders')[0];
    expect(lab.contractViolations).toEqual([]);
    expect(call.headers['x-kiorly-client-key']).toBe('kl_dev_nurse'); // the second registration, not the booking client
    expect(call.headers['idempotency-key']).toBe('ord_n1');
    expect(call.body).toMatchObject({
      sourceRef: 'ord_n1', testCodes: ['CBC'], priority: 'ROUTINE', identifiersChecked: ['fullName', 'dateOfBirth'], consentChannels: ['KIORLY_NURSE_IMPORT'],
      patient: { fullName: 'Amira Samy', externalId: 'pat_n1', dateOfBirth: '1990-04-12', sex: 'F' }, referringDoctor: { name: 'Dr Hesham Nabil', ref: 'usr_nurse' },
      nurseCollection: { visitRef: 'apt_n1', collectorRef: 'usr_nurse', temperatureC: 5, consentToken: 'rsc_0123456789abcdef0123456789abcdef', samples: [{ label: 'NRS-0001-A', specimenType: 'BLOOD', container: 'EDTA' }] },
    });
    expect(call.body.collection).toBeUndefined(); // never an address, never a home collection
    const relay = await c.prisma.nurseLabRelay.findUniqueOrThrow({ where: { id: 'ord_n1' } });
    expect(relay).toMatchObject({ status: 'SUBMITTED', clinicId: 'cl_n1', partnerOrderId: 'lbo_1', labOrderNumber: 'TL-1' });
    await flush();
    expect(c.kiorly.labStatusPushes).toHaveLength(1);
    expect(c.kiorly.labStatusPushes[0]).toMatchObject({ orderId: 'ord_n1', body: { status: 'ACCEPTED', labOrderNumber: 'TL-1' } });
  });

  it('keeps no demographics: the webhook receipt and the relay row hold ids and statuses only', async () => {
    await send('LabOrderPlaced', placed());
    const dump = JSON.stringify([await c.prisma.webhookReceipt.findMany(), await c.prisma.nurseLabRelay.findMany(), await c.prisma.outboxEvent.findMany()]);
    for (const secret of ['Amira Samy', '1990-04-12', '+201000000001', 'rsc_0123456789abcdef', 'NRS-0001-A', 'Nurse Mona']) expect(dump).not.toContain(secret);
  });

  it('is idempotent: a redelivered event id is a DUPLICATE, a new event id for the same order never reaches the lab twice', async () => {
    await send('LabOrderPlaced', placed(), { eventId: 'ev_same' });
    expect((await send('LabOrderPlaced', placed(), { eventId: 'ev_same' })).body.status).toBe('DUPLICATE');
    await send('LabOrderPlaced', placed(), { eventId: 'ev_other' });
    expect(lab.callsTo('POST', '/orders')).toHaveLength(1);
    expect(await c.prisma.nurseLabRelay.count()).toBe(1);
  });

  it('ignores a Clinic-edition LabOrderPlaced (no lab consumer yet) and refuses an incomplete Nurse one with a precise code relayed to the clinic', async () => {
    const { originEdition: _o, ...clinicEdition } = placed();
    void _o;
    expect((await send('LabOrderPlaced', clinicEdition, { eventId: 'e_c' })).body.status).toBe('IGNORED');
    expect(lab.callsTo('POST', '/orders')).toHaveLength(0);
    expect(await c.prisma.nurseLabRelay.count()).toBe(0);
    for (const [patch, code] of [
      [{ consentToken: '' }, 'CONSENT_REQUIRED'], [{ identifiersChecked: ['fullName'] }, 'TWO_IDENTIFIERS_REQUIRED'], [{ nurseCollection: undefined }, 'NURSE_COLLECTION_REQUIRED'],
      [{ items: [{ nameEn: 'No code' }] }, 'ITEM_CODE_REQUIRED'], [{ patient: undefined }, 'PATIENT_DEMOGRAPHICS_REQUIRED'],
    ] as const) {
      c.kiorly.labStatusPushes = [];
      const id = `ord_bad_${code}`;
      expect((await send('LabOrderPlaced', placed({ orderId: id, ...patch }))).body.status).toBe('APPLIED');
      await flush();
      expect(c.kiorly.labStatusPushes[0]).toMatchObject({ orderId: id, body: { status: 'REJECTED_BY_LAB', rejectionCode: code } });
      expect((await c.prisma.nurseLabRelay.findUniqueOrThrow({ where: { id } })).status).toBe('REFUSED');
    }
    expect(lab.callsTo('POST', '/orders')).toHaveLength(0);
  });

  it('a definitive lab refusal is relayed as REJECTED_BY_LAB and never retried; a transient lab failure answers 5xx so the clinic redelivers (same idempotency key)', async () => {
    lab.orderMode = 'reject';
    expect((await send('LabOrderPlaced', placed({ orderId: 'ord_rej' }))).body.status).toBe('APPLIED');
    await flush();
    expect(c.kiorly.labStatusPushes[0].body).toMatchObject({ status: 'REJECTED_BY_LAB', rejectionCode: 'TWO_IDENTIFIERS_REQUIRED' });
    lab.reset(); lab.orderMode = '5xx';
    const down = await send('LabOrderPlaced', placed({ orderId: 'ord_down' }), { eventId: 'ev_down' });
    expect(down.status).toBe(500);
    expect(await c.prisma.nurseLabRelay.count({ where: { id: 'ord_down' } })).toBe(0);
    lab.orderMode = undefined;
    expect((await send('LabOrderPlaced', placed({ orderId: 'ord_down' }), { eventId: 'ev_down' })).body.status).toBe('APPLIED'); // clinic redelivers the same event id
    const tries = lab.callsTo('POST', '/orders').filter((x) => x.body.sourceRef === 'ord_down');
    expect(tries).toHaveLength(2); // the 503 and the retry, both with the same Idempotency-Key
    expect(new Set(tries.map((t) => t.headers['idempotency-key']))).toEqual(new Set(['ord_down']));
    expect(lab.orders.size).toBe(1);
  });

  it('adds the Kiorex vault channel only for a linked patient who has not revoked LAB_RESULTS sharing; a revoked one is refused', async () => {
    await c.prisma.kiorlyPatientLink.create({ data: { sub: 'sub_amira', clinicId: 'cl_n1', kiorlyPatientId: 'pat_n1', evidence: 'PHONE' } });
    await send('LabOrderPlaced', placed({ orderId: 'ord_v1' }));
    expect(lab.callsTo('POST', '/orders')[0].body.consentChannels).toEqual(['KIORLY_NURSE_IMPORT', 'KIOREX_VAULT']);
    await c.prisma.recordShareConsent.create({ data: { sub: 'sub_amira', scope: 'LAB_RESULTS', granted: false } });
    await send('LabOrderPlaced', placed({ orderId: 'ord_v2' }));
    expect(lab.callsTo('POST', '/orders')).toHaveLength(1);
    expect((await c.prisma.nurseLabRelay.findUniqueOrThrow({ where: { id: 'ord_v2' } })).refusalCode).toBe('CONSENT_REVOKED');
  });

  it('LabOrderStatusChanged -> status + sanitized chain of custody (fetched from the lab through the nurse client) pushed to the clinic; RELEASED waits for the report link', async () => {
    await send('LabOrderPlaced', placed());
    await flush();
    c.kiorly.labStatusPushes = [];
    lab.custody = [{ label: 'NRS-0001-A', type: 'COLLECTED', occurredAt: NOW(), by: 'NURSE', temperatureC: 5 }, { label: 'NRS-0001-A', type: 'RECEIVED', occurredAt: NOW(), by: 'LAB' }];
    expect((await labEvent('LabOrderStatusChanged', { orderId: 'lbo_1', orderNumber: 'TL-1', source: 'KIORLY_CLINIC', originEdition: 'NURSE', sourceRef: 'ord_n1', previousStatus: 'AWAITING_COLLECTION', nextStatus: 'COLLECTED' })).body.status).toBe('APPLIED');
    await flush();
    const push = c.kiorly.labStatusPushes[0];
    expect(push.orderId).toBe('ord_n1');
    expect(push.body.status).toBe('COLLECTED');
    expect(push.body.custody).toEqual([
      expect.objectContaining({ label: 'NRS-0001-A', type: 'COLLECTED', by: 'NURSE', temperatureC: 5 }), expect.objectContaining({ label: 'NRS-0001-A', type: 'RECEIVED', by: 'LAB' }),
    ]);
    expect(lab.callsTo('GET', '/custody')[0].headers['x-kiorly-client-key']).toBe('kl_dev_nurse');
    expect(JSON.stringify(push.body)).not.toMatch(/fullName|Amira|phone/);
    // RELEASED status alone is not relayed (the report link arrives as LabResultReleased)
    c.kiorly.labStatusPushes = [];
    expect((await labEvent('LabOrderStatusChanged', { orderId: 'lbo_1', orderNumber: 'TL-1', source: 'KIORLY_CLINIC', originEdition: 'NURSE', sourceRef: 'ord_n1', previousStatus: 'VALIDATED', nextStatus: 'RELEASED' })).body.status).toBe('IGNORED');
    await flush();
    expect(c.kiorly.labStatusPushes).toHaveLength(0);
  });

  it('LabResultReleased -> the clinic gets the report id + secure link (never values); a linked patient also gets the vault entry; corrections re-push the new version', async () => {
    await c.prisma.kiorlyPatientLink.create({ data: { sub: 'sub_amira', clinicId: 'cl_n1', kiorlyPatientId: 'pat_n1', evidence: 'PHONE' } });
    await send('LabOrderPlaced', placed());
    await flush();
    c.kiorly.labStatusPushes = [];
    const rel = (v: number) => labEvent('LabResultReleased', { reportId: 'rep_n1', orderId: 'lbo_1', labId: 'lab_1', patientRef: 'pat_n1', reportVersion: v, signedAt: NOW(), secureLink: `https://lab.example.test/r/abc${v}`, channels: ['KIORLY_CLINIC', 'KIOREX_VAULT'] });
    expect((await rel(1)).body.status).toBe('APPLIED');
    await flush();
    expect(c.kiorly.labStatusPushes[0].body).toMatchObject({ status: 'RELEASED', reportId: 'rep_n1', reportVersion: 1, secureLink: 'https://lab.example.test/r/abc1' });
    expect(JSON.stringify(c.kiorly.labStatusPushes[0].body)).not.toMatch(/"values"|"results"/);
    expect((await c.prisma.nurseLabRelay.findUniqueOrThrow({ where: { id: 'ord_n1' } })).status).toBe('RESULT_RELEASED');
    expect(await c.prisma.sharedRecord.count({ where: { sub: 'sub_amira', kind: 'LAB_RESULT' } })).toBe(1);
    await rel(2); await flush();
    expect(c.kiorly.labStatusPushes.map((p) => p.body.reportVersion)).toEqual([1, 2]);
  });

  it('a clinic outage retries through the outbox with backoff; a permanent 404 from the clinic is dropped, not retried forever', async () => {
    await send('LabOrderPlaced', placed());
    c.kiorly.labStatusMode = '5xx';
    expect((await flush()).failed).toBe(1);
    expect(c.kiorly.labStatusPushes).toHaveLength(0);
    c.kiorly.labStatusMode = undefined;
    await c.prisma.outboxEvent.updateMany({ data: { nextAttemptAt: new Date() } });
    expect((await flush()).sent).toBe(1);
    expect(c.kiorly.labStatusPushes).toHaveLength(1);
    await send('LabOrderPlaced', placed({ orderId: 'ord_404' }));
    c.kiorly.labStatusMode = '404';
    expect((await flush()).sent).toBe(1);
  });

  it('webhook HMAC: an event signed with the wrong secret is rejected; a Kiorex booking status for an unknown order is still handled by the booking path', async () => {
    expect((await send('LabOrderPlaced', placed(), { badSig: true })).status).toBe(401);
    const e = lab.event('LabOrderStatusChanged', { orderId: 'unknown', sourceRef: 'kx_lb_unknown', nextStatus: 'COLLECTED' }, { aggregateId: 'unknown' });
    const r = await c.http().post(e.path).set(e.headers).send(e.body);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('UNKNOWN_BOOKING'); // unchanged Kiorex-booking behaviour: not a nurse hand-off, no booking either
  });

  it('ops can register the nurse-source lab client (webhook secret not needed) and the relay then uses that registration', async () => {
    const admin = await c.as('adm1', { roles: ['super_admin', 'ops_admin'] });
    const made = await c.http().post('/api/v1/admin/partners/lab_nurse').set(admin).send({ name: 'Lab (nurse source)', baseUrl: `http://127.0.0.1:${lab.port}`, clientKey: 'kl_dev_nurse', clientSecret: 'dev_nurse_secret_change_me' }).expect(201);
    expect(made.body).toMatchObject({ kind: 'lab_nurse', clientSecret: '********', apiPath: expect.stringContaining('/integration/v1') });
    await c.http().post('/api/v1/admin/partners/lab').set(admin).send({ name: 'x', baseUrl: 'http://127.0.0.1:1', clientKey: 'k', clientSecret: 's' }).expect(400); // a booking-source lab still needs its webhook secret
    expect((await c.get(PartnerRegistry).conn('LAB_NURSE')).clientKey).toBe('kl_dev_nurse');
    expect((await send('LabOrderPlaced', placed())).body.status).toBe('APPLIED');
  });

  it('pure mapping: toInbound carries only the strict inbound fields and refusal() names the first missing requirement', () => {
    const d = placed() as never;
    expect(NurseLabRelayService.refusal(d)).toBeNull();
    const body = NurseLabRelayService.toInbound(d, false);
    expect(Object.keys(body).sort()).toEqual(['consentChannels', 'identifiersChecked', 'nurseCollection', 'patient', 'priority', 'referringDoctor', 'sourceRef', 'testCodes']);
  });
});
