import { generateKeyPairSync, createHmac, createHash } from 'node:crypto';
import { signV4, awsRegionFromHost } from './sigv4';
import { metaTemplateBody, parseMetaSend, parseMetaWebhook, signMetaBody, verifyMetaSignature, metaVerifyChallenge } from './meta-whatsapp';
import { sesSendBody, sesSigner, parseSesEvents, snsConfirmUrl, verifySnsBasicAuth, parseSesSend } from './ses';
import { parseTwilioStatus, signTwilio, twilioForm, verifyTwilioSignature } from './twilio-sms';
import { PushSender, isExpoToken, pushProblems } from './push';
import { paymobHmac, parsePaymobCallback, parsePaymobIntention, verifyPaymobHmac } from './paymob';
import { fawryCallbackSignature, fawryCheckoutUrl, parseFawryCallback, verifyFawryCallback } from './fawry';
import { parseAmazonGeocode } from './maps-amazon';
import { providerProblems, providerEnv } from '../env';
import { HttpMessagingTransport, messagingMapping } from '../real-adapters';
import { HttpPspAdapter } from '../../../pay/psp';
import { PaymobPspAdapter, FawryPspAdapter, vendorPspProblems } from '../../../pay/psp.vendors';
import { ClinicP2pVideoAdapter, MockVideoAdapter, videoAdapter } from '../../../telemedicine/video';
import { AmazonMapsAdapter } from '../../../address/maps.adapter';
import { OpenAiEuProvider, aiProblems } from '../../../ai-gateway/ai-gateway.service';
import { providerStatus, verifyProviderStartup } from '../startup';

interface Call { url: string; init: RequestInit; body: any }
/** Recorded-response fake HTTP: replies are scripted per call, requests are captured for assertions. */
function fake(...replies: Array<{ status?: number; json?: unknown }>) {
  const calls: Call[] = [];
  const fn = async (url: string, init: RequestInit = {}) => {
    const raw = typeof init.body === 'string' ? init.body : '';
    let body: any = raw; try { body = JSON.parse(raw); } catch { /* form / empty */ }
    calls.push({ url, init, body });
    const r = replies.shift() ?? { status: 200, json: {} };
    return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  };
  return { fn: fn as unknown as typeof fetch, calls };
}
const deps = (f: ReturnType<typeof fake>) => ({ fetchImpl: f.fn as never, sleep: async () => undefined, random: () => 0 });
const hdr = (c: Call, k: string) => new Headers(c.init.headers).get(k);

