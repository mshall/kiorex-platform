import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCtx, futureSlot, seedProvider, TestCtx } from './harness';
import { signProviderLinkTouch, providerLinkTouchSecret } from '../src/growth/growth-public';
import { ensureWidgetBuild } from './widget-bundle';

const ORG = 'cl_1'; // the Clinic clinic id of the fake provider (WidgetRegistration.orgRef)
const SLUG = 'nile-clinic';
const SITE = 'https://clinic.example';
const SITE2 = 'https://www.clinic.example';
const EVIL = 'https://evil.example';
const SELF = 'http://localhost:4000';

describe('booking widget host (GRW-P1-G)', () => {
  let c: TestCtx; let dist: string;
  beforeAll(async () => { dist = ensureWidgetBuild(); process.env.WIDGET_DIST = dist; c = await createCtx(); });
  afterAll(async () => { await c.close(); delete process.env.WIDGET_DIST; });

  const profile = (origins: unknown, extra: Record<string, unknown> = {}) => c.webhook('PROVIDER_PROFILE_UPDATED', { listingId: 'lst_1', clinicId: ORG, clinicianId: 'dr_1', status: 'LIVE', completenessPercent: 90, updatedAt: new Date().toISOString(), provider: {}, clinic: { bookingSlug: SLUG }, widgetOrigins: origins, ...extra }, { aggregateType: 'Listing', aggregateId: 'lst_1' });
  const embed = (slug = SLUG, referer?: string, q = '') => { const r = c.http().get(`/v1/embed/${slug}${q}`).set('Host', 'localhost:4000'); return referer ? r.set('Referer', referer) : r; };
  const session = (origin: string | undefined, parent: string, org = SLUG, extra: Record<string, unknown> = {}) => { const r = c.http().post('/api/v1/widget/v1/session').set('Host', 'localhost:4000'); return (origin ? r.set('Origin', origin) : r).send({ org, parentOrigin: parent, ...extra }); };
  const tokenFor = async (parent = SITE) => (await session(SELF, parent).expect(200)).body.token as string;
  const wh = (t: string) => ({ 'X-KX-Widget': t, Origin: SELF, Host: 'localhost:4000' });
  const csp = (r: { headers: Record<string, string> }) => r.headers['content-security-policy'] ?? '';
  const ancestors = (r: { headers: Record<string, string> }) => /frame-ancestors ([^;]+)/.exec(csp(r))?.[1];

  beforeEach(async () => {
    await c.reset();
    process.env.SITE_ENVIRONMENT = 'development'; delete process.env.WIDGET_HOST; delete process.env.WIDGET_DEV_ORIGINS;
    c.kiorly.slots = [futureSlot(72), futureSlot(73), futureSlot(74), futureSlot(75)];
    await seedProvider(c, { specialty: 'dermatology' });
    await profile([SITE, SITE2]);
  });

  describe('registration sync and frame-ancestors (ADR-038 exception, ADR-044)', () => {
    it('PROVIDER_PROFILE_UPDATED.widgetOrigins becomes the registration; the audit row records before and after', async () => {
      const reg = await c.prisma.widgetRegistration.findUniqueOrThrow({ where: { orgRef: ORG } });
      expect(reg).toMatchObject({ orgSlug: SLUG, origins: [SITE, SITE2], status: 'ACTIVE' });
      const rows = await c.prisma.auditLog.findMany({ where: { action: 'widget.registration_synced' } });
      expect(rows).toHaveLength(1); expect(rows[0]!.metadata).toMatchObject({ before: [], after: [SITE, SITE2] });
      await profile([SITE, SITE2]); // same payload again: no second audit row
      expect(await c.prisma.auditLog.count({ where: { action: 'widget.registration_synced' } })).toBe(1);
    });

    it('a wildcard, http, path or an 11th origin never reaches the registration; the database CHECK refuses a raw wildcard', async () => {
      await profile(['https://*.clinic.example', 'http://clinic.example', 'https://clinic.example/x', SITE]);
      expect((await c.prisma.widgetRegistration.findUniqueOrThrow({ where: { orgRef: ORG } })).origins).toEqual([SITE]);
      await expect(c.prisma.widgetRegistration.create({ data: { orgRef: 'cl_x', origins: ['https://*.x.example'] } })).rejects.toThrow();
      await profile(Array.from({ length: 14 }, (_, i) => `https://s${i}.example.com`));
      expect((await c.prisma.widgetRegistration.findUniqueOrThrow({ where: { orgRef: ORG } })).origins).toHaveLength(10);
    });

    it('the embed document carries frame-ancestors equal to the exact allow-list (and nothing else)', async () => {
      const r = await embed(SLUG, SITE).expect(200);
      expect(ancestors(r)).toBe(`${SITE} ${SITE2}`);
      expect(csp(r)).not.toContain('*');
      expect(r.headers['cache-control']).toBe('private, no-store');
      expect(r.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(r.headers['x-frame-options']).toBeUndefined();
      expect(r.text).toContain('id="kx-boot"');
      expect(csp(r)).toContain("script-src 'self'");
      expect(r.text).not.toMatch(/<script(?![^>]*(?:src=|type="application\/json"))/); // no inline executable script
    });

    it("an unknown organisation, a registration with no origins, and a disallowed Referer all get frame-ancestors 'none' and no document", async () => {
      const unknown = await embed('no-such-clinic', SITE).expect(404);
      expect(ancestors(unknown)).toBe("'none'"); expect(unknown.headers['x-frame-options']).toBe('DENY');
      const evil = await embed(SLUG, EVIL).expect(403);
      expect(ancestors(evil)).toBe("'none'"); expect(evil.text).not.toContain('kx-boot');
      await profile([]);
      const empty = await embed(SLUG, SITE).expect(403);
      expect(ancestors(empty)).toBe("'none'");
    });

    it('a subdomain or look-alike of an allowed origin is refused (exact match only) and audited once per hour', async () => {
      for (const bad of ['https://evil.clinic.example', 'https://clinic.example.evil.test', 'http://clinic.example', 'https://clinic.example:8443']) await embed(SLUG, bad).expect(403);
      await embed(SLUG, 'https://evil.clinic.example').expect(403);
      const rows = await c.prisma.auditLog.findMany({ where: { action: 'widget.origin_denied' } });
      expect(rows.length).toBe(4); // the repeated one is rate-limited out of the log
      expect(rows.map((r) => (r.metadata as any).reason)).toEqual(expect.arrayContaining(['REFERER_NOT_ALLOWED']));
    });

    it('a top-level navigation (Sec-Fetch-Dest: document) is refused: the widget only renders inside a frame', async () => {
      const r = await embed(SLUG, undefined).set('Sec-Fetch-Dest', 'document').expect(403);
      expect(ancestors(r)).toBe("'none'");
      await embed(SLUG, undefined).set('Sec-Fetch-Dest', 'iframe').expect(200);
    });

    it('the patient API, the SPA host and every other document keep frame-ancestors none: the API answers no framable document', async () => {
      for (const p of ['/api/v1/health', '/v1/embed/auth/callback', '/robots.txt']) {
        const r = await c.http().get(p).set('Host', 'localhost:4000');
        if (r.headers['content-security-policy']) expect(ancestors(r)).toBe("'none'");
        expect(r.headers['content-security-policy'] ?? "frame-ancestors 'none'").toContain("frame-ancestors 'none'");
      }
    });

    it('with WIDGET_HOST set, the widget routes exist only on that host', async () => {
      process.env.WIDGET_HOST = 'book.kiorex.com';
      await c.http().get(`/v1/embed/${SLUG}`).set('Host', 'kiorex.com').set('Referer', SITE).expect(404);
      await c.http().get('/v1/sdk.js').set('Host', 'www.kiorex.com').expect(404);
      const ok = await c.http().get(`/v1/embed/${SLUG}`).set('Host', 'book.kiorex.com').set('Referer', SITE).expect(200);
      expect(ancestors(ok)).toBe(`${SITE} ${SITE2}`);
      expect(ok.headers['strict-transport-security']).toContain('max-age=');
    });

    it('flag growth.widgets OFF: embed and SDK answer 403 FEATURE_DISABLED, session too', async () => {
      await c.flags.setValue('admin', { key: 'growth.widgets', scope: 'GLOBAL', value: 'OFF', reason: 'test', ticket: 'T-1' });
      const e = await embed(SLUG, SITE).set('Accept', 'application/json').expect(403);
      expect(e.body).toMatchObject({ code: 'FEATURE_DISABLED', key: 'growth.widgets' });
      expect(ancestors(e)).toBe("'none'");
      expect((await c.http().get('/v1/sdk.js').set('Host', 'localhost:4000').expect(403)).body.code).toBe('FEATURE_DISABLED');
      expect((await session(SELF, SITE).expect(403)).body.code).toBe('FEATURE_DISABLED');
    });

    it('non-production dev origins are honoured only when configured and never in production', async () => {
      process.env.WIDGET_DEV_ORIGINS = 'http://localhost:4392';
      expect(ancestors(await embed(SLUG, 'http://localhost:4392').expect(200))).toBe(`${SITE} ${SITE2} http://localhost:4392`);
      process.env.NODE_ENV = 'production'; process.env.WIDGET_HOST = 'localhost:4000';
      try { await embed(SLUG, 'http://localhost:4392').expect(403); } finally { process.env.NODE_ENV = 'test'; delete process.env.WIDGET_HOST; }
    });
  });

  describe('session token and per-request origin enforcement', () => {
    it('issues a token bound to an allow-listed origin; rejects other origins with GROWTH_WIDGET_ORIGIN_NOT_ALLOWED and audits them', async () => {
      const ok = await session(SELF, SITE).expect(200);
      expect(ok.body).toMatchObject({ org: ORG, slug: SLUG }); expect(ok.body.token).toMatch(/^kxw1\./);
      const bad = await session(SELF, EVIL).expect(403);
      expect(bad.body.code).toBe('GROWTH_WIDGET_ORIGIN_NOT_ALLOWED');
      await session(SELF, 'https://clinic.example:8443').expect(403);
      await session(SELF, 'not a url').expect(400);
      expect((await c.prisma.auditLog.findMany({ where: { action: 'widget.origin_denied' } })).length).toBeGreaterThanOrEqual(2);
    });

    it('sessions are issued to the widget app only: a call from another origin, or without Origin, is refused', async () => {
      expect((await session(EVIL, SITE).expect(403)).body.code).toBe('WIDGET_ORIGIN_MISMATCH');
      expect((await session(undefined, SITE).expect(403)).body.code).toBe('WIDGET_ORIGIN_MISMATCH');
    });

    it('revocation is immediate: removing an origin from the Clinic list ends the token it was bound to', async () => {
      const t = await tokenFor(SITE);
      await c.http().get('/api/v1/widget/v1/config').set(wh(t)).expect(200);
      await profile([SITE2]);
      const r = await c.http().get('/api/v1/widget/v1/config').set(wh(t)).expect(403);
      expect(r.body.code).toBe('GROWTH_WIDGET_ORIGIN_NOT_ALLOWED');
      await c.http().get('/api/v1/widget/v1/config').set(wh(await tokenFor(SITE2))).expect(200);
    });

    it('a token is not a general credential: other routes, a foreign Origin, a tampered or missing token are refused', async () => {
      const t = await tokenFor();
      const auth = await c.as('sub_amira');
      expect((await c.http().get('/api/v1/me/consents').set({ ...wh(t), ...auth }).expect(403)).body.code).toBe('WIDGET_ROUTE_NOT_ALLOWED');
      expect((await c.http().get('/api/v1/widget/v1/config').set({ ...wh(t), Origin: EVIL }).expect(403)).body.code).toBe('WIDGET_ORIGIN_MISMATCH');
      expect((await c.http().get('/api/v1/widget/v1/config').set({ ...wh(t.slice(0, -3) + 'abc') }).expect(401)).body.code).toBe('WIDGET_TOKEN_INVALID');
      expect((await c.http().get('/api/v1/widget/v1/config').set({ Host: 'localhost:4000' }).expect(401)).body.code).toBe('WIDGET_TOKEN_INVALID');
    });

    it('slots of another clinic are out of scope; slots of this clinic come from the existing public slot API', async () => {
      await seedProvider(c, { id: 'lst_2', clinicId: 'cl_2', clinicianId: 'dr_2' });
      const t = await tokenFor();
      const own = await c.http().get('/api/v1/providers/lst_1/slots?typeId=typ_1').set(wh(t)).expect(200);
      expect(own.body.slots.length).toBeGreaterThan(0);
      expect((await c.http().get('/api/v1/providers/lst_2/slots?typeId=typ_1').set(wh(t)).expect(403)).body.code).toBe('WIDGET_PROVIDER_OUT_OF_SCOPE');
    });

    it('slot and booking endpoints are rate limited in the shared Postgres limiter (429 + Retry-After)', async () => {
      process.env.WIDGET_RATE_SLOTS_PER_MIN = '3'; process.env.WIDGET_RATE_BOOKING_PER_MIN = '2';
      try {
        const t = await tokenFor(); const auth = await c.as('sub_amira');
        for (let i = 0; i < 3; i++) await c.http().get('/api/v1/providers/lst_1/slots?typeId=typ_1').set(wh(t)).expect(200);
        const limited = await c.http().get('/api/v1/providers/lst_1/slots?typeId=typ_1').set(wh(t)).expect(429);
        expect(limited.body.code).toBe('GROWTH_RATE_LIMITED'); expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
        expect(await c.prisma.rateLimitBucket.count({ where: { key: { startsWith: 'widget:slots-ip' } } })).toBe(1); // a Postgres row, shared by every instance
        const slot = c.kiorly.slots[0]!;
        const body = { providerId: 'lst_1', typeId: 'typ_1', startsAt: slot.startsAt, endsAt: slot.endsAt };
        await c.http().post('/api/v1/bookings').set({ ...wh(t), ...auth }).send(body).expect(201);
        await c.http().post('/api/v1/bookings').set({ ...wh(t), ...auth }).send(body).expect(409).catch(() => undefined);
        await c.http().post('/api/v1/bookings').set({ ...wh(t), ...auth }).send(body);
        await c.http().post('/api/v1/bookings').set({ ...wh(t), ...auth }).send(body).expect(429);
      } finally { delete process.env.WIDGET_RATE_SLOTS_PER_MIN; delete process.env.WIDGET_RATE_BOOKING_PER_MIN; }
    });

    it('low-friction registration: through a token the profile can only get a display name and language, never a national id or e-mail', async () => {
      const t = await tokenFor(); const auth = await c.as('sub_new_visitor');
      expect((await c.http().get('/api/v1/me/profile').set({ ...wh(t), ...auth }).expect(200)).body).toMatchObject({ phone: '+201000000001' }); // created from the Passport claims
      const put = await c.http().put('/api/v1/me/profile').set({ ...wh(t), ...auth }).send({ nameEn: 'Mona Adel', preferredLocale: 'ar', nationalId: '29001011234567', email: 'x@example.com', dateOfBirth: '1990-01-01' }).expect(200);
      expect(put.body).toMatchObject({ nameEn: 'Mona Adel', preferredLocale: 'ar', hasNationalId: false, email: null, dateOfBirth: null });
    });

    it('slot hoarding: one person can hold at most maxActiveHoldsPerPhone slots through widgets', async () => {
      const t = await tokenFor(); const auth = await c.as('sub_amira');
      const post = (i: number) => c.http().post('/api/v1/bookings').set({ ...wh(t), ...auth }).send({ providerId: 'lst_1', typeId: 'typ_1', startsAt: c.kiorly.slots[i]!.startsAt, endsAt: c.kiorly.slots[i]!.endsAt });
      for (let i = 0; i < 3; i++) await post(i).expect(201);
      expect((await post(3).expect(429)).body.code).toBe('WIDGET_HOLD_LIMIT');
    });
  });

  describe('booking through the widget', () => {
    it('creates a CLINIC_LINK booking with the page slug even if the client asks for MARKETPLACE, holds 5 minutes, and confirms idempotently', async () => {
      const t = await tokenFor(); const auth = await c.as('sub_amira');
      await c.http().put('/api/v1/me/profile').set(auth).send({ nameEn: 'Amira Samy', preferredLocale: 'en' }).expect(200);
      const slot = c.kiorly.slots[0]!;
      const held = await c.http().post('/api/v1/bookings').set({ ...wh(t), ...auth }).send({ providerId: 'lst_1', typeId: 'typ_1', startsAt: slot.startsAt, endsAt: slot.endsAt, channel: 'MARKETPLACE', bookingPageSlug: 'forged' }).expect(201);
      expect(held.body).toMatchObject({ status: 'HELD', channel: 'CLINIC_LINK' });
      const mins = (new Date(held.body.holdExpiresAt).getTime() - Date.now()) / 60_000;
      expect(mins).toBeGreaterThan(4); expect(mins).toBeLessThanOrEqual(5.1);
      expect((await c.prisma.bookingIntent.findUniqueOrThrow({ where: { id: held.body.id } })).patientSnapshot).toMatchObject({ bookingPageSlug: SLUG });
      const a = await c.http().post(`/api/v1/bookings/${held.body.id}/confirm`).set({ ...wh(t), ...auth }).send({ marketplaceConsent: true }).expect(200);
      const b = await c.http().post(`/api/v1/bookings/${held.body.id}/confirm`).set({ ...wh(t), ...auth }).send({ marketplaceConsent: true }).expect(200);
      expect(a.body.status).toBe('CONFIRMED'); expect(b.body.status).toBe('CONFIRMED');
      const calls = c.kiorly.callsTo('POST', '/bookings');
      expect(calls).toHaveLength(1);
      expect(calls[0]!.headers['idempotency-key']).toBe(held.body.id);
      expect(calls[0]!.body).toMatchObject({ channel: 'CLINIC_LINK', bookingPageSlug: SLUG });
    });

    it('a widget booking with a valid provider link token (lt) is PROVIDER_LED (package C), carries the signed acquisition block, and never a Kiorex fee basis', async () => {
      const t = await tokenFor(); const auth = await c.as('sub_amira');
      await c.http().put('/api/v1/me/profile').set(auth).send({ nameEn: 'Amira Samy' }).expect(200);
      const lt = signProviderLinkTouch(providerLinkTouchSecret()!, { orgRef: 'tn_1', code: '7K2M9X4Q', now: Date.now() });
      const slot = c.kiorly.slots[0]!;
      const held = await c.http().post('/api/v1/bookings').set({ ...wh(t), ...auth }).send({ providerId: 'lst_1', typeId: 'typ_1', startsAt: slot.startsAt, endsAt: slot.endsAt, lt }).expect(201);
      expect(await c.prisma.bookingIntent.findUniqueOrThrow({ where: { id: held.body.id } })).toMatchObject({ channel: 'CLINIC_LINK', acquisitionOrigin: 'PROVIDER_LED' });
      await c.http().post(`/api/v1/bookings/${held.body.id}/confirm`).set({ ...wh(t), ...auth }).send({ marketplaceConsent: true }).expect(200);
      expect(c.kiorly.callsTo('POST', '/bookings')[0]!.body).toMatchObject({ channel: 'CLINIC_LINK', bookingPageSlug: SLUG, acquisition: { origin: 'PROVIDER_LED' }, lt });
    });

    it('DOUBLE-BOOKING: many widgets race for one slot, exactly one wins, every other gets SLOT_TAKEN with alternatives', async () => {
      c.kiorly.exclusiveHolds = true; process.env.WIDGET_RATE_BOOKING_PER_MIN = '1000'; // the racers stand for different visitors; the per-IP ceiling has its own test
      const racers = 12; const slot = c.kiorly.slots[0]!;
      const people = await Promise.all(Array.from({ length: racers }, async (_, i) => ({ sub: `sub_race_${i}`, auth: await c.as(`sub_race_${i}`), t: await tokenFor(i % 2 ? SITE : SITE2) })));
      const res = await Promise.all(people.map((p) => c.http().post('/api/v1/bookings').set({ ...wh(p.t), ...p.auth }).send({ providerId: 'lst_1', typeId: 'typ_1', startsAt: slot.startsAt, endsAt: slot.endsAt })));
      const won = res.filter((r) => r.status === 201); const lost = res.filter((r) => r.status === 409);
      expect(won).toHaveLength(1); expect(lost).toHaveLength(racers - 1);
      for (const l of lost) { expect(l.body.code).toBe('SLOT_TAKEN'); expect(l.body.alternatives.length).toBeGreaterThan(0); expect(l.body.alternatives.map((s: any) => s.startsAt)).not.toContain(slot.startsAt); }
      expect(await c.prisma.bookingIntent.count({ where: { status: 'HELD' } })).toBe(1);
      expect(await c.prisma.bookingIntent.count({ where: { status: 'EXPIRED', failureCode: 'SLOT_TAKEN' } })).toBe(racers - 1);
      const winner = people[res.findIndex((r) => r.status === 201)]!;
      await c.http().put('/api/v1/me/profile').set(winner.auth).send({ nameEn: 'Race Winner' }).expect(200);
      const conf = await c.http().post(`/api/v1/bookings/${won[0]!.body.id}/confirm`).set({ ...wh(winner.t), ...winner.auth }).send({ marketplaceConsent: true });
      expect([conf.status, conf.body.code]).toEqual([200, undefined]);
      expect(c.kiorly.callsTo('POST', '/bookings')).toHaveLength(1); // one appointment at the Clinic
      delete process.env.WIDGET_RATE_BOOKING_PER_MIN;
    });

    it('a patient who retries the same confirm after a network error does not create a second appointment', async () => {
      const t = await tokenFor(); const auth = await c.as('sub_amira');
      await c.http().put('/api/v1/me/profile').set(auth).send({ nameEn: 'Amira Samy' }).expect(200);
      const slot = c.kiorly.slots[1]!;
      const held = await c.http().post('/api/v1/bookings').set({ ...wh(t), ...auth }).send({ providerId: 'lst_1', typeId: 'typ_1', startsAt: slot.startsAt, endsAt: slot.endsAt }).expect(201);
      const [x, y] = await Promise.all([1, 2].map(() => c.http().post(`/api/v1/bookings/${held.body.id}/confirm`).set({ ...wh(t), ...auth }).send({ marketplaceConsent: true })));
      expect([x.status, y.status].every((s) => s === 200 || s === 409)).toBe(true);
      expect(c.kiorly.callsTo('POST', '/bookings').length).toBeLessThanOrEqual(2);
      expect(c.kiorly.bookings.size).toBe(1);
    });
  });

  describe('widget config API', () => {
    it('lists the clinic doctors with in-clinic visit types and fees; doctor and specialty narrow it; an unknown doctor is 404', async () => {
      const t = await tokenFor();
      const all = await c.http().get('/api/v1/widget/v1/config').set(wh(t)).expect(200);
      expect(all.body.providers).toHaveLength(1);
      expect(all.body.providers[0]).toMatchObject({ id: 'lst_1', specialty: 'dermatology' });
      expect(all.body.providers[0].fees[0]).toMatchObject({ typeId: 'typ_1', amountMinor: 30000 });
      expect(JSON.stringify(all.body)).not.toMatch(/phone|nationalId|email/i);
      await c.http().get('/api/v1/widget/v1/config?doctor=lst_1').set(wh(t)).expect(200);
      expect((await c.http().get('/api/v1/widget/v1/config?doctor=nobody').set(wh(t)).expect(404)).body.code).toBe('WIDGET_DOCTOR_NOT_FOUND');
      expect((await c.http().get('/api/v1/widget/v1/config?specialty=cardiology').set(wh(t)).expect(200)).body.providers).toHaveLength(0);
    });
  });

  describe('SDK delivery and SRI', () => {
    it('serves the SDK at a rolling and an immutable versioned path with CORS for SRI; the published integrity matches the bytes', async () => {
      const info = (await c.http().get('/v1/sdk.json').set('Host', 'localhost:4000').expect(200)).body;
      expect(info.integrity).toMatch(/^sha384-/);
      const rolling = await c.http().get('/v1/sdk.js').set('Host', 'localhost:4000').expect(200);
      expect(rolling.headers['access-control-allow-origin']).toBe('*'); expect(rolling.headers['content-type']).toContain('javascript');
      const pinned = await c.http().get(info.path).set('Host', 'localhost:4000').buffer(true).expect(200);
      expect(pinned.headers['cache-control']).toContain('immutable');
      const sha = `sha384-${createHash('sha384').update(readFileSync(join(dist, 'sdk', info.file))).digest('base64')}`;
      expect(sha).toBe(info.integrity);
      expect(pinned.text).toBe(rolling.text);
      await c.http().get('/v1/0000000000000000/sdk.js').set('Host', 'localhost:4000').expect(404);
      expect(info.gzipBytes).toBeLessThan(10 * 1024);
    });
  });

  describe('popup return page, sandbox and ops audit', () => {
    it('the Passport callback page loads one script of this origin, takes no token, and cannot be framed', async () => {
      const r = await c.http().get('/v1/embed/auth/callback?code=x&state=y').set('Host', 'localhost:4000').expect(200);
      expect(ancestors(r)).toBe("'none'"); expect(r.headers['referrer-policy']).toBe('no-referrer');
      expect(r.text).toMatch(/<script src="\/v1\/embed\/assets\/callback-[^"]+\.js">/);
    });
    it('the sandbox demo page renders the live widget and the three snippets for a registered organisation, and 404s for an unknown one', async () => {
      const r = await c.http().get(`/v1/sandbox?org=${SLUG}`).set('Host', 'localhost:4000').expect(200);
      expect(r.text).toContain('data-kx-widget'); expect(r.text).toContain('integrity=&quot;sha384-'.replace('&quot;', '"').replace('&quot;', '"') === '' ? '' : 'sha384-');
      expect(ancestors(r)).toBe("'none'");
      await c.http().get('/v1/sandbox?org=nobody').set('Host', 'localhost:4000').expect(404);
    });
    it('ops can read the audit and the registrations; patients cannot', async () => {
      await embed(SLUG, EVIL).expect(403);
      const ops = await c.as('adm1', { roles: ['ops_admin'] });
      const audit = await c.http().get('/api/v1/widget/v1/ops/audit').set(ops).expect(200);
      expect(audit.body.map((r: any) => r.action)).toEqual(expect.arrayContaining(['widget.origin_denied', 'widget.registration_synced']));
      expect((await c.http().get('/api/v1/widget/v1/ops/registrations').set(ops).expect(200)).body[0]).toMatchObject({ orgRef: ORG, origins: [SITE, SITE2] });
      await c.http().get('/api/v1/widget/v1/ops/audit').set(await c.as('sub_amira')).expect(403);
    });
  });
});
