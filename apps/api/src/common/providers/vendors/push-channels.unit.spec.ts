import { createPublicKey, createVerify, generateKeyPairSync } from 'node:crypto';
import { fx } from '../../../../test/fixtures/messaging/fx';
import { apnsJwt, ApnsSender, apnsPayload, apnsProblems, isApnsToken, normalizeP8, type Http2Request, type Http2Response } from './apns';
import { buildDeepLink, isSilent, PushSender, pushProblems, sanitizePushData, PUSH_DATA_KEYS } from './push';
import { pushChannelFor, pushDeepLink } from '../../../messaging/adapters';

const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const p8 = ec.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const cfg = { keyP8: p8, keyId: 'ABCDE12345', teamId: 'TEAM123456', bundleId: 'com.kiorex.app', production: true };
const TOKEN = 'a'.repeat(64);
const b64 = (s: string) => Buffer.from(s, 'base64url');

describe('APNs token-based (.p8, ES256, HTTP/2)', () => {
  it('JWT: header kid, claims iss/iat, a raw r||s ES256 signature that verifies with the public key', () => {
    const t = apnsJwt(cfg, 1_764_000_000_000); const [h, c, sig] = t.split('.');
    expect(JSON.parse(b64(h).toString())).toEqual({ alg: 'ES256', kid: 'ABCDE12345' }); expect(JSON.parse(b64(c).toString())).toEqual({ iss: 'TEAM123456', iat: 1_764_000_000 });
    expect(b64(sig)).toHaveLength(64);
    expect(createVerify('SHA256').update(`${h}.${c}`).verify({ key: createPublicKey(p8), dsaEncoding: 'ieee-p1363' }, b64(sig))).toBe(true);
  });
  it('accepts the key raw, base64 or with escaped newlines; problems name variables only', () => {
    expect(normalizeP8(p8)).toContain('BEGIN PRIVATE KEY'); expect(normalizeP8(Buffer.from(p8).toString('base64'))).toContain('BEGIN PRIVATE KEY'); expect(normalizeP8(p8.replace(/\n/g, '\\n'))).toContain('BEGIN PRIVATE KEY'); expect(normalizeP8('junk')).toBeNull();
    expect(apnsProblems(cfg)).toEqual([]); expect(apnsProblems({}).join()).toMatch(/PUSH_APNS_KEY_P8.*PUSH_APNS_KEY_ID.*PUSH_APNS_TEAM_ID.*PUSH_APNS_BUNDLE_ID/);
    expect(pushProblems({ PUSH_APNS_KEY_P8: p8, PUSH_APNS_KEY_ID: 'ABCDE12345', PUSH_APNS_TEAM_ID: 'TEAM123456', PUSH_APNS_BUNDLE_ID: 'com.kiorex.app' })).toEqual([]);
    expect(pushProblems({ PUSH_APNS_KEY_P8: p8 }).join()).toContain('PUSH_APNS_KEY_ID');
  });
  const h2 = (r: Partial<Http2Response> | Error = {}) => { const calls: any[] = []; const fn: Http2Request = async (o) => { calls.push(o); if (r instanceof Error) throw r; return { status: 200, headers: { 'apns-id': 'APNS-ID-1' }, body: '', ...r }; }; return { fn, calls }; };
  it('sends an alert push with the documented headers; never content-available (no silent push); payload carries only allowed data', async () => {
    const { fn, calls } = h2(); const s = new ApnsSender(cfg, fn, () => 1_764_000_000_000);
    expect(await s.send({ token: TOKEN, title: 'Booking', body: 'Confirmed', data: { bookingId: 'b1', deepLink: 'kiorex://appointment/b1' }, badge: 3, collapseId: 'bk-b1' })).toEqual({ ok: true, providerRef: 'APNS-ID-1' });
    expect(calls[0]).toMatchObject({ host: 'api.push.apple.com', path: `/3/device/${TOKEN}` });
    expect(calls[0].headers).toMatchObject({ 'apns-topic': 'com.kiorex.app', 'apns-push-type': 'alert', 'apns-priority': '10', 'apns-collapse-id': 'bk-b1', 'apns-expiration': String(1_764_000_000 + 86_400) }); expect(calls[0].headers.authorization).toMatch(/^bearer ey/);
    const body = JSON.parse(calls[0].body); expect(body).toEqual({ aps: { alert: { title: 'Booking', body: 'Confirmed' }, sound: 'default', badge: 3 }, bookingId: 'b1', deepLink: 'kiorex://appointment/b1' }); expect(calls[0].body).not.toMatch(/content-available/);
    expect(await new ApnsSender({ ...cfg, production: false }, h2().fn).send({ token: TOKEN, title: 't', body: 'b' })).toMatchObject({ ok: true });
    const sb = h2(); await new ApnsSender({ ...cfg, production: false }, sb.fn).send({ token: TOKEN, title: 't', body: 'b' }); expect(sb.calls[0].host).toBe('api.sandbox.push.apple.com');
    expect(apnsPayload({ token: TOKEN, title: 't', body: 'b' }).aps).toEqual({ alert: { title: 't', body: 'b' }, sound: 'default' });
  });
  it('silent (empty title or body) is refused before any call; a non-hex token is a dead token', async () => {
    const { fn, calls } = h2(); const s = new ApnsSender(cfg, fn);
    expect(await s.send({ token: TOKEN, title: '', body: 'x' })).toEqual({ ok: false, error: 'PUSH_SILENT_REFUSED' }); expect(await s.send({ token: TOKEN, title: 'x', body: ' ' })).toMatchObject({ error: 'PUSH_SILENT_REFUSED' });
    expect(await s.send({ token: 'not-hex', title: 'x', body: 'y' })).toMatchObject({ ok: false, invalidToken: true }); expect(calls).toHaveLength(0);
    expect(isApnsToken(TOKEN)).toBe(true); expect(isApnsToken('ExponentPushToken[abc]')).toBe(false); expect(isApnsToken('f'.repeat(30))).toBe(false);
  });
  it('invalid-token revocation signals: 410 Unregistered, BadDeviceToken, DeviceTokenNotForTopic; auth reasons refresh the JWT; 5xx and 429 are retryable', async () => {
    const reason = async (status: number, reason: string) => new ApnsSender(cfg, h2({ status, body: JSON.stringify({ reason }) }).fn).send({ token: TOKEN, title: 't', body: 'b' });
    expect(await reason(410, 'Unregistered')).toMatchObject({ ok: false, error: 'APNS_Unregistered', invalidToken: true });
    expect(await reason(400, 'BadDeviceToken')).toMatchObject({ invalidToken: true }); expect(await reason(400, 'DeviceTokenNotForTopic')).toMatchObject({ invalidToken: true });
    expect(await reason(403, 'ExpiredProviderToken')).toMatchObject({ authFailed: true, invalidToken: false }); expect(await reason(429, 'TooManyRequests')).toMatchObject({ retryable: true, invalidToken: false }); expect(await reason(503, 'ServiceUnavailable')).toMatchObject({ retryable: true });
    expect(await new ApnsSender(cfg, h2(new Error('socket')).fn).send({ token: TOKEN, title: 't', body: 'b' })).toEqual({ ok: false, error: 'APNS_NETWORK', retryable: true });
    expect(JSON.parse(JSON.stringify(fx('apns-410')))).toEqual({ reason: 'Unregistered', timestamp: 1764030000 });
  });
  it('the provider JWT is reused for 40 minutes then renewed (Apple throttles faster refreshes)', async () => {
    let t = 1_764_000_000_000; const { fn, calls } = h2(); const s = new ApnsSender(cfg, fn, () => t);
    await s.send({ token: TOKEN, title: 't', body: 'b' }); t += 30 * 60_000; await s.send({ token: TOKEN, title: 't', body: 'b' }); t += 11 * 60_000; await s.send({ token: TOKEN, title: 't', body: 'b' });
    const jwts = calls.map((c) => c.headers.authorization); expect(jwts[0]).toBe(jwts[1]); expect(jwts[2]).not.toBe(jwts[1]);
  });
});