describe('AWS SigV4', () => {
  it('matches the published get-vanilla test vector', () => {
    const h = signV4({ method: 'GET', url: 'https://example.amazonaws.com/', body: '', region: 'us-east-1', service: 'service', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', now: new Date('2015-08-30T12:36:00Z') });
    expect(h.authorization).toBe('AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31');
  });
  it('derives the region from an AWS host', () => { expect(awsRegionFromHost('email.eu-central-1.amazonaws.com')).toBe('eu-central-1'); expect(awsRegionFromHost('example.com')).toBeUndefined(); });
});

describe('WhatsApp (Meta Cloud API)', () => {
  const env = { WHATSAPP_MODE: 'real', WHATSAPP_PROVIDER: 'meta', WHATSAPP_API_KEY: 'EAAG_token', WHATSAPP_SENDER_ID: '1055550001', WHATSAPP_WEBHOOK_SECRET: 'app_secret_0123456789ab', WHATSAPP_VERIFY_TOKEN: 'vt_123456' };
  it('uses the Graph API default URL, validates the verify token', () => {
    expect(providerEnv('WHATSAPP', env).apiUrl).toBe('https://graph.facebook.com/v21.0');
    expect(providerProblems('WHATSAPP', env)).toEqual([]);
    expect(providerProblems('WHATSAPP', { ...env, WHATSAPP_VERIFY_TOKEN: '' })).toContain('WHATSAPP_VERIFY_TOKEN is required when WHATSAPP_PROVIDER=meta');
  });
  it('sends an approved template message to /{phone-number-id}/messages with bearer auth and an idempotency key', async () => {
    const f = fake({ json: { messaging_product: 'whatsapp', messages: [{ id: 'wamid.ABC' }] } });
    const penv = { ...process.env, ...env, WHATSAPP_TEMPLATE_MAP: '{"BOOKING_CONFIRMED":"kx_booking_confirmed_v1"}' };
    const saved = process.env; process.env = penv;
    try {
      const t = new HttpMessagingTransport('WHATSAPP', providerEnv('WHATSAPP', penv), deps(f));
      const r = await t.send({ to: '+201001234567', body: 'Your booking is confirmed', reference: 'msg_1', templateId: 'BOOKING_CONFIRMED', locale: 'ar' });
      expect(r).toEqual({ ok: true, providerRef: 'wamid.ABC' });
    } finally { process.env = saved; }
    expect(f.calls[0].url).toBe('https://graph.facebook.com/v21.0/1055550001/messages');
    expect(hdr(f.calls[0], 'authorization')).toBe('Bearer EAAG_token');
    expect(hdr(f.calls[0], 'idempotency-key')).toBe('msg_1');
    expect(f.calls[0].body).toEqual({ messaging_product: 'whatsapp', recipient_type: 'individual', to: '201001234567', type: 'template', template: { name: 'kx_booking_confirmed_v1', language: { code: 'ar' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'Your booking is confirmed' }] }] } });
  });
  it('maps a Meta 4xx to a stored error code without leaking the body', async () => {
    const f = fake({ status: 400, json: { error: { message: 'secret detail', code: 131030 } } });
    const t = new HttpMessagingTransport('WHATSAPP', providerEnv('WHATSAPP', env), deps(f), messagingMapping('WHATSAPP', env));
    const r = await t.send({ to: '+201001234567', body: 'x', reference: 'm', templateId: 'T', locale: 'en' });
    expect(r).toEqual({ ok: false, providerRef: '', error: 'PROVIDER_INVALID_REQUEST_400' });
    expect(f.calls).toHaveLength(1);
  });
  it('verifies X-Hub-Signature-256 and rejects tampering', () => {
    const raw = '{"object":"whatsapp_business_account"}';
    expect(verifyMetaSignature('app_secret_0123456789ab', raw, { 'x-hub-signature-256': signMetaBody('app_secret_0123456789ab', raw) })).toBe(true);
    expect(verifyMetaSignature('app_secret_0123456789ab', raw + ' ', { 'x-hub-signature-256': signMetaBody('app_secret_0123456789ab', raw) })).toBe(false);
    expect(verifyMetaSignature('app_secret_0123456789ab', raw, {})).toBe(false);
  });
  it('answers the hub.challenge handshake only with the right token', () => {
    expect(metaVerifyChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': 'vt', 'hub.challenge': '4242' }, 'vt')).toBe('4242');
    expect(metaVerifyChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': 'bad', 'hub.challenge': '1' }, 'vt')).toBeNull();
  });
  it('parses statuses (sent/delivered/read/failed) and inbound text + button replies', () => {
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: {
      statuses: [{ id: 'wamid.1', status: 'delivered', timestamp: '1700000000' }, { id: 'wamid.2', status: 'failed', errors: [{ code: 131026 }] }, { id: 'wamid.3', status: 'unknown' }],
      messages: [{ from: '201001234567', id: 'wamid.in1', type: 'text', text: { body: 'hello' } }, { from: '201009999999', id: 'wamid.in2', type: 'interactive', interactive: { button_reply: { id: 'CONFIRM', title: 'Confirm' } } }] } }] }] });
    const p = parseMetaWebhook(body);
    expect(p.statuses).toEqual([{ providerRef: 'wamid.1', status: 'DELIVERED', occurredAt: '2023-11-14T22:13:20.000Z' }, { providerRef: 'wamid.2', status: 'FAILED', error: 'META_131026' }]);
    expect(p.inbound).toEqual([{ from: '+201001234567', text: 'hello', providerRef: 'wamid.in1' }, { from: '+201009999999', text: 'Confirm', buttonPayload: 'CONFIRM', providerRef: 'wamid.in2' }]);
    expect(parseMetaWebhook('not json')).toEqual({ statuses: [], inbound: [] });
    expect(() => parseMetaSend({})).toThrow();
    expect(metaTemplateBody({ to: '+20100', templateName: 'otp', language: 'en', bodyParams: ['123456'], urlButtonParam: '123456' }).template.components).toHaveLength(2);
  });
});

