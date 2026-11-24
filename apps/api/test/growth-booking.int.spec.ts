import { validateAcquisitionBlock } from '@kiorex/contracts';
import { createCtx, futureSlot, seedProvider, TestCtx } from './harness';
import { signProviderLinkTouch, issueLinkToken, linkTokenKey, providerLinkTouchSecret, LinkRegistryService } from '../src/growth/growth-public';
import { seedTouch, DAY } from './growth-helpers';

const H = { marketplaceConsent: true, remindersConsent: true };
const CODE = '7K2M9X4Q';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GRW-P1-C: the attribution decision wired into hold -> confirm -> reschedule -> cancel, all entry points, signed block to the Clinic. */
describe('booking integration of attribution (GRW-P1-C)', () => {
  let c: TestCtx; let auth: { Authorization: string }; let pid: string;
  const slot = futureSlot();
  const ltFor = (org = 'tn_1', code = CODE, now = Date.now()) => signProviderLinkTouch(providerLinkTouchSecret()!, { orgRef: org, code, now });
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => {
    await c.reset(); c.flags.invalidate();
    c.kiorly.slots = [slot, futureSlot(49), futureSlot(50), futureSlot(51)];
    pid = await seedProvider(c, {});
    auth = await c.as('sub_amira');
    await c.http().put('/api/v1/me/profile').set(auth).send({ nameEn: 'Amira Samy', nationalId: '29004020101234' }).expect(200);
  });
  const hold = (extra: object = {}, headers: Record<string, string> = {}) => c.http().post('/api/v1/bookings').set(auth).set(headers).send({ providerId: pid, typeId: 'typ_1', ...slot, ...extra });
  const confirm = (id: string, headers: Record<string, string> = {}) => c.http().post(`/api/v1/bookings/${id}/confirm`).set(auth).set(headers).send(H);
  const sent = () => c.kiorly.callsTo('POST', '/bookings').filter((x) => x.path.endsWith('/bookings'))[0]?.body;
  const row = (id: string) => c.prisma.bookingIntent.findUniqueOrThrow({ where: { id } });

  it('a verified provider-link lt: decision persisted at hold, PROVIDER_LED, the signed acquisition block and the lt reach the Clinic, evidence is readable', async () => {
    const h = await hold({ lt: ltFor() }).expect(201);
    const decided = await row(h.body.id);
    expect(decided).toMatchObject({ acquisitionOrigin: 'PROVIDER_LED' });
    expect(decided.attributionDecisionId).toBeTruthy(); // persisted before any Clinic booking call
    expect(c.kiorly.callsTo('POST', '/bookings').filter((x) => x.path.endsWith('/bookings'))).toHaveLength(0);
    await confirm(h.body.id).expect(200);
    const body = sent();
    expect(body.acquisition).toMatchObject({ origin: 'PROVIDER_LED', reason: 'EXPLICIT_PROVIDER_CHANNEL', decisionId: decided.attributionDecisionId });
    expect(validateAcquisitionBlock(body.acquisition).valid).toBe(true);
    expect(body.lt).toBeTruthy();
    expect(body.attribution).toEqual({ source: 'kiorex' }); // the existing field is unchanged
    const ev = await c.prisma.growthAttributionDecision.findUniqueOrThrow({ where: { id: decided.attributionDecisionId! } });
    expect(body.acquisition.evidenceHash).toBe(ev.inputsHash);
    expect(await c.get(LinkRegistryService).orgOf(CODE)).toBe('tn_1'); // the code to organisation mapping was learned from the signed token
  });

  it('a Kiorex search booking with no evidence is UNATTRIBUTED and sends no lt; a marketplace touch makes it MARKETPLACE', async () => {
    const a = await hold().expect(201); await confirm(a.body.id).expect(200);
    expect(await row(a.body.id)).toMatchObject({ acquisitionOrigin: 'UNATTRIBUTED' });
    expect(sent().acquisition).toMatchObject({ origin: 'UNATTRIBUTED' }); expect(sent().lt).toBeUndefined();
    const V = 'kxv_bbbbbbbbbbbbbbbbbbbbbb';
    await seedTouch(c, { kind: 'ORGANIC_SEARCH', visitorKey: V, ageMs: DAY });
    c.kiorly.slots = [futureSlot(60)];
    const s2 = futureSlot(60);
    const b = await c.http().post('/api/v1/bookings').set(auth).set('X-KX-Visitor', V).send({ providerId: pid, typeId: 'typ_1', ...s2 }).expect(201);
    expect(await row(b.body.id)).toMatchObject({ acquisitionOrigin: 'MARKETPLACE' });
  });

  it('a prior provider touch on the visitor key (cookie form too) is PROVIDER_LED without any lt', async () => {
    const V = 'kxv_cccccccccccccccccccccc';
    await seedTouch(c, { kind: 'PROVIDER_QR', visitorKey: V, org: 'tn_1', linkCode: 'QR123456', ageMs: 2 * DAY });
    const h = await hold({}, { Cookie: `kxv=${V}` }).expect(201);
    expect(await row(h.body.id)).toMatchObject({ acquisitionOrigin: 'PROVIDER_LED' });
  });

  it('forged, tampered, expired, other-organisation and wrong-format lt are ignored (never an error) and never travel to the Clinic', async () => {
    const good = ltFor();
    const bads = [good.slice(0, -4) + 'AAAA', good.replace(/^[^.]+/, (p) => p.slice(0, -2) + 'xx'), ltFor('tn_1', CODE, Date.now() - 80 * 3600_000), ltFor('tn_OTHER'), 'not-a-token', issueLinkToken(Buffer.from('x'.repeat(32)), { orgRef: 'tn_1', linkCode: CODE })];
    for (const [i, lt] of bads.entries()) {
      c.kiorly.slots = [futureSlot(100 + i)]; const s = futureSlot(100 + i);
      const h = await c.http().post('/api/v1/bookings').set(auth).send({ providerId: pid, typeId: 'typ_1', ...s, lt }).expect(201);
      expect(await row(h.body.id)).toMatchObject({ acquisitionOrigin: 'UNATTRIBUTED' });
      await confirm(h.body.id).expect(200);
      expect(c.kiorly.callsTo('POST', '/bookings').filter((x) => x.path.endsWith('/bookings')).at(-1)!.body.lt).toBeUndefined();
    }
  });

  it('a token replayed for ANOTHER organisation\'s code mapping is a conflict: the code stays with its first organisation', async () => {
    await c.get(LinkRegistryService).learn(CODE, 'tn_FIRST');
    const h = await hold({ lt: ltFor('tn_1', CODE) }).expect(201);
    expect(await row(h.body.id)).toMatchObject({ acquisitionOrigin: 'UNATTRIBUTED' });
  });

  it('idempotent and immutable: confirm twice, retry after an uncertain call, reschedule and cancel keep ONE decision with the same id', async () => {
    const h = await hold({ lt: ltFor() }).expect(201);
    const id0 = (await row(h.body.id)).attributionDecisionId;
    await confirm(h.body.id).expect(200); await confirm(h.body.id).expect(200);
    await c.http().post(`/api/v1/bookings/${h.body.id}/reschedule`).set(auth).send(futureSlot(49)).expect(200);
    await c.http().post(`/api/v1/bookings/${h.body.id}/cancel`).set(auth).send({ reason: 'x' }).expect(200);
    expect((await row(h.body.id)).attributionDecisionId).toBe(id0);
    expect(await c.prisma.growthAttributionDecision.count({ where: { bookingId: h.body.id } })).toBe(1);
    expect(sent().acquisition.decisionId).toBe(id0);
  });

  it('flag growth.attribution OFF: no decision, no acquisition block, no lt on the Clinic call (identical to before the engine)', async () => {
    const admin = await c.as('adm1', { roles: ['super_admin', 'ops_admin'] });
    await c.http().put('/api/v1/admin/flags/growth.attribution/values').set(admin).send({ reason: 't', ticket: 'T-1', emergency: true, scope: 'GLOBAL', value: 'OFF' }).expect(200);
    const h = await hold({ lt: ltFor() }).expect(201); await confirm(h.body.id).expect(200);
    expect(await row(h.body.id)).toMatchObject({ acquisitionOrigin: null, attributionDecisionId: null });
    expect(sent().acquisition).toBeUndefined(); expect(sent().lt).toBeUndefined();
    expect(await c.prisma.growthAttributionDecision.count()).toBe(0);
  });

  it('CLINIC_LINK channel, WhatsApp channel and a family booking (dependant) are all decided; the dependant never enters the growth stream', async () => {
    const cl = await hold({ channel: 'CLINIC_LINK', bookingPageSlug: 'dr-x' }).expect(201);
    expect(await row(cl.body.id)).toMatchObject({ acquisitionOrigin: 'PROVIDER_LED' });
    const dep = await c.http().post('/api/v1/me/dependants').set(auth).send({ nameEn: 'Kid Samy', relation: 'CHILD', dateOfBirth: '2018-01-01', gender: 'MALE' });
    if (dep.status < 300) {
      c.kiorly.slots = [futureSlot(70)];
      const fam = await c.http().post('/api/v1/bookings').set(auth).send({ providerId: pid, typeId: 'typ_1', ...futureSlot(70), dependantId: dep.body.id }).expect(201);
      expect((await row(fam.body.id)).attributionDecisionId).toBeTruthy();
      expect(await c.prisma.growthEvent.count({ where: { bookingId: fam.body.id } })).toBe(0);
    }
    expect(await c.prisma.growthEvent.count({ where: { bookingId: cl.body.id, name: { in: ['SlotSelected', 'BookingInitiated'] } } })).toBe(2);
  });

  it('canonical facts: Initiated, Selected, Confirmed once each (duplicate webhooks suppressed), Cancelled on cancel with a closed reason', async () => {
    const h = await hold().expect(201); await confirm(h.body.id).expect(200);
    await sleep(50);
    const names = async () => (await c.prisma.growthEvent.findMany({ where: { bookingId: h.body.id }, orderBy: { name: 'asc' } })).map((e) => e.name);
    expect(await names()).toEqual(['BookingConfirmed', 'BookingInitiated', 'SlotSelected']);
    await c.http().post(`/api/v1/bookings/${h.body.id}/cancel`).set(auth).send({}).expect(200);
    expect(await names()).toEqual(['BookingCancelled', 'BookingConfirmed', 'BookingInitiated', 'SlotSelected']);
    const cancelled = await c.prisma.growthEvent.findFirstOrThrow({ where: { bookingId: h.body.id, name: 'BookingCancelled' } });
    expect(cancelled.props).toEqual({ reason: 'patient' });
    expect(JSON.stringify(await c.prisma.growthEvent.findMany({ where: { bookingId: h.body.id } }))).not.toMatch(/sub_amira|dermatology|lst_1|tn_1/);
  });

  it('the in-session kxl1 token format still decides PROVIDER_LED', async () => {
    const h = await hold({ lt: issueLinkToken(linkTokenKey()!, { orgRef: 'tn_1', linkCode: CODE }) }).expect(201);
    expect(await row(h.body.id)).toMatchObject({ acquisitionOrigin: 'PROVIDER_LED' });
  });
});