describe('FCM v1 and Expo: payload rules', () => {
  it('FCM body: one device token only (no topic, no condition), allow-listed data, badge, ttl, collapse key, alert only', () => {
    const b = PushSender.fcmBody({ token: 'fcm-tok', title: 'T', body: 'B', data: { bookingId: 'b1', patientName: 'Mona', diagnosis: 'x', deepLink: 'kiorex://appointment/b1', note: 'secret' }, badge: 2, ttlSeconds: 3600, collapseId: 'c1', channelId: 'kiorex-bookings' }, {});
    expect(b.message).toMatchObject({ token: 'fcm-tok', notification: { title: 'T', body: 'B' }, data: { bookingId: 'b1', deepLink: 'kiorex://appointment/b1' }, android: { priority: 'HIGH', ttl: '3600s', collapse_key: 'c1', notification: { channel_id: 'kiorex-bookings', notification_count: 2 } }, apns: { payload: { aps: { sound: 'default', badge: 2 } }, headers: { 'apns-push-type': 'alert' } } });
    const json = JSON.stringify(b);
    expect(json).not.toMatch(/"topic"|"condition"|content-available|content_available|patientName|diagnosis|Mona|secret/);
    expect(Object.keys((b.message as any).data).every((k) => (PUSH_DATA_KEYS as readonly string[]).includes(k))).toBe(true);
    expect(PushSender.fcmBody({ token: 't', title: 'T', body: 'B', validateOnly: true }).validate_only).toBe(true);
  });
  it('no silent push: empty title or body is refused on FCM and Expo before any call', async () => {
    const f = jest.fn(); const s = new PushSender({ fcmServiceAccountJson: '{}' }, f as never);
    expect(await s.send({ token: 'x', title: '', body: 'b' })).toEqual({ ok: false, error: 'PUSH_SILENT_REFUSED' }); expect(await s.send({ token: 'ExponentPushToken[a]', title: 't', body: '' })).toEqual({ ok: false, error: 'PUSH_SILENT_REFUSED' }); expect(f).not.toHaveBeenCalled(); expect(isSilent({ title: ' ', body: 'x' })).toBe(true);
  });
  it('token shape routes: Expo -> exp.host, hex -> APNs (never to FCM, so a missing APNs key can not revoke a good token), other -> FCM', async () => {
    const urls: string[] = []; const f = async (u: string) => { urls.push(u); return new Response(JSON.stringify(fx('expo-ticket-ok')), { status: 200 }); };
    const s = new PushSender({}, f as never);
    await s.send({ token: 'ExponentPushToken[abc]', title: 't', body: 'b' }); expect(urls).toEqual(['https://exp.host/--/api/v2/push/send']);
    expect(await s.send({ token: TOKEN, title: 't', body: 'b' })).toEqual({ ok: false, error: 'PUSH_APNS_NOT_CONFIGURED', authFailed: true }); expect(urls).toHaveLength(1);
    const h = h2ok(); const s2 = new PushSender({ apns: cfg, http2: h.fn }, f as never); expect((await s2.send({ token: TOKEN, title: 't', body: 'b', data: { bookingId: 'x', evil: 'y' } })).ok).toBe(true); expect(JSON.parse(h.calls[0].body)).toEqual({ aps: expect.any(Object), bookingId: 'x' });
  });
  it('FCM unregistered fixture and Expo receipts (the only reliable dead-token signal for Expo)', async () => {
    const sa = JSON.stringify({ project_id: 'p', client_email: 'e@p.iam.gserviceaccount.com', private_key: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }) });
    const fcm = async (u: string) => (u.includes('oauth2') ? new Response(JSON.stringify({ access_token: 'a', expires_in: 3600 }), { status: 200 }) : new Response(JSON.stringify(fx('fcm-unregistered')), { status: 404 }));
    expect(await new PushSender({ fcmServiceAccountJson: sa }, fcm as never).send({ token: 'gone', title: 't', body: 'b' })).toMatchObject({ ok: false, error: 'FCM_UNREGISTERED', invalidToken: true });
    const f = async () => new Response(JSON.stringify(fx('expo-receipts')), { status: 200 });
    expect(await new PushSender({}, f as never).expoReceipts(['T-OK', 'T-DEAD', 'T-BIG'])).toEqual({ ok: ['T-OK'], invalid: ['T-DEAD'], failed: ['T-BIG'] });
  });
});