describe('Email (Amazon SES v2)', () => {
  const env = { EMAIL_MODE: 'real', EMAIL_PROVIDER: 'ses', EMAIL_API_URL: 'https://email.eu-central-1.amazonaws.com', EMAIL_API_KEY: 'AKIAEXAMPLE:secretkeyexample', EMAIL_SENDER_ID: 'Kiorex <no-reply@kiorex.com>', EMAIL_WEBHOOK_SECRET: 'sns_basic_pw_0123456789' };
  it('validates region URL and key format', () => {
    expect(providerProblems('EMAIL', env)).toEqual([]);
    expect(providerProblems('EMAIL', { ...env, EMAIL_API_URL: 'https://mail.example.com' })).toContain('EMAIL_API_URL must be https://email.<region>.amazonaws.com when EMAIL_PROVIDER=ses');
    expect(providerProblems('EMAIL', { ...env, EMAIL_API_KEY: 'nokey' })).toContain('EMAIL_API_KEY must be "<ACCESS_KEY_ID>:<SECRET_ACCESS_KEY>" when EMAIL_PROVIDER=ses');
  });
  it('POSTs a SigV4-signed SendEmail request and reads MessageId', async () => {
    const f = fake({ json: { MessageId: '0100018c-ses' } });
    const t = new HttpMessagingTransport('EMAIL', providerEnv('EMAIL', env), deps(f), messagingMapping('EMAIL', env));
    const r = await t.send({ to: 'patient@example.com', body: 'Hello', subject: 'Booking confirmed', reference: 'msg_9', templateId: 'BOOKING_CONFIRMED', locale: 'en' });
    expect(r).toEqual({ ok: true, providerRef: '0100018c-ses' });
    const c = f.calls[0];
    expect(c.url).toBe('https://email.eu-central-1.amazonaws.com/v2/email/outbound-emails');
    expect(hdr(c, 'authorization')).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/\d{8}\/eu-central-1\/ses\/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=[0-9a-f]{64}$/);
    expect(c.body.Content.Simple.Subject.Data).toBe('Booking confirmed');
    expect(c.body.Destination.ToAddresses).toEqual(['patient@example.com']);
  });
  it('sesSendBody / sesSigner / parseSesSend', () => {
    expect(sesSendBody({ from: 'a@b.c', to: 'x@y.z', subject: 's', text: 't', configurationSet: 'cs' }).ConfigurationSetName).toBe('cs');
    expect(sesSigner('https://email.eu-central-1.amazonaws.com', 'bad')).toBeUndefined();
    expect(() => parseSesSend({})).toThrow();
  });
  it('authenticates the SNS HTTPS subscription (basic auth) and handles confirmation + notifications', () => {
    const auth = { authorization: `Basic ${Buffer.from('kiorex:sns_basic_pw_0123456789').toString('base64')}` };
    expect(verifySnsBasicAuth('sns_basic_pw_0123456789', auth)).toBe(true);
    expect(verifySnsBasicAuth('sns_basic_pw_0123456789', { authorization: `Basic ${Buffer.from('x:wrong').toString('base64')}` })).toBe(false);
    expect(snsConfirmUrl(JSON.stringify({ Type: 'SubscriptionConfirmation', SubscribeURL: 'https://sns.eu-central-1.amazonaws.com/?Action=ConfirmSubscription&Token=t' }))).toContain('ConfirmSubscription');
    expect(snsConfirmUrl(JSON.stringify({ Type: 'SubscriptionConfirmation', SubscribeURL: 'https://evil.example.com/x' }))).toBeNull();
    const n = (m: unknown) => JSON.stringify({ Type: 'Notification', Message: JSON.stringify(m) });
    expect(parseSesEvents(n({ eventType: 'Delivery', mail: { messageId: 'm1' }, delivery: { timestamp: '2026-11-23T10:00:00.000Z' } }))).toEqual([{ providerRef: 'm1', status: 'DELIVERED', occurredAt: '2026-11-23T10:00:00.000Z' }]);
    expect(parseSesEvents(n({ eventType: 'Bounce', mail: { messageId: 'm2' }, bounce: { bounceType: 'Permanent' } }))[0]).toMatchObject({ status: 'FAILED', error: 'SES_BOUNCE_PERMANENT' });
    expect(parseSesEvents(n({ eventType: 'Complaint', mail: { messageId: 'm3' } }))[0]).toMatchObject({ status: 'FAILED', error: 'SES_COMPLAINT' });
    expect(parseSesEvents('garbage')).toEqual([]);
  });
});

