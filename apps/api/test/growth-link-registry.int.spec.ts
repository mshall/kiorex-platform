import { validateEvent } from '@kiorex/contracts';
import { createCtx, futureSlot, seedProvider, TestCtx } from './harness';
import { LinkRegistryService, signProviderLinkTouch, providerLinkTouchSecret } from '../src/growth/growth-public';

const CODE = '7K2M9X4Q';
const H = { marketplaceConsent: true, remindersConsent: true };

/** Link registry (contracts 1.11.0): the Clinic emits ReferralLinkCreated / ReferralLinkRevoked, Kiorex consumes them, repairs through the signed lookup and the feed. */
describe('link registry (GRW-P1-C, contracts 1.11.0)', () => {
  let c: TestCtx; let auth: { Authorization: string }; let pid: string;
  const slot = futureSlot();
  const lt = (org = 'tn_1', code = CODE) => signProviderLinkTouch(providerLinkTouchSecret()!, { orgRef: org, code, now: Date.now() });
  const reg = () => c.get(LinkRegistryService);
  const created = (code = CODE, org = 'tn_1') => c.webhook('ReferralLinkCreated', { linkCode: code, ownerScope: 'CLINIC', channelKind: 'QR_POSTER', orgRef: org, clinicRef: 'cl_1', createdAt: new Date().toISOString() }, { eventId: `rlc_${code}_${org}_${Math.random()}` });
  const revoked = (code = CODE, org = 'tn_1') => c.webhook('ReferralLinkRevoked', { linkCode: code, orgRef: org, clinicRef: 'cl_1', revokedAt: new Date().toISOString(), reason: 'PROVIDER_REQUEST' }, { eventId: `rlr_${code}_${org}_${Math.random()}` });
  const hold = (extra: object = {}) => c.http().post('/api/v1/bookings').set(auth).send({ providerId: pid, typeId: 'typ_1', ...slot, ...extra });
  const originOf = async (id: string) => (await c.prisma.bookingIntent.findUniqueOrThrow({ where: { id } })).acquisitionOrigin;

  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => {
    await c.reset(); c.flags.invalidate();
    c.kiorly.slots = [slot, futureSlot(49), futureSlot(50), futureSlot(51)];
    pid = await seedProvider(c, {});
    auth = await c.as('sub_amira');
    await c.http().put('/api/v1/me/profile').set(auth).send({ nameEn: 'Amira Samy', nationalId: '29004020101234' }).expect(200);
  });

  it('ReferralLinkCreated registers the code BEFORE any token is seen; the example validates against the contract', async () => {
    expect(await reg().orgOf(CODE)).toBeNull();
    const r = await created();
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('APPLIED');
    expect(await reg().orgOf(CODE)).toBe('tn_1');
    expect(await reg().statusOf(CODE)).toBe('ACTIVE');
    const ev = { eventId: 'x', type: 'ReferralLinkCreated', aggregateType: 'ProviderReferralLink', aggregateId: 'prl_1', occurredAt: new Date().toISOString(), data: { linkCode: CODE, ownerScope: 'CLINIC', channelKind: 'QR_POSTER', orgRef: 'tn_1', clinicRef: 'cl_1' } };
    expect(validateEvent('ReferralLinkCreated', ev).valid).toBe(true);
  });

  it('a second organisation claiming the same code is a conflict and never overwrites', async () => {
    await created(CODE, 'tn_1');
    await created(CODE, 'tn_2');
    expect(await reg().orgOf(CODE)).toBe('tn_1');
    await revoked(CODE, 'tn_2'); // a revocation from the wrong organisation does nothing
    expect(await reg().statusOf(CODE)).toBe('ACTIVE');
  });

  it('ReferralLinkRevoked stops provider-led decisions for NEW bookings even though the 72 h token is still valid; it is idempotent and never reopens', async () => {
    await created();
    const token = lt();
    const before = await hold({ lt: token }).expect(201);
    expect(await originOf(before.body.id)).toBe('PROVIDER_LED');
    const r = await revoked();
    expect(r.body.status).toBe('APPLIED');
    expect(await reg().statusOf(CODE)).toBe('REVOKED');
    await revoked(); // duplicate delivery
    await created(); // a late or replayed ReferralLinkCreated must not reopen a revoked code
    expect(await reg().statusOf(CODE)).toBe('REVOKED');
    // the decision written before the revocation is append-only and unchanged
    expect(await originOf(before.body.id)).toBe('PROVIDER_LED');
    c.kiorly.slots = [futureSlot(60)];
    const s2 = futureSlot(60);
    const after = await c.http().post('/api/v1/bookings').set(auth).send({ providerId: pid, typeId: 'typ_1', ...s2, lt: token }).expect(201);
    expect(await originOf(after.body.id)).not.toBe('PROVIDER_LED');
    await c.http().post(`/api/v1/bookings/${after.body.id}/confirm`).set(auth).send(H).expect(200);
    const sent = c.kiorly.callsTo('POST', '/bookings').filter((x) => x.path.endsWith('/bookings')).pop()!.body;
    expect(sent.lt).toBeUndefined(); // a revoked link is never forwarded to the Clinic
    expect(sent.acquisition.origin).not.toBe('PROVIDER_LED');
  });

  it('a revocation that arrives before the code was ever seen is remembered, so a late token cannot register it', async () => {
    await revoked('ABCD2345', 'tn_1');
    expect(await reg().statusOf('ABCD2345')).toBe('REVOKED');
    expect(await reg().learn('ABCD2345', 'tn_1')).toBe('REVOKED');
    expect(await reg().orgOf('ABCD2345')).toBe('tn_1');
  });

  it('touches of a revoked link recorded earlier no longer decide a new booking', async () => {
    await created(CODE);
    const { seedTouch, DAY } = await import('./growth-helpers');
    const V = 'kxv_dddddddddddddddddddddd';
    await seedTouch(c, { kind: 'PROVIDER_QR', visitorKey: V, org: 'tn_1', linkCode: CODE, ageMs: DAY });
    await revoked(CODE);
    const h = await c.http().post('/api/v1/bookings').set(auth).set('X-KX-Visitor', V).send({ providerId: pid, typeId: 'typ_1', ...slot }).expect(201);
    expect(await originOf(h.body.id)).not.toBe('PROVIDER_LED');
  });

  it('an unknown code with a valid token asks the Clinic (signed lookup): a PAUSED or REVOKED answer stops the decision, 404 falls back to the token proof', async () => {
    c.kiorly.referralLinks.set('PA5SED22', { code: 'PA5SED22', orgRef: 'tn_1', clinicRef: 'cl_1', ownerScope: 'CLINIC', channelKind: 'WEB_LINK', status: 'PAUSED', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), revokedAt: null });
    const a = await hold({ lt: lt('tn_1', 'PA5SED22') }).expect(201);
    expect(await originOf(a.body.id)).not.toBe('PROVIDER_LED');
    expect(c.kiorly.callsTo('GET', '/referral-links/PA5SED22').length).toBe(1);
    expect(await reg().statusOf('PA5SED22')).toBe('PAUSED');
    // not in the Clinic registry at all (404): the verified token alone proves the pair, exactly as before 1.11.0
    c.kiorly.slots = [futureSlot(60)];
    const s2 = futureSlot(60);
    const b = await c.http().post('/api/v1/bookings').set(auth).send({ providerId: pid, typeId: 'typ_1', ...s2, lt: lt('tn_1', 'NEW7CDE7') }).expect(201);
    expect(await originOf(b.body.id)).toBe('PROVIDER_LED');
    expect(await reg().orgOf('NEW7CDE7')).toBe('tn_1');
  });

  it('the lookup says the code belongs to another organisation: the token is not honoured (conflict)', async () => {
    c.kiorly.referralLinks.set('ETHER888', { code: 'ETHER888', orgRef: 'tn_9', clinicRef: null, ownerScope: 'ORG', channelKind: 'WEB_LINK', status: 'ACTIVE', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), revokedAt: null });
    const h = await hold({ lt: lt('tn_1', 'ETHER888') }).expect(201);
    expect(await originOf(h.body.id)).not.toBe('PROVIDER_LED');
  });

  it('reconcile repairs a missed event from the Clinic feed (counters only), revocations included, and is idempotent', async () => {
    const now = new Date().toISOString();
    c.kiorly.referralLinks.set('FEED1111', { code: 'FEED1111', orgRef: 'tn_1', clinicRef: 'cl_1', ownerScope: 'DOCTOR', channelKind: 'SMS', status: 'ACTIVE', createdAt: now, updatedAt: now, revokedAt: null });
    c.kiorly.referralLinks.set('FEED2222', { code: 'FEED2222', orgRef: 'tn_1', clinicRef: 'cl_1', ownerScope: 'DESK', channelKind: 'QR_DESK', status: 'REVOKED', createdAt: now, updatedAt: now, revokedAt: now });
    const r = await reg().reconcile(new Date(Date.now() - 3600_000));
    expect(r).toEqual({ scanned: 2, applied: 2, conflicts: 0 });
    expect(await reg().statusOf('FEED1111')).toBe('ACTIVE');
    expect(await reg().statusOf('FEED2222')).toBe('REVOKED');
    expect(await reg().reconcile(new Date(Date.now() - 3600_000))).toEqual({ scanned: 2, applied: 2, conflicts: 0 });
    expect(await reg().orgOf('FEED1111')).toBe('tn_1');
  });
});