const h2ok = () => { const calls: any[] = []; return { calls, fn: (async (o: any) => { calls.push(o); return { status: 200, headers: { 'apns-id': 'x' }, body: '' }; }) as Http2Request }; };

describe('deep links (kiorex:// patient app, kiorly:// staff app), data allow-list and Android channels', () => {
  it('builds only known paths with safe ids, scheme from configuration', () => {
    expect(buildDeepLink('kiorex', 'appointment/bk_1')).toBe('kiorex://appointment/bk_1'); expect(buildDeepLink('kiorly', '/visit/v-9')).toBe('kiorly://visit/v-9'); expect(buildDeepLink('kiorex', 'pharmacy/order/o1', { kiorex: 'kiorex-staging' })).toBe('kiorex-staging://pharmacy/order/o1');
    for (const p of ['../etc/passwd', 'appointment/../x', 'appointment/a b', 'javascript:alert(1)', 'unknown/1', 'appointment//x', 'appointment/' + 'a'.repeat(70)]) expect(buildDeepLink('kiorex', p)).toBeNull();
    expect(buildDeepLink('kiorex', 'appointment/x', { kiorex: 'JS:' })).toBeNull();
  });
  it('push deep link: explicit link only if it is ours and valid; else derived from the ids the app already routes on', () => {
    expect(pushDeepLink({ bookingId: 'bk_1' })).toBe('kiorex://appointment/bk_1'); expect(pushDeepLink({ pharmacyOrderId: 'o1' })).toBe('kiorex://pharmacy/order/o1'); expect(pushDeepLink({ labBookingId: 'l1' })).toBe('kiorex://lab/booking/l1');
    expect(pushDeepLink({ deepLink: 'kiorex://appointment/bk_9' })).toBe('kiorex://appointment/bk_9'); expect(pushDeepLink({ deepLink: 'https://evil.example/x' })).toBeUndefined(); expect(pushDeepLink({ deepLink: 'kiorex://evil/x' })).toBeUndefined();
    expect(pushDeepLink({ product: 'kiorly', deepLink: 'kiorly://visit/v1' })).toBe('kiorly://visit/v1'); expect(pushDeepLink({ product: 'kiorly', deepLink: 'kiorex://visit/v1' })).toBeUndefined(); expect(pushDeepLink({ bookingId: '../x' })).toBeUndefined(); expect(pushDeepLink(undefined)).toBeUndefined();
  });
  it('data allow-list drops unknown and unsafe values; android channels per family are configurable', () => {
    expect(sanitizePushData({ bookingId: 'b1', kind: 'x', name: 'Mona', bookingId2: 'z', sessionId: '<script>', resultId: 5 })).toEqual({ bookingId: 'b1', kind: 'x' });
    expect(pushChannelFor('BOOKING_CONFIRMED')).toBe('kiorex-bookings'); expect(pushChannelFor('FOLLOW_UP_DUE')).toBe('kiorex-reminders'); expect(pushChannelFor('PHARMACY_ORDER_READY', { orders: 'custom-orders' })).toBe('custom-orders');
  });
});