describe('SMS (Twilio)', () => {
  const env = { SMS_MODE: 'real', SMS_PROVIDER: 'twilio', SMS_API_KEY: 'ACabc123:authtoken_0123456789abcdef', SMS_SENDER_ID: 'KIOREX', SMS_WEBHOOK_PUBLIC_URL: 'https://api.kiorex.com/api/v1/messaging/webhooks/sms' };
  it('needs only the key + sender + public webhook URL (webhook secret = auth token)', () => {
    expect(providerProblems('SMS', env)).toEqual([]);
    expect(providerEnv('SMS', env).webhookSecret).toBe('authtoken_0123456789abcdef');
    expect(providerProblems('SMS', { ...env, SMS_WEBHOOK_PUBLIC_URL: '' })).toContain('SMS_WEBHOOK_PUBLIC_URL is required when SMS_PROVIDER=twilio (the URL Twilio signs)');
  });
  it('POSTs a form body with basic auth and the StatusCallback', async () => {
    const f = fake({ status: 201, json: { sid: 'SM123' } });
    const t = new HttpMessagingTransport('SMS', providerEnv('SMS', env), deps(f), messagingMapping('SMS', env));
    expect(await t.send({ to: '+201001234567', body: 'Your code', reference: 'm1', templateId: 'OTP', locale: 'en' })).toEqual({ ok: true, providerRef: 'SM123' });
    expect(f.calls[0].url).toBe('https://api.twilio.com/2010-04-01/Accounts/ACabc123/Messages.json');
    expect(hdr(f.calls[0], 'content-type')).toBe('application/x-www-form-urlencoded');
    expect(hdr(f.calls[0], 'authorization')).toBe(`Basic ${Buffer.from('ACabc123:authtoken_0123456789abcdef').toString('base64')}`);
    expect(Object.fromEntries(new URLSearchParams(f.calls[0].init.body as string))).toEqual({ To: '+201001234567', Body: 'Your code', From: 'KIOREX', StatusCallback: env.SMS_WEBHOOK_PUBLIC_URL });
    expect(twilioForm({ to: '+20', from: `MG${'a'.repeat(32)}`, body: 'b' }).MessagingServiceSid).toBeDefined();
  });
  it('verifies X-Twilio-Signature (URL + sorted params) and parses callbacks', () => {
    const raw = 'MessageSid=SM123&MessageStatus=delivered&To=%2B201001234567';
    const sig = signTwilio('tok', 'https://x.example.com/cb', raw);
    expect(verifyTwilioSignature('tok', 'https://x.example.com/cb', raw, { 'x-twilio-signature': sig })).toBe(true);
    expect(verifyTwilioSignature('tok', 'https://x.example.com/other', raw, { 'x-twilio-signature': sig })).toBe(false);
    expect(parseTwilioStatus(raw)).toEqual([{ providerRef: 'SM123', status: 'DELIVERED' }]);
    expect(parseTwilioStatus('MessageSid=SM9&MessageStatus=undelivered&ErrorCode=30003')).toEqual([{ providerRef: 'SM9', status: 'FAILED', error: 'TWILIO_30003' }]);
  });
});

