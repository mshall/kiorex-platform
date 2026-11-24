import { createCtx, TestCtx } from './harness';
import { OutboxService } from '../src/outbox/outbox-public';
import { AttributionService, GrowthEventsService, issueLinkToken, linkTokenKey, RetentionJobProbe } from './growth-probe';
import { DAY, registerLink, seedBooking, seedTouch, unlockFlag } from './growth-helpers';

const TOUCH = '/api/v1/growth/v1/touch';
const EVENTS = '/api/v1/growth/v1/events';
const CONSENT = '/api/v1/growth/v1/consent';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';

/** GRW-P1-B/I: the public ingestion surface: consent gate, sanitising, idempotency, rate limits, no PHI. Real Postgres through the real HTTP stack. */
describe('growth touch, events and visitor consent', () => {
  let c: TestCtx;
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => { await c.reset(); c.flags.invalidate(); delete process.env.GROWTH_RATE_TOUCH_PER_MIN; delete process.env.GROWTH_RATE_EVENTS_PER_MIN; delete process.env.GROWTH_RATE_CONSENT_PER_MIN; });
  const cookieOf = (r: { headers: Record<string, any> }) => ([] as string[]).concat(r.headers['set-cookie'] ?? []).find((x) => x.startsWith('kxv='));
  const touch = (body: object, h: Record<string, string> = {}) => c.http().post(TOUCH).set({ 'user-agent': UA, ...h }).send(body);

  describe('POST /growth/v1/touch: consent gate', () => {
    it('without X-KX-Consent: 202, no cookie, no visitor key, no touchpoint (even with a provider ref)', async () => {
      await registerLink(c, '7K2M9X4Q', 'org_A');
      const r = await touch({ landingKind: 'PROVIDER_LINK', ref: '7K2M9X4Q', dwellMs: 2000 }).expect(202);
      expect(r.body).toEqual({ accepted: true, visitorKeySet: false });
      expect(cookieOf(r)).toBeUndefined();
      expect(await c.prisma.growthTouchpoint.count()).toBe(0);
      expect(await c.prisma.growthEvent.count()).toBe(0);
    });
    it('a verified lt token is honoured without consent but stores nothing; a forged or expired token is a 400', async () => {
      const ok = issueLinkToken(linkTokenKey()!, { orgRef: 'org_A', linkCode: '7K2M9X4Q' });
      expect((await touch({ landingKind: 'PROVIDER_LINK', lt: ok }).expect(202)).body.visitorKeySet).toBe(false);
      expect(await c.prisma.growthTouchpoint.count()).toBe(0);
      expect((await touch({ landingKind: 'PROVIDER_LINK', lt: ok.slice(0, -2) + 'xx' }).expect(400)).body.code).toBe('GROWTH_LINK_TOKEN_INVALID');
      const old = issueLinkToken(linkTokenKey()!, { orgRef: 'org_A', linkCode: 'x', now: Date.now() - 2 * 3600_000 });
      expect((await touch({ landingKind: 'PROVIDER_LINK', lt: old }).expect(400)).body.code).toBe('GROWTH_LINK_TOKEN_EXPIRED');
    });
    it('consent header but the launch-locked flag growth.analytics_visitor not unlocked (counsel gate): still nothing is stored', async () => {
      const r = await touch({ landingKind: 'HOME' }, { 'X-KX-Consent': 'analytics' }).expect(202);
      expect(r.body.visitorKeySet).toBe(false); expect(cookieOf(r)).toBeUndefined();
      expect(await c.prisma.growthTouchpoint.count()).toBe(0);
    });
    it('only the exact value "analytics" counts as consent', async () => {
      await unlockFlag(c, 'growth.analytics_visitor');
      for (const v of ['true', '1', 'marketing', 'analytics,marketing', '']) expect((await touch({ landingKind: 'HOME' }, { 'X-KX-Consent': v }).expect(202)).body.visitorKeySet).toBe(false);
      expect(await c.prisma.growthTouchpoint.count()).toBe(0);
    });
    it('with consent and the gate evidence: cookie kxv (HttpOnly, SameSite=Lax, host-only, <= 180 days) and ONE touchpoint with no IP, class-only UA, host-only referrer, no unknown field', async () => {
      await unlockFlag(c, 'growth.analytics_visitor');
      const r = await touch({ landingKind: 'SPECIALTY_CITY', utm: { source: 'google', medium: 'organic', bogus: 'x' }, specialty: 'cardiology', userId: 'u1' }, { 'X-KX-Consent': 'analytics', Referer: 'https://www.google.com/search?q=heart+doctor+cairo' }).expect(202);
      expect(r.body).toEqual({ accepted: true, visitorKeySet: true });
      const ck = cookieOf(r)!;
      expect(ck).toMatch(/^kxv=kxv_[A-Za-z0-9_-]{22,}; Path=\/; Max-Age=15552000; HttpOnly; SameSite=Lax/);
      expect(ck).not.toMatch(/Domain=/);
      const t = await c.prisma.growthTouchpoint.findFirstOrThrow();
      expect(t).toMatchObject({ kind: 'ORGANIC_SEARCH', landingKind: 'SPECIALTY_CITY', utmSource: 'google', utmMedium: 'organic', uaClass: 'ios-safari', referrerHost: 'www.google.com', providerOrgRef: null });
      expect(t.visitorKey).toBe(/^kxv=([^;]+)/.exec(ck)![1]);
      expect(JSON.stringify(t)).not.toMatch(/127\.0\.0\.1|::1|Mozilla|heart|cardiology|search\?q/); // no ip, no full UA, no query string, no specialty
      expect(t.ipHash).toMatch(/^[A-Za-z0-9_-]{32}$/);
    });
    it('a returning visitor keeps the SAME key (cookie read), a malformed cookie is replaced, and dropping consent clears the cookie', async () => {
      await unlockFlag(c, 'growth.analytics_visitor');
      const first = await touch({ landingKind: 'HOME' }, { 'X-KX-Consent': 'analytics' });
      const key = /^kxv=([^;]+)/.exec(cookieOf(first)!)![1]!;
      await touch({ landingKind: 'HOME' }, { 'X-KX-Consent': 'analytics', Cookie: `kxv=${key}` }).expect(202);
      expect((await c.prisma.growthTouchpoint.findMany()).map((t) => t.visitorKey)).toEqual([key, key]);
      const bad = await touch({ landingKind: 'HOME' }, { 'X-KX-Consent': 'analytics', Cookie: 'kxv=evil' });
      expect(/^kxv=([^;]+)/.exec(cookieOf(bad)!)![1]).not.toBe('evil');
      const gone = await touch({ landingKind: 'HOME' }, { Cookie: `kxv=${key}` }).expect(202); // consent withdrawn: header absent
      expect(cookieOf(gone)).toMatch(/^kxv=; Path=\/; Max-Age=0/);
      expect(await c.prisma.growthTouchpoint.count()).toBe(2 + 1 - 0); // the withdrawal request stored nothing new
    });
  });

  describe('POST /growth/v1/touch: sources and sanitising', () => {
    beforeEach(async () => { await unlockFlag(c, 'growth.analytics_visitor'); });
    const consented = { 'X-KX-Consent': 'analytics' };
    it('a registered provider link stores a provider-owned touch with its organisation and dwell; unknown codes are ignored (nothing stored)', async () => {
      await registerLink(c, '7K2M9X4Q', 'org_A');
      await touch({ landingKind: 'PROVIDER_LINK', ref: '7K2M9X4Q', dwellMs: 1800 }, consented).expect(202);
      expect(await c.prisma.growthTouchpoint.findFirstOrThrow()).toMatchObject({ kind: 'PROVIDER_LINK', providerOrgRef: 'org_A', linkCode: '7K2M9X4Q', dwellMs: 1800 });
      const unknown = await touch({ landingKind: 'PROVIDER_LINK', ref: 'NOPE0000' }, consented).expect(202);
      expect(unknown.body.visitorKeySet).toBe(false);
      expect(await c.prisma.growthTouchpoint.count()).toBe(1);
    });
    it('a verified lt token proves the organisation before the link projection exists; a token that contradicts the registered code is ignored', async () => {
      const lt = issueLinkToken(linkTokenKey()!, { orgRef: 'org_B', linkCode: 'ZZZZ1111' });
      await touch({ landingKind: 'PROVIDER_LINK', lt, dwellMs: 1500 }, consented).expect(202);
      expect(await c.prisma.growthTouchpoint.findFirstOrThrow()).toMatchObject({ providerOrgRef: 'org_B', linkCode: 'ZZZZ1111', ltTokenId: expect.any(String) });
      await registerLink(c, 'ZZZZ2222', 'org_A');
      const mismatch = issueLinkToken(linkTokenKey()!, { orgRef: 'org_B', linkCode: 'ZZZZ2222' });
      expect((await touch({ landingKind: 'PROVIDER_LINK', ref: 'ZZZZ2222', lt: mismatch }, consented).expect(202)).body.visitorKeySet).toBe(false);
      expect(await c.prisma.growthTouchpoint.count()).toBe(1);
    });
    it('click id is hashed (the raw value is nowhere), campaign touches keep UTM only', async () => {
      await touch({ landingKind: 'HOME', utm: { source: 'meta', medium: 'cpc', campaign: 'launch_eg' }, clickId: { kind: 'FBCLID', value: 'IwAR-secret-click-value' } }, consented).expect(202);
      const t = await c.prisma.growthTouchpoint.findFirstOrThrow();
      expect(t).toMatchObject({ kind: 'CAMPAIGN', clickIdKind: 'FBCLID', utmCampaign: 'launch_eg' });
      expect(t.clickIdHash).toBeTruthy(); expect(JSON.stringify(t)).not.toContain('IwAR-secret');
    });
    it('an e-mail-like or phone-like UTM value rejects the WHOLE call (422) and stores nothing; pattern violations are 400; unknown params are dropped', async () => {
      expect((await touch({ landingKind: 'HOME', utm: { campaign: 'jane@example.com' } }, consented).expect(422)).body.code).toBe('GROWTH_PHI_REJECTED');
      expect((await touch({ landingKind: 'HOME', utm: { term: '01012345678' } }, consented).expect(422)).body.code).toBe('GROWTH_PHI_REJECTED');
      expect((await touch({ landingKind: 'HOME', utm: { source: 'two words' } }, consented).expect(400)).body.code).toBe('GROWTH_INVALID_REQUEST');
      expect((await touch({ landingKind: 'NOPE' }, consented).expect(400)).body.code).toBe('GROWTH_INVALID_REQUEST');
      expect(await c.prisma.growthTouchpoint.count()).toBe(0);
      await touch({ landingKind: 'HOME', utm: { source: 'x', whatever: 'y' }, q: 'chest pain', gclid: 'abc' }, consented).expect(202);
      expect(await c.prisma.growthTouchpoint.count()).toBe(1);
    });
    it('size cap: a body over 4 KiB is 413', async () => {
      const r = await touch({ landingKind: 'HOME', junk: 'x'.repeat(5000) }, consented).expect(413);
      expect(r.body.code).toBe('PAYLOAD_TOO_LARGE');
    });
    it('rate limit per rotating ip hash through the shared Postgres limiter: 429 GROWTH_RATE_LIMITED with Retry-After; refused hits are not stored', async () => {
      process.env.GROWTH_RATE_TOUCH_PER_MIN = '3';
      for (let i = 0; i < 3; i++) await touch({ landingKind: 'HOME' }, consented).expect(202);
      const r = await touch({ landingKind: 'HOME' }, consented).expect(429);
      expect(r.body.code).toBe('GROWTH_RATE_LIMITED'); expect(Number(r.headers['retry-after'])).toBeGreaterThanOrEqual(1);
      expect(await c.prisma.growthTouchpoint.count()).toBe(3);
      expect(await c.prisma.rateLimitBucket.count({ where: { key: { startsWith: 'growth:touch:' } } })).toBe(1);
      expect(JSON.stringify(await c.prisma.rateLimitBucket.findMany())).not.toMatch(/127\.0\.0\.1|::1/); // the key holds the rotating hash, never the ip
    });
    it('flag growth.attribution OFF: 403 FEATURE_DISABLED {key, scope} on touch and events; the consent endpoint still works', async () => {
      const admin = await c.as('adm1', { roles: ['super_admin', 'ops_admin'] });
      await c.http().put('/api/v1/admin/flags/growth.attribution/values').set(admin).send({ reason: 't', ticket: 'T-1', emergency: true, scope: 'GLOBAL', value: 'OFF' }).expect(200);
      c.flags.invalidate();
      for (const [p, body] of [[TOUCH, { landingKind: 'HOME' }], [EVENTS, { events: [{ name: 'PageViewed' }] }]] as const) {
        const r = await c.http().post(p).send(body).expect(403);
        expect(r.body).toMatchObject({ code: 'FEATURE_DISABLED', key: 'growth.attribution' });
      }
      await c.http().post(CONSENT).send({ analytics: false }).expect(201);
    });
    it('fraud hooks: a provider landing that never rendered writes a signal (keyed hash only); a burst from one ip hash writes ONE signal', async () => {
      await registerLink(c, '7K2M9X4Q', 'org_A');
      await touch({ landingKind: 'PROVIDER_LINK', ref: '7K2M9X4Q', dwellMs: 5 }, consented).expect(202);
      await touch({ landingKind: 'PROVIDER_LINK', ref: '7K2M9X4Q' }).expect(202); // even without consent the rule runs on the ip hash only
      const cwr = await c.prisma.growthFraudSignal.findMany({ where: { ruleId: 'CLICK_WITHOUT_RENDER' } });
      expect(cwr).toHaveLength(2); expect(cwr[0]!.subjectHash).toMatch(/^[0-9a-f]{32}$/);
      process.env.GROWTH_FRAUD_BURST_PER_MIN = '4';
      for (let i = 0; i < 9; i++) await touch({ landingKind: 'HOME' }).expect(202);
      delete process.env.GROWTH_FRAUD_BURST_PER_MIN;
      expect(await c.prisma.growthFraudSignal.count({ where: { ruleId: 'BURST_PER_IP_HASH' } })).toBe(1);
    });
    it('end to end: touch over HTTP, then the booking decision uses it (provider-led); another visitor key does not', async () => {
      await registerLink(c, '7K2M9X4Q', 'org_A');
      const r = await touch({ landingKind: 'PROVIDER_LINK', ref: '7K2M9X4Q', dwellMs: 2500 }, consented);
      const key = /^kxv=([^;]+)/.exec(cookieOf(r)!)![1]!;
      const svc = c.get(AttributionService);
      // the touch is stamped "now", the booking must be after it
      await new Promise((res) => setTimeout(res, 15));
      expect(await svc.decideForBooking({ bookingId: (await seedBooking(c)).id, visitorKey: key })).toMatchObject({ origin: 'PROVIDER_LED', reasonCode: 'PRIOR_PROVIDER_TOUCH' });
      expect(await svc.decideForBooking({ bookingId: (await seedBooking(c)).id, visitorKey: 'kxv_someoneelsesomeoneelse' })).toMatchObject({ origin: 'UNATTRIBUTED' });
    });
  });

  describe('POST /growth/v1/events', () => {
    const ev = (events: object[], h: Record<string, string> = {}) => c.http().post(EVENTS).set(h).send({ events });
    it('accepts canonical client events; careType is allowed; stored anonymously (no visitor key) without consent', async () => {
      const r = await ev([{ name: 'PageViewed', careType: 'DOCTORS', landingKind: 'HOME', props: { surface: 'home' } }, { name: 'SearchStarted', careType: 'PHYSIOTHERAPY' }]).expect(202);
      expect(r.body).toEqual({ accepted: 2, duplicates: 0 });
      const rows = await c.prisma.growthEvent.findMany({ orderBy: { name: 'asc' } });
      expect(rows.map((x) => [x.name, x.careType, x.visitorKey])).toEqual([['PageViewed', 'DOCTORS', null], ['SearchStarted', 'PHYSIOTHERAPY', null]]);
    });
    it('server-side names, unknown names, specialty, provider ids and PHI-like props are rejected 422 and NOTHING of the batch is stored', async () => {
      for (const [bad, code] of [[{ name: 'BookingConfirmed' }, 'GROWTH_EVENT_NOT_ALLOWED'], [{ name: 'SlotSelected' }, 'GROWTH_EVENT_NOT_ALLOWED'], [{ name: 'Nope' }, 'GROWTH_EVENT_NOT_ALLOWED'], [{ name: 'PageViewed', props: { specialty: 'cardiology' } }, 'GROWTH_PHI_REJECTED'], [{ name: 'ProviderViewed', props: { providerId: 'lst_1' } }, 'GROWTH_PHI_REJECTED'], [{ name: 'PageViewed', props: { surface: '01012345678' } }, 'GROWTH_PHI_REJECTED']] as const) {
        const r = await ev([{ name: 'PageViewed' }, bad]).expect(422);
        expect(r.body.code).toBe(code);
      }
      expect(await c.prisma.growthEvent.count()).toBe(0);
    });
    it('idempotent: the same event twice (retry or double submit) is one row; 15 concurrent identical batches are one row', async () => {
      const e = { name: 'ResultsViewed', careType: 'DOCTORS', props: { count: 5 }, occurredAt: new Date().toISOString() };
      expect((await ev([e]).expect(202)).body).toEqual({ accepted: 1, duplicates: 0 });
      expect((await ev([e]).expect(202)).body).toEqual({ accepted: 1, duplicates: 1 });
      await Promise.all(Array.from({ length: 15 }, () => ev([e]).expect(202)));
      expect(await c.prisma.growthEvent.count()).toBe(1);
      await ev([{ ...e, props: { count: 6 } }]).expect(202); // a different fact is a different row
      expect(await c.prisma.growthEvent.count()).toBe(2);
    });
    it('with consent, the unlocked flag and the cookie the event is keyed to the visitor; without the flag it stays anonymous', async () => {
      const cookie = { Cookie: 'kxv=kxv_aaaaaaaaaaaaaaaaaaaaaa', 'X-KX-Consent': 'analytics' };
      await ev([{ name: 'PageViewed' }], cookie).expect(202);
      expect((await c.prisma.growthEvent.findFirstOrThrow()).visitorKey).toBeNull(); // launch-locked
      await unlockFlag(c, 'growth.analytics_visitor');
      await ev([{ name: 'AppInstalled' }], cookie).expect(202);
      expect((await c.prisma.growthEvent.findFirstOrThrow({ where: { name: 'AppInstalled' } })).visitorKey).toBe('kxv_aaaaaaaaaaaaaaaaaaaaaa');
    });
    it('batch size 1..20, body cap and rate limit', async () => {
      await ev([]).expect(400);
      await ev(Array.from({ length: 21 }, () => ({ name: 'PageViewed' }))).expect(400);
      process.env.GROWTH_RATE_EVENTS_PER_MIN = '2';
      await ev([{ name: 'PageViewed' }]).expect(202); await ev([{ name: 'SearchStarted' }]).expect(202);
      const r = await ev([{ name: 'ResultsViewed' }]).expect(429);
      expect(r.body.code).toBe('GROWTH_RATE_LIMITED');
    });
    it('server facts are written once whichever channel reports them (web, mobile, messaging, backend): same natural key, one row; PHI guard applies to backend writers too', async () => {
      const g = c.get(GrowthEventsService);
      const fact = { name: 'BookingConfirmed', naturalKey: 'kx_bk_1', bookingId: 'kx_bk_1', careType: 'DOCTORS' };
      const results = await Promise.all(['web', 'mobile', 'messaging', 'backend', 'backend', 'web'].map((s) => g.recordFact({ ...fact, props: { surface: s } })));
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await c.prisma.growthEvent.count({ where: { name: 'BookingConfirmed' } })).toBe(1);
      expect(await g.recordFact({ name: 'BookingConfirmed', naturalKey: 'kx_bk_2', bookingId: 'kx_bk_2' })).toBe(true);
      await expect(g.recordFact({ name: 'BookingConfirmed', naturalKey: 'x', props: { specialty: 'cardiology' } })).rejects.toThrow();
      await expect(g.recordFact({ name: 'Nope', naturalKey: 'x' })).rejects.toThrow();
    });
  });

  describe('POST /growth/v1/consent (anonymous banner decision)', () => {
    it('records an append-only audit row keyed by a random consent id: no sub, no cookie value, no ip; version placeholder until counsel approves', async () => {
      const r = await c.http().post(CONSENT).send({ analytics: true, marketing: false, source: 'web', evidence: 'accept_all' }).expect(201);
      expect(r.body).toMatchObject({ consentId: expect.stringMatching(/^kxc_/), analytics: true, marketing: false, textVersion: 'TODO_NEEDS_HUMAN_v0' });
      const row = await c.prisma.growthVisitorConsent.findFirstOrThrow();
      expect(row).toMatchObject({ id: r.body.consentId, analytics: true, marketing: false, source: 'web', evidence: 'accept_all' });
      expect(row.ipHash).toMatch(/^[A-Za-z0-9_-]{32}$/); expect(JSON.stringify(row)).not.toMatch(/127\.0\.0\.1|::1/);
      await expect(c.prisma.growthVisitorConsent.update({ where: { id: row.id }, data: { analytics: false } })).rejects.toThrow(/append-only/);
      await expect(c.prisma.growthVisitorConsent.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
      expect(await c.prisma.growthEvent.count({ where: { name: 'ConsentGranted' } })).toBe(1);
    });
    it('a reject is recorded the same way and clears an existing kxv cookie at once (equal weight, immediate withdrawal)', async () => {
      const r = await c.http().post(CONSENT).set({ Cookie: 'kxv=kxv_aaaaaaaaaaaaaaaaaaaaaa' }).send({ analytics: false, marketing: false }).expect(201);
      expect(cookieOf(r)).toMatch(/^kxv=; Path=\/; Max-Age=0/);
      expect(await c.prisma.growthVisitorConsent.count({ where: { analytics: false } })).toBe(1);
      expect(await c.prisma.growthEvent.count({ where: { name: 'ConsentGranted' } })).toBe(0);
    });
    it('cookie contract end to end: none before accept, none after reject, present after accept', async () => {
      await unlockFlag(c, 'growth.analytics_visitor');
      expect(cookieOf(await touch({ landingKind: 'HOME' }).expect(202))).toBeUndefined(); // before any decision
      await c.http().post(CONSENT).send({ analytics: false }).expect(201);
      expect(cookieOf(await touch({ landingKind: 'HOME' }).expect(202))).toBeUndefined(); // after reject the client sends no header
      await c.http().post(CONSENT).send({ analytics: true }).expect(201);
      expect(cookieOf(await touch({ landingKind: 'HOME' }, { 'X-KX-Consent': 'analytics' }).expect(202))).toBeDefined(); // after accept
    });
    it('validation: analytics is required, source is limited, rate limited; GET versions shows the text version the banner must store', async () => {
      await c.http().post(CONSENT).send({}).expect(400);
      await c.http().post(CONSENT).send({ analytics: 'yes' }).expect(400);
      await c.http().post(CONSENT).send({ analytics: true, source: 'carrier-pigeon' }).expect(400);
      expect((await c.http().get(`${CONSENT}/versions`).expect(200)).body).toMatchObject({ analytics: 'TODO_NEEDS_HUMAN_v0', marketing: 'TODO_NEEDS_HUMAN_v0' });
      await c.prisma.rateLimitBucket.deleteMany();
      process.env.GROWTH_RATE_CONSENT_PER_MIN = '2';
      await c.http().post(CONSENT).send({ analytics: true }).expect(201); await c.http().post(CONSENT).send({ analytics: true }).expect(201);
      await c.http().post(CONSENT).send({ analytics: true }).expect(429);
    });
  });

  describe('retention and erasure', () => {
    it('the retention job blanks ip hashes after 24 h, deletes unlinked touches after 13 months and evidence touches after 25, and writes an AuditLog row', async () => {
      const fresh = await seedTouch(c, { kind: 'ORGANIC_SEARCH', visitorKey: 'kxv_fresh', ageMs: 3600_000 });
      const day2 = await seedTouch(c, { kind: 'ORGANIC_SEARCH', visitorKey: 'kxv_day2', ageMs: 2 * DAY });
      const old14 = await seedTouch(c, { kind: 'ORGANIC_SEARCH', visitorKey: 'kxv_old14', ageMs: 14 * 30 * DAY });
      const cited = await seedTouch(c, { kind: 'PROVIDER_LINK', visitorKey: 'kxv_cited', org: 'org_A', ageMs: 14 * 30 * DAY, linkCode: 'CITED001' });
      await c.prisma.growthAttributionDecision.create({ data: { bookingId: 'kx_bk_cited', origin: 'PROVIDER_LED', reasonCode: 'PRIOR_PROVIDER_TOUCH', inputsHash: 'a'.repeat(64), evidenceTouchIds: [cited.id], policyVersionId: (await c.prisma.growthConfigVersion.create({ data: { kind: 'ATTRIBUTION_POLICY', version: 1, payload: {}, createdBy: 'x', checksum: 'c' } })).id } });
      const r = await c.get(RetentionJobProbe).runOnce();
      expect(r.touchpointsDeletedUnlinked).toBe(1);
      expect((await c.prisma.growthTouchpoint.findUnique({ where: { id: fresh.id } }))!.ipHash).toBe('h');
      expect((await c.prisma.growthTouchpoint.findUnique({ where: { id: day2.id } }))!.ipHash).toBe('');
      expect(await c.prisma.growthTouchpoint.findUnique({ where: { id: old14.id } })).toBeNull();
      expect(await c.prisma.growthTouchpoint.findUnique({ where: { id: cited.id } })).not.toBeNull(); // cited by a decision: kept 25 months
      expect(await c.prisma.auditLog.count({ where: { action: 'growth.purge_expired' } })).toBe(1);
      const again = await c.get(RetentionJobProbe).runOnce(); // idempotent
      expect(again.touchpointsDeletedUnlinked).toBe(0);
    });
    it('subject.deleted (Passport back-channel) erases the subject\'s touches and linked funnel events; a touch cited by a decision is anonymised, the decision stays; the audit holds a hash, never the sub', async () => {
      await c.http().put('/api/v1/me/profile').set(await c.as('sub_gone')).send({ nameEn: 'Gone Soon' }).expect(200);
      const mine = await seedTouch(c, { kind: 'ORGANIC_SEARCH', visitorKey: 'kxv_gone', sub: 'sub_gone', ageMs: DAY });
      const stale = await seedTouch(c, { kind: 'ORGANIC_SEARCH', visitorKey: 'kxv_gone', sub: 'sub_gone', ageMs: 60 * DAY }); // outside every window: no decision cites it
      const cited = await seedTouch(c, { kind: 'PROVIDER_LINK', visitorKey: 'kxv_gone', sub: 'sub_gone', org: 'org_A', ageMs: 2 * DAY, linkCode: 'GONE0001' });
      const other = await seedTouch(c, { kind: 'ORGANIC_SEARCH', visitorKey: 'kxv_stay', sub: 'sub_stay', ageMs: DAY });
      await c.prisma.growthEvent.createMany({ data: [{ name: 'PageViewed', visitorKey: 'kxv_gone', dedupeKey: 'g1' }, { name: 'PageViewed', visitorKey: 'kxv_stay', dedupeKey: 'g2' }, { name: 'PageViewed', dedupeKey: 'g3' }] });
      const b = await seedBooking(c, { sub: 'sub_gone' });
      await c.get(AttributionService).decideForBooking({ bookingId: b.id, visitorKey: 'kxv_gone' });
      const lt = await c.logoutToken({ sub: 'sub_gone', event: 'subject.deleted' });
      await c.http().post('/api/v1/auth/backchannel-logout').send({ logout_token: lt }).expect(200);
      expect(await c.prisma.growthTouchpoint.findUnique({ where: { id: stale.id } })).not.toBeNull(); // queued, not yet processed
      await c.get(OutboxService).processBatch();
      expect(await c.prisma.growthTouchpoint.findUnique({ where: { id: stale.id } })).toBeNull(); // not evidence for anything: deleted
      // every touch the decision considered is its replayable evidence: anonymised (no sub, no visitor key, no ip hash), kept for the evidence retention period
      expect(await c.prisma.growthTouchpoint.findUniqueOrThrow({ where: { id: mine.id } })).toMatchObject({ sub: null, visitorKey: null, ipHash: '' });
      const kept = await c.prisma.growthTouchpoint.findUniqueOrThrow({ where: { id: cited.id } });
      expect(kept).toMatchObject({ sub: null, visitorKey: null, kind: 'PROVIDER_LINK', providerOrgRef: 'org_A' }); // evidence survives without the person
      expect(await c.prisma.growthTouchpoint.findUnique({ where: { id: other.id } })).not.toBeNull();
      expect((await c.prisma.growthEvent.findMany({ orderBy: { dedupeKey: 'asc' } })).map((e) => e.dedupeKey)).toEqual(['g2', 'g3']);
      expect(await c.prisma.growthAttributionDecision.count({ where: { bookingId: b.id } })).toBe(1);
      const audit = await c.prisma.auditLog.findFirstOrThrow({ where: { action: 'growth.erase_subject' } });
      expect(JSON.stringify(audit.metadata) + audit.resourceId).not.toContain('sub_gone');
    });
    it('in-app deletion runs the same erasure', async () => {
      const auth = await c.as('sub_self');
      await c.http().put('/api/v1/me/profile').set(auth).send({ nameEn: 'Self Delete' }).expect(200);
      const t = await seedTouch(c, { kind: 'ORGANIC_SEARCH', visitorKey: 'kxv_self', sub: 'sub_self' });
      await c.http().post('/api/v1/me/deletion').set(auth).send({ confirm: true }).expect(200);
      expect(await c.prisma.growthTouchpoint.findUnique({ where: { id: t.id } })).toBeNull();
    });
  });
});