describe('Push (FCM HTTP v1 + Expo)', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const sa = JSON.stringify({ project_id: 'kiorex-prod', client_email: 'fcm@kiorex-prod.iam.gserviceaccount.com', private_key: privateKey });
  it('validates configuration without printing secrets', () => {
    expect(pushProblems({})).toHaveLength(1);
    expect(pushProblems({ PUSH_FCM_SERVICE_ACCOUNT_JSON: 'nope' })[0]).toContain('not a valid service-account JSON');
    expect(pushProblems({ PUSH_FCM_SERVICE_ACCOUNT_JSON: Buffer.from(sa).toString('base64') })).toEqual([]);
    expect(pushProblems({ PUSH_EXPO_ENABLED: 'true' })).toEqual([]);
  });
  it('FCM: exchanges a JWT for an OAuth token once, then sends with channel id and stringified data', async () => {
    const f = fake({ json: { access_token: 'ya29.tok', expires_in: 3600 } }, { json: { name: 'projects/kiorex-prod/messages/0:1' } }, { json: { name: 'projects/kiorex-prod/messages/0:2' } });
    const s = new PushSender({ fcmServiceAccountJson: Buffer.from(sa).toString('base64'), androidChannelId: 'kiorex-default' }, f.fn as never);
    const r = await s.send({ token: 'fcm-token-abc', title: 'Hi', body: 'Booking confirmed', data: { bookingId: 'b1', n: 2 } });
    expect(r).toEqual({ ok: true, providerRef: 'projects/kiorex-prod/messages/0:1' });
    await s.send({ token: 'fcm-token-abc', title: 'Hi', body: 'Again' });
    expect(f.calls).toHaveLength(3); // token exchange cached for the second send
    expect(f.calls[0].url).toBe('https://oauth2.googleapis.com/token');
    const assertion = new URLSearchParams(f.calls[0].init.body as string).get('assertion')!;
    expect(JSON.parse(Buffer.from(assertion.split('.')[1], 'base64url').toString())).toMatchObject({ iss: 'fcm@kiorex-prod.iam.gserviceaccount.com', scope: 'https://www.googleapis.com/auth/firebase.messaging' });
    expect(f.calls[1].url).toBe('https://fcm.googleapis.com/v1/projects/kiorex-prod/messages:send');
    expect(hdr(f.calls[1], 'authorization')).toBe('Bearer ya29.tok');
    expect(f.calls[1].body.message).toMatchObject({ token: 'fcm-token-abc', notification: { title: 'Hi', body: 'Booking confirmed' }, data: { bookingId: 'b1', n: '2' }, android: { notification: { channel_id: 'kiorex-default' } } });
  });
  it('FCM: UNREGISTERED marks the token dead; auth failure is a clean error', async () => {
    const dead = fake({ json: { access_token: 't', expires_in: 3600 } }, { status: 404, json: { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } } });
    expect(await new PushSender({ fcmServiceAccountJson: sa }, dead.fn as never).send({ token: 'gone', title: 't', body: 'b' })).toEqual({ ok: false, error: 'FCM_UNREGISTERED', invalidToken: true });
    const bad = fake({ status: 401, json: { error: 'invalid_grant' } });
    expect(await new PushSender({ fcmServiceAccountJson: sa }, bad.fn as never).send({ token: 'x', title: 't', body: 'b' })).toEqual({ ok: false, error: 'FCM_AUTH_401' });
    expect(await new PushSender({}, bad.fn as never).send({ token: 'x', title: 't', body: 'b' })).toEqual({ ok: false, error: 'PUSH_FCM_NOT_CONFIGURED' });
  });
  it('Expo: routes ExponentPushToken to exp.host, reads tickets and DeviceNotRegistered', async () => {
    expect(isExpoToken('ExponentPushToken[abc]')).toBe(true); expect(isExpoToken('fcm:abc')).toBe(false);
    const ok = fake({ json: { data: [{ status: 'ok', id: 'ticket-1' }] } });
    const s = new PushSender({ expoAccessToken: 'expo_secret' }, ok.fn as never);
    expect(await s.send({ token: 'ExponentPushToken[abc]', title: 'T', body: 'B', data: { x: 1 } })).toEqual({ ok: true, providerRef: 'ticket-1' });
    expect(ok.calls[0].url).toBe('https://exp.host/--/api/v2/push/send');
    expect(hdr(ok.calls[0], 'authorization')).toBe('Bearer expo_secret');
    expect(ok.calls[0].body[0]).toMatchObject({ to: 'ExponentPushToken[abc]', title: 'T', body: 'B', channelId: 'default' });
    const nr = fake({ json: { data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }] } });
    expect(await new PushSender({}, nr.fn as never).send({ token: 'ExpoPushToken[zzz]', title: 'T', body: 'B' })).toEqual({ ok: false, error: 'EXPO_DeviceNotRegistered', invalidToken: true });
  });
  it('retries a transient 503 then succeeds', async () => {
    const f = fake({ status: 503, json: {} }, { json: { data: [{ status: 'ok', id: 't' }] } });
    expect((await new PushSender({}, f.fn as never).send({ token: 'ExponentPushToken[a]', title: 'T', body: 'B' })).ok).toBe(true);
    expect(f.calls).toHaveLength(2);
  });
});

describe('Paymob', () => {
  const secret = 'paymob_hmac_secret';
  const obj = { amount_cents: 15000, created_at: '2026-11-23T10:00:00.000000', currency: 'EGP', error_occured: false, has_parent_transaction: false, id: 998877, integration_id: 4321, is_3d_secure: true, is_auth: false, is_capture: false, is_refunded: false, is_standalone_payment: true, is_voided: false, order: { id: 5544, merchant_order_id: 'pay_abc' }, owner: 11, pending: false, source_data: { pan: '2346', sub_type: 'MasterCard', type: 'card' }, success: true };
  it('HMAC-SHA512 over the documented field order (fixed vector)', () => {
    const concat = '150002026-11-23T10:00:00.000000EGPfalsefalse9988774321truefalsefalsefalsetruefalse554411false2346MasterCardcardtrue';
    expect(paymobHmac(secret, obj)).toBe(createHmac('sha512', secret).update(concat).digest('hex'));
    expect(verifyPaymobHmac(secret, obj, paymobHmac(secret, obj))).toBe(true);
    expect(verifyPaymobHmac(secret, { ...obj, amount_cents: 1 }, paymobHmac(secret, obj))).toBe(false);
    expect(verifyPaymobHmac(secret, obj, '')).toBe(false);
  });
  it('maps captured / failed / refund callbacks and ignores pending', () => {
    const body = (o: object) => JSON.stringify({ type: 'TRANSACTION', obj: { ...obj, ...o } });
    expect(parsePaymobCallback(body({}))).toMatchObject({ eventId: 'paymob_998877', type: 'payment.captured', pspRef: '5544', orderRef: '5544', amountMinor: 15000 });
    expect(parsePaymobCallback(body({}))?.paymentId).toBeUndefined(); // merchant_order_id is NOT signed by Paymob: never trusted, the payment is found by the signed order id
    expect(parsePaymobCallback(body({ success: false }))?.type).toBe('payment.failed');
    expect(parsePaymobCallback(body({ is_refunded: true }))).toMatchObject({ type: 'refund.settled', eventId: 'paymob_998877_refund', orderRef: '5544' });
    expect(parsePaymobCallback(body({ pending: true }))).toBeNull();
    expect(parsePaymobCallback('{"type":"TOKEN"}')).toBeNull();
  });
  const env = { PAYMENT_MODE: 'real', PAYMENT_PROVIDER: 'vendor', PAYMENT_ENABLED_PSPS: 'paymob', PAYMOB_SECRET_KEY: 'egy_sk_test_1', PAYMOB_PUBLIC_KEY: 'egy_pk_test_1', PAYMOB_HMAC_SECRET: secret, PAYMOB_INTEGRATION_IDS: '4321,4322', PUBLIC_BASE_URL: 'https://api.kiorex.com' };
  it('creates an intention (secret-key Token auth, special_reference = payment id) and returns the unified checkout URL', async () => {
    const f = fake({ json: { client_secret: 'cs_abc', intention_order_id: 5544 } });
    const out = await new PaymobPspAdapter({ ...env }, f.fn as never).createCheckout({ paymentId: 'pay_abc', amountMinor: 15000, currency: 'EGP' });
    expect(out).toEqual({ pspRef: '5544', checkoutUrl: 'https://accept.paymob.com/unifiedcheckout/?publicKey=egy_pk_test_1&clientSecret=cs_abc' });
    expect(f.calls[0].url).toBe('https://accept.paymob.com/v1/intention/');
    expect(hdr(f.calls[0], 'authorization')).toBe('Token egy_sk_test_1');
    expect(hdr(f.calls[0], 'idempotency-key')).toBe('checkout:pay_abc');
    expect(f.calls[0].body).toMatchObject({ amount: 15000, currency: 'EGP', payment_methods: [4321, 4322], special_reference: 'pay_abc', notification_url: 'http://localhost:4000/api/v1/pay/webhooks/paymob' });
    expect(() => parsePaymobIntention({}, 'x', 'y')).toThrow();
  });
  it('verifies the webhook HMAC from the query string and rejects a forged one', () => {
    const a = new PaymobPspAdapter({ ...env });
    const raw = JSON.stringify({ type: 'TRANSACTION', obj });
    expect(a.verifyWebhook(raw, {}, { hmac: paymobHmac(secret, obj) })?.type).toBe('payment.captured');
    expect(a.verifyWebhook(raw, {}, { hmac: 'f'.repeat(128) })).toBeNull();
    expect(a.verifyWebhook(raw, {}, {})).toBeNull();
  });
  it('refund: looks up the transaction of the order, then refunds it with an idempotency key', async () => {
    const f = fake({ json: { id: 998877 } }, { json: { id: 777 } });
    expect(await new PaymobPspAdapter({ ...env }, f.fn as never).refund({ pspRef: '5544', refundId: 'rf_1', amountMinor: 5000 })).toEqual({ pspRefundRef: '777' });
    expect(f.calls[0].url).toContain('/api/ecommerce/orders/transaction_inquiry');
    expect(f.calls[1].url).toContain('/api/acceptance/void_refund/refund');
    expect(f.calls[1].body).toEqual({ transaction_id: 998877, amount_cents: 5000 });
    expect(hdr(f.calls[1], 'idempotency-key')).toBe('refund:rf_1');
  });
  it('vendor-mode startup validation lists variable names only', () => {
    expect(vendorPspProblems(env)).toEqual([]);
    const p = vendorPspProblems({ PAYMENT_PROVIDER: 'vendor', PAYMENT_ENABLED_PSPS: 'paymob,fawry,instapay', PAYMOB_SECRET_KEY: 'sk_live_supersecret' });
    expect(p.join('|')).toContain('PAYMOB_HMAC_SECRET'); expect(p.join('|')).toContain('FAWRY_SECURE_KEY'); expect(p.join('|')).toContain('INSTAPAY_API_URL');
    expect(p.join('|')).not.toContain('sk_live_supersecret');
  });
});

describe('Fawry', () => {
  const key = 'fawry_secure_key';
  const cb = { requestId: 'r1', fawryRefNumber: '970505', merchantRefNumber: 'pay_abc', paymentAmount: 150, orderAmount: 150, fawryFees: 3.5, orderStatus: 'PAID', paymentMethod: 'PAYATFAWRY', paymentRefrenceNumber: '9988', paymentTime: 1700000000000 };
  it('callback v2 signature: sha256 over the documented fields + secure key', () => {
    const sig = createHash('sha256').update(`970505pay_abc150.00150.00PAIDPAYATFAWRY9988${key}`).digest('hex');
    expect(fawryCallbackSignature(key, cb)).toBe(sig);
    const raw = JSON.stringify({ ...cb, messageSignature: sig });
    expect(parseFawryCallback(verifyFawryCallback(key, raw))).toMatchObject({ eventId: 'fawry_970505_PAID', type: 'payment.captured', pspRef: 'pay_abc', amountMinor: 15000, feeMinor: 350 });
    expect(verifyFawryCallback(key, JSON.stringify({ ...cb, paymentAmount: 1, messageSignature: sig }))).toBeNull();
    expect(verifyFawryCallback('wrong', raw)).toBeNull();
    expect(parseFawryCallback({ ...cb, orderStatus: 'EXPIRED' })?.type).toBe('payment.failed');
    expect(parseFawryCallback({ ...cb, orderStatus: 'REFUNDED' })?.type).toBe('refund.settled');
    expect(parseFawryCallback({ ...cb, orderStatus: 'NEW' })).toBeNull();
  });
  it('builds the signed FawryPay redirect URL (no network call, pspRef = payment id)', () => {
    const o = fawryCheckoutUrl({ apiUrl: 'https://www.atfawry.com', merchantCode: 'MC1', secureKey: key, paymentId: 'pay_abc', amountMinor: 15000, returnUrl: 'https://kiorex.com/r', webhookUrl: 'https://api/x' });
    const req = JSON.parse(decodeURIComponent(o.checkoutUrl.split('chargeRequest=')[1]));
    expect(o.pspRef).toBe('pay_abc');
    expect(req.signature).toBe(createHash('sha256').update(`MC1pay_abc${''}https://kiorex.com/rkiorex-payment1150.00${key}`).digest('hex'));
    expect(req.chargeItems[0].price).toBe('150.00');
  });
  it('refund: status lookup then signed refund call', async () => {
    const f = fake({ json: { fawryRefNumber: '970505' } }, { json: { statusCode: 200 } });
    const a = new FawryPspAdapter({ FAWRY_MERCHANT_CODE: 'MC1', FAWRY_SECURE_KEY: key }, f.fn as never);
    expect(await a.refund({ pspRef: 'pay_abc', refundId: 'rf_1', amountMinor: 5000 })).toEqual({ pspRefundRef: '970505' });
    expect(f.calls[0].url).toContain('/payments/status/v2?merchantCode=MC1&merchantRefNumber=pay_abc&signature=');
    expect(f.calls[1].body).toMatchObject({ merchantCode: 'MC1', referenceNumber: '970505', refundAmount: 50 });
    expect(f.calls[1].body.signature).toBe(createHash('sha256').update(`MC1970505${'50.00'}refund rf_1${key}`).digest('hex'));
  });
});

describe('InstaPay (acquirer gateway contract)', () => {
  it('uses INSTAPAY_* with the neutral signed-webhook contract', async () => {
    const f = fake({ json: { id: 'ip_1', checkoutUrl: 'https://bank.example/pay/ip_1' } });
    const a = new HttpPspAdapter('instapay', undefined, f.fn as never, () => ({ ...providerEnv('PAYMENT', {}), mode: 'real', apiUrl: 'https://gw.bank.example', apiKey: 'k', webhookSecret: 'insta_secret_0123456789' }));
    expect(await a.createCheckout({ paymentId: 'pay_1', amountMinor: 1000, currency: 'EGP' })).toEqual({ pspRef: 'ip_1', checkoutUrl: 'https://bank.example/pay/ip_1' });
    expect(f.calls[0].url).toBe('https://gw.bank.example/checkouts');
  });
});

describe('Video (no vendor: mock | clinic-p2p), Maps (Amazon Location), AI (OpenAI)', () => {
  it('Video: only mock and clinic-p2p exist; the Clinic-owned mode never creates rooms or tokens (no media/vendor in Kiorex)', async () => {
    const p2p = new ClinicP2pVideoAdapter();
    expect(p2p).toMatchObject({ mode: 'clinic-p2p', name: 'clinic-p2p' });
    await expect(p2p.createRoom()).rejects.toThrow('CLINIC_OWNS_CALL');
    await expect(p2p.issueToken()).rejects.toThrow('CLINIC_OWNS_CALL');
    expect((await new MockVideoAdapter().createRoom('s1')).roomName).toBe('kxmock-s1');
    expect(videoAdapter().name).toBe('mock');
  });
  it('Amazon Location: geocodes with an API key, falls back to SigV4 with IAM keys', async () => {
    const f = fake({ json: { ResultItems: [{ Position: [31.2357, 30.0444], PlaceType: 'Locality' }] } });
    const g = await new AmazonMapsAdapter({ MAPS_MODE: 'real', MAPS_API_URL: 'https://places.geo.eu-central-1.amazonaws.com', MAPS_API_KEY: 'v1.public.abc' }, f.fn as never).geocode({ governorate: 'Cairo', district: 'Maadi' });
    expect(g).toEqual({ lat: 30.0444, lng: 31.2357, accuracy: 'DISTRICT', provider: 'amazon-location' });
    expect(f.calls[0].url).toBe('https://places.geo.eu-central-1.amazonaws.com/v2/geocode?key=v1.public.abc');
    expect(f.calls[0].body).toMatchObject({ QueryText: 'Maadi, Cairo', Filter: { IncludeCountries: ['EGY'] } });
    const f2 = fake({ json: { ResultItems: [{ Position: [31, 30], PlaceType: 'PointAddress' }] } });
    await new AmazonMapsAdapter({ MAPS_API_URL: 'https://places.geo.eu-central-1.amazonaws.com', MAPS_ACCESS_KEY_ID: 'AK', MAPS_SECRET_ACCESS_KEY: 'SK' }, f2.fn as never).geocode({ governorate: 'Cairo', district: 'Maadi', street: '9 Road' });
    expect(hdr(f2.calls[0], 'authorization')).toContain('/eu-central-1/geo-places/aws4_request');
    expect(parseAmazonGeocode({ ResultItems: [] })).toBeNull();
  });
  it('OpenAI EU: constrains output to the specialty enum, configurable model, fails closed on HTTP errors', async () => {
    const env = { OPENAI_EU_BASE_URL: 'https://eu.api.openai.com/v1', OPENAI_EU_API_KEY: 'sk-test', OPENAI_EU_MODEL: 'gpt-x' };
    const f = fake({ json: { choices: [{ message: { content: JSON.stringify({ specialties: ['CARDIOLOGY', 'NOT_A_SPECIALTY'] }) } }] } });
    const out = await new OpenAiEuProvider(f.fn as never, env).classify('chest pain');
    expect(out.every((s) => typeof s === 'string')).toBe(true); expect(out).not.toContain('NOT_A_SPECIALTY');
    expect(f.calls[0].url).toBe('https://eu.api.openai.com/v1/chat/completions');
    expect(f.calls[0].body.model).toBe('gpt-x');
    expect(hdr(f.calls[0], 'authorization')).toBe('Bearer sk-test');
    await expect(new OpenAiEuProvider(fake({ status: 500 }).fn as never, env).classify('x')).rejects.toThrow('provider HTTP 500');
    expect(aiProblems({ AI_PROVIDER: 'openai-eu' }).length).toBe(2);
    expect(aiProblems({ AI_PROVIDER: 'fake' })).toEqual([]);
  });
});

describe('startup validation + reported modes', () => {
  it('defaults to all-mock and reports every provider', () => {
    expect(verifyProviderStartup({})).toEqual(['sms=mock', 'email=mock', 'whatsapp=mock', 'push=mock', 'payment=mock', 'video=mock', 'maps=mock', 'ai=mock']);
    expect(providerStatus({}).every((s) => s.ready)).toBe(true);
  });
  it.each([
    [{ PUSH_MODE: 'real' }, 'PUSH_MODE=real needs'], [{ VIDEO_MODE: 'real' }, 'VIDEO_MODE must be mock or clinic-p2p'], [{ MAPS_MODE: 'real' }, 'MAPS_API_URL'], [{ AI_PROVIDER: 'openai-eu' }, 'OPENAI_EU_API_KEY'],
    [{ PAYMENT_MODE: 'real', PAYMENT_PROVIDER: 'vendor' }, 'PAYMOB_SECRET_KEY'], [{ WHATSAPP_MODE: 'real', WHATSAPP_PROVIDER: 'meta' }, 'WHATSAPP_SENDER_ID'],
  ])('MODE=real with missing keys fails fast: %j', (env, needle) => {
    expect(() => verifyProviderStartup(env as Record<string, string>)).toThrow(needle);
  });
  it('reports real mode + vendor + readiness without leaking secrets', () => {
    const env = { PUSH_MODE: 'real', PUSH_EXPO_ENABLED: 'true', WHATSAPP_MODE: 'real', WHATSAPP_PROVIDER: 'meta', WHATSAPP_API_KEY: 'TOPSECRET', WHATSAPP_SENDER_ID: '1', WHATSAPP_WEBHOOK_SECRET: 'x'.repeat(32), WHATSAPP_VERIFY_TOKEN: 'v' };
    const s = providerStatus(env);
    expect(s.find((x) => x.provider === 'whatsapp')).toEqual({ provider: 'whatsapp', mode: 'real', vendor: 'meta', ready: true });
    expect(s.find((x) => x.provider === 'push')).toMatchObject({ mode: 'real', ready: true });
    expect(JSON.stringify(s)).not.toContain('TOPSECRET');
  });
});
