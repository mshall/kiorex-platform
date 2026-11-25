import { createHmac, createSign, generateKeyPairSync } from 'node:crypto';
import { fx, fxText } from '../../../../test/fixtures/messaging/fx';
import { listUnsubscribeHeaders, parseSesEvents, sesSendBody, snsCertUrlOk, snsConfirmUrl, snsStringToSign, verifySnsBasicAuth, verifySnsSignature } from './ses';
import { aggregatorBuildSend, aggregatorParseDlr, aggregatorParseSend, aggregatorVerifyDlr, formatMobile, isArabicText, smsSegments, type AggregatorConfig } from './sms-aggregator';
import { parseTwilioStatus, signTwilio, verifyTwilioSignature } from './twilio-sms';
import { checkEmailDomain, parseDmarc, parseSpf } from '../../../messaging/email-domain-auth';
import { signUnsubscribeToken, verifyUnsubscribeToken } from '../../../messaging/unsubscribe';

const raw = (n: string) => JSON.stringify(fx(n));

describe('SES over SNS: recorded-shape fixtures', () => {
  it('send / delivery / reject map to statuses with the SES message id as provider reference', () => {
    expect(parseSesEvents(raw('ses-send'))).toEqual([{ providerRef: '0100019aaa111111-ses-1', status: 'SENT', occurredAt: '2026-11-25T08:00:00.000Z' }]);
    expect(parseSesEvents(raw('ses-delivery'))).toEqual([{ providerRef: '0100019aaa111111-ses-1', status: 'DELIVERED', occurredAt: '2026-11-25T08:00:03.000Z' }]);
    expect(parseSesEvents(raw('ses-reject'))[0]).toMatchObject({ status: 'FAILED', error: 'SES_REJECT' });
  });
  it('PERMANENT bounce and any complaint suppress the address (lower-cased); a TRANSIENT bounce fails the message but never suppresses', () => {
    expect(parseSesEvents(raw('ses-bounce-permanent'))).toEqual([{ providerRef: '0100019aaa111111-ses-1', status: 'FAILED', error: 'SES_BOUNCE_PERMANENT', occurredAt: '2026-11-25T08:00:04.000Z', suppress: [{ address: 'gone.user@example.com', reason: 'BOUNCE' }] }]);
    const t = parseSesEvents(raw('ses-bounce-transient'))[0]; expect(t).toMatchObject({ status: 'FAILED', error: 'SES_BOUNCE_TRANSIENT' }); expect(t.suppress).toBeUndefined();
    expect(parseSesEvents(raw('ses-complaint'))[0]).toMatchObject({ status: 'FAILED', error: 'SES_COMPLAINT', suppress: [{ address: 'angry@example.com', reason: 'COMPLAINT' }] });
  });
  it('subscription confirmation is followed only on an https sns.<region>.amazonaws.com host; junk is ignored', () => {
    expect(snsConfirmUrl(raw('ses-subscription-confirmation'))).toContain('https://sns.eu-central-1.amazonaws.com/?Action=ConfirmSubscription');
    expect(snsConfirmUrl(JSON.stringify({ ...fx('ses-subscription-confirmation'), SubscribeURL: 'https://evil.example.com/?Action=ConfirmSubscription' }))).toBeNull();
    expect(snsConfirmUrl(JSON.stringify({ ...fx('ses-subscription-confirmation'), SubscribeURL: 'http://sns.eu-central-1.amazonaws.com/x' }))).toBeNull();
    expect(parseSesEvents('nope')).toEqual([]); expect(parseSesEvents(JSON.stringify({ Type: 'Notification', Message: 'not json' }))).toEqual([]);
  });
  it('basic-auth password check (the SNS HTTPS subscription credentials)', () => {
    const h = (pw: string) => ({ authorization: `Basic ${Buffer.from(`sns:${pw}`).toString('base64')}` });
    expect(verifySnsBasicAuth('s3cret_s3cret_0123', h('s3cret_s3cret_0123'))).toBe(true); expect(verifySnsBasicAuth('s3cret_s3cret_0123', h('wrong'))).toBe(false);
    expect(verifySnsBasicAuth('', h(''))).toBe(false); expect(verifySnsBasicAuth('x', {})).toBe(false);
  });
});

describe('SNS message signature (SignatureVersion 1 and 2)', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const sign = (msg: Record<string, any>, v: '1' | '2') => { const sts = snsStringToSign(msg)!; return createSign(v === '2' ? 'RSA-SHA256' : 'RSA-SHA1').update(sts, 'utf8').sign(privateKey).toString('base64'); };
  const base = (): Record<string, any> => ({ ...fx('ses-delivery'), SignatureVersion: '1' });
  const keyFor = async () => publicKey;
  it('verifies a correctly signed notification (v1 and v2), rejects tampering, a foreign topic, a foreign cert host and an unknown version', async () => {
    for (const v of ['1', '2'] as const) {
      const m = { ...base(), SignatureVersion: v }; m.Signature = sign(m, v);
      expect(await verifySnsSignature(JSON.stringify(m), keyFor)).toBe(true);
      expect(await verifySnsSignature(JSON.stringify({ ...m, Message: m.Message + ' ' }), keyFor)).toBe(false);
      expect(await verifySnsSignature(JSON.stringify(m), keyFor, ['arn:aws:sns:eu-central-1:111122223333:other'])).toBe(false);
      expect(await verifySnsSignature(JSON.stringify(m), keyFor, [m.TopicArn])).toBe(true);
      expect(await verifySnsSignature(JSON.stringify({ ...m, SigningCertURL: 'https://evil.example.com/cert.pem' }), keyFor)).toBe(false);
    }
    const m = base(); m.Signature = sign(m, '1');
    expect(await verifySnsSignature(JSON.stringify({ ...m, SignatureVersion: '9' }), keyFor)).toBe(false);
    expect(await verifySnsSignature(JSON.stringify({ ...m, Signature: undefined }), keyFor)).toBe(false);
    expect(await verifySnsSignature('nope', keyFor)).toBe(false);
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey;
    expect(await verifySnsSignature(JSON.stringify(m), async () => other)).toBe(false);
  });
  it('certificate URL must be https on sns.<region>.amazonaws.com and a .pem', () => {
    expect(snsCertUrlOk('https://sns.eu-central-1.amazonaws.com/SimpleNotificationService-abc.pem')).toBe(true);
    for (const u of ['http://sns.eu-central-1.amazonaws.com/a.pem', 'https://sns.eu-central-1.amazonaws.com.evil.com/a.pem', 'https://evil.com/sns.eu-central-1.amazonaws.com/a.pem', 'https://sns.eu-central-1.amazonaws.com/a.txt', 'nope']) expect(snsCertUrlOk(u)).toBe(false);
  });
});

describe('List-Unsubscribe (RFC 2369 / 8058) on marketing e-mail', () => {
  it('mailto + https + one-click post header; absent inputs add nothing', () => {
    expect(listUnsubscribeHeaders({ url: 'https://api.kiorex.com/api/v1/messaging/unsubscribe/u1.x.y', mailto: 'unsubscribe@kiorex.com' })).toEqual([
      { Name: 'List-Unsubscribe', Value: '<mailto:unsubscribe@kiorex.com>, <https://api.kiorex.com/api/v1/messaging/unsubscribe/u1.x.y>' }, { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' }]);
    expect(listUnsubscribeHeaders({})).toEqual([]);
    const b = sesSendBody({ from: 'K <a@kiorex.com>', to: 'p@example.com', subject: 's', text: 't', headers: listUnsubscribeHeaders({ url: 'https://x.example/u' }) });
    expect(b.Content.Simple.Headers).toHaveLength(2);
    expect(sesSendBody({ from: 'a', to: 'b', subject: 's', text: 't' }).Content.Simple).not.toHaveProperty('Headers');
  });
  it('unsubscribe token: signed, expiring, tamper-proof, carries only the keyed hash of the address', () => {
    const t = signUnsubscribeToken({ address: 'Patient@Example.com', sub: 'sub1' }, 1_000_000);
    const c = verifyUnsubscribeToken(t, 2_000_000)!;
    expect(c).toMatchObject({ market: 'EG', sub: 'sub1' }); expect(JSON.stringify(c)).not.toMatch(/patient|example/i);
    expect(signUnsubscribeToken({ address: ' patient@example.com ' }, 1_000_000)).not.toBe(''); expect(verifyUnsubscribeToken(signUnsubscribeToken({ address: 'patient@example.com' }, 1_000_000), 2_000_000)!.ah).toBe(c.ah);
    expect(verifyUnsubscribeToken(t, 1_000_000 + 181 * 86_400_000)).toBeNull();
    const parts = t.split('.'); expect(verifyUnsubscribeToken(`${parts[0]}.${parts[1]}.${parts[2].slice(0, -2)}xx`, 2_000_000)).toBeNull();
    expect(verifyUnsubscribeToken(`u1.${Buffer.from(JSON.stringify({ ah: 'x', market: 'EG', exp: 9e15 })).toString('base64url')}.${parts[2]}`, 2_000_000)).toBeNull();
    expect(verifyUnsubscribeToken('garbage', 1)).toBeNull();
  });
});

describe('SPF / DKIM / DMARC checklist (injected DNS)', () => {
  const dns = (txt: Record<string, string[]>, cname: Record<string, string[]> = {}) => ({ txt: async (n: string) => txt[n] ?? [], cname: async (n: string) => cname[n] ?? [] });
  it('passes a fully configured domain and says exactly what is wrong otherwise', async () => {
    const good = await checkEmailDomain('kiorex.com', dns({ 'kiorex.com': ['v=spf1 include:amazonses.com ~all'], '_dmarc.kiorex.com': ['v=DMARC1; p=none; rua=mailto:dmarc@kiorex.com'] }, { 'tok1._domainkey.kiorex.com': ['tok1.dkim.amazonses.com.'] }), { dkimTokens: ['tok1'] });
    expect(good.every((c) => c.ok)).toBe(true);
    const badR = await checkEmailDomain('kiorex.com', dns({ 'kiorex.com': ['v=spf1 include:_spf.google.com +all'], '_dmarc.kiorex.com': ['v=DMARC1; p=reject'] }, { 'tok1._domainkey.kiorex.com': ['other.example.com'] }), { dkimTokens: ['tok1'] });
    expect(badR.map((c) => c.ok)).toEqual([false, false, false]);
    expect(badR[0].detail).toContain('missing include:amazonses.com'); expect(badR[1].detail).toContain('no rua='); expect(badR[2].detail).toContain('CNAME points to other.example.com');
    expect((await checkEmailDomain('kiorex.com', dns({}))).map((c) => c.ok)).toEqual([false, false, false]);
    expect(parseDmarc(['v=DMARC1; p=quarantine; pct=50; rua=mailto:a@b.c'])).toEqual({ present: true, policy: 'quarantine', rua: 'mailto:a@b.c', pct: 50 });
    expect(parseSpf(['v=spf1 include:a include:b mx -all'])).toMatchObject({ includes: ['a', 'b'], all: '-all', lookups: 3 });
  });
});

describe('Twilio status callback', () => {
  it('delivered and undelivered fixtures; signature vector computed independently with openssl', () => {
    expect(parseTwilioStatus(fxText('twilio-status-delivered'))).toEqual([{ providerRef: 'SM123', status: 'DELIVERED' }]);
    expect(parseTwilioStatus(fxText('twilio-status-undelivered'))).toEqual([{ providerRef: 'SM124', status: 'FAILED', error: 'TWILIO_30006' }]);
    const url = 'https://api.kiorex.test/api/v1/messaging/webhooks/sms'; const body = 'MessageSid=SM123&MessageStatus=delivered';
    // printf '%s' 'https://api.kiorex.test/api/v1/messaging/webhooks/smsMessageSidSM123MessageStatusdelivered' | openssl dgst -sha1 -hmac 'twilio_auth_token_0123' -binary | base64
    expect(signTwilio('twilio_auth_token_0123', url, body)).toBe('5Yh4bjxqd6HAO59vPrGJFq1jNVM=');
    expect(verifyTwilioSignature('twilio_auth_token_0123', url, body, { 'x-twilio-signature': '5Yh4bjxqd6HAO59vPrGJFq1jNVM=' })).toBe(true);
    expect(verifyTwilioSignature('twilio_auth_token_0123', url, body + '&x=1', { 'x-twilio-signature': '5Yh4bjxqd6HAO59vPrGJFq1jNVM=' })).toBe(false);
    expect(verifyTwilioSignature('twilio_auth_token_0123', url + '/', body, { 'x-twilio-signature': '5Yh4bjxqd6HAO59vPrGJFq1jNVM=' })).toBe(false);
  });
});

describe('Egyptian SMS aggregator (data-described wire format)', () => {
  // Shape A: credentials in the form body, Unicode switch, numeric success code, our DLR token in the query string
  const A: AggregatorConfig = { path: '/api/SMS/', encoding: 'form', auth: 'body', fields: { to: 'mobile', from: 'sender', text: 'message', reference: 'ref', callback: 'dlr' }, fixed: { environment: '1' }, toFormat: 'intl', unicode: { arabic: '2', latin: '1' }, response: { idPath: 'SMSID', okPath: 'code', okValues: ['1901'] }, dlr: { idField: 'SMSID', statusField: 'Status', statusMap: { delivered: 'DELIVERED' }, verify: 'token', tokenName: 'token' } };
  // Shape B: bearer token, JSON, our own message id is the vendor id, HMAC-signed JSON reports
  const B: AggregatorConfig = { path: '/v1/send', encoding: 'json', auth: 'bearer', toFormat: 'e164', response: { idFromReference: true, okPath: 'status', okValues: ['queued'] }, dlr: { idField: 'smsId', statusField: 'state', errorField: 'err', statusMap: { delivrd: 'DELIVERED', undeliv: 'FAILED' }, verify: 'hmac', hmacHeader: 'x-agg-signature' } };
  it('A: builds a form request with credentials, sender, intl number, Unicode flag for Arabic only', () => {
    const w = aggregatorBuildSend(A, { to: '+201001234567', from: 'Kiorex', text: 'كودك 123456', reference: 'msg_1', apiKey: 'user1:pass1', callback: 'https://api.kiorex.test/api/v1/messaging/webhooks/sms?token=t' });
    expect(w).toEqual({ path: '/api/SMS/', headers: {}, form: { environment: '1', mobile: '201001234567', sender: 'Kiorex', message: 'كودك 123456', ref: 'msg_1', dlr: 'https://api.kiorex.test/api/v1/messaging/webhooks/sms?token=t', language: '2', username: 'user1', password: 'pass1' } });
    expect(aggregatorBuildSend(A, { to: '+201001234567', from: 'K', text: 'Your code 1', reference: 'r', apiKey: 'u:p' }).form!.language).toBe('1');
    expect(aggregatorParseSend(A, { code: '1901', SMSID: 88123 }, 'msg_1')).toEqual({ providerRef: '88123' });
    expect(() => aggregatorParseSend(A, { code: '1902', SMSID: 1 }, 'm')).toThrow(); expect(() => aggregatorParseSend(A, { code: '1901' }, 'm')).toThrow();
  });
  it('A: DLR callback (form) maps statuses; unknown words are dropped; the token must match', () => {
    expect(aggregatorParseDlr(A, fxText('aggregator-a-dlr'))).toEqual([{ providerRef: '88123', status: 'DELIVERED' }]);
    expect(aggregatorParseDlr(A, 'SMSID=1&Status=martian')).toEqual([]);
    expect(aggregatorVerifyDlr(A, 'dlr_secret_0123456789', '', {}, { token: 'dlr_secret_0123456789' })).toBe(true);
    expect(aggregatorVerifyDlr(A, 'dlr_secret_0123456789', '', {}, { token: 'nope' })).toBe(false); expect(aggregatorVerifyDlr(A, 'dlr_secret_0123456789', '', {}, {})).toBe(false); expect(aggregatorVerifyDlr(A, '', '', {}, { token: '' })).toBe(false);
  });
  it('B: bearer JSON, e164, own id as reference; JSON DLR with HMAC (openssl vector) and failure reasons', () => {
    const w = aggregatorBuildSend(B, { to: '+201001234567', from: 'Kiorex', text: 'x', reference: 'msg_9', apiKey: 'tok_abc' });
    expect(w).toEqual({ path: '/v1/send', headers: { authorization: 'Bearer tok_abc' }, body: { to: '+201001234567', from: 'Kiorex', text: 'x', reference: 'msg_9' } });
    expect(aggregatorParseSend(B, { status: 'queued' }, 'msg_9')).toEqual({ providerRef: 'msg_9' });
    expect(aggregatorParseDlr(B, JSON.stringify(fx('aggregator-b-dlr')))).toEqual([{ providerRef: 'msg_ref_1', status: 'FAILED', error: 'SMS_ABSENT_SUBSCRIBER' }, { providerRef: 'msg_ref_2', status: 'DELIVERED' }]);
    const body = '1700000000.{"events":[]}'; // printf '%s' '1700000000.{"events":[]}' | openssl dgst -sha256 -hmac agg_dlr_secret_0123456789
    const sig = 'cc1f228a21606c11efddcd099c1b419aeebfddfa635f8db0307d38a2dfd5464c';
    expect(createHmac('sha256', 'agg_dlr_secret_0123456789').update(body).digest('hex')).toBe(sig);
    expect(aggregatorVerifyDlr(B, 'agg_dlr_secret_0123456789', body, { 'x-agg-signature': `sha256=${sig}` })).toBe(true); expect(aggregatorVerifyDlr(B, 'agg_dlr_secret_0123456789', body + 'x', { 'x-agg-signature': sig })).toBe(false);
  });
  it('number formats, Arabic detection and segment counting (cost guard)', () => {
    expect(formatMobile('+20 100 123 4567', 'intl')).toBe('201001234567'); expect(formatMobile('+201001234567', 'local')).toBe('01001234567'); expect(formatMobile('+966501234567', 'local')).toBe('+966501234567'); expect(formatMobile('201001234567', 'e164')).toBe('+201001234567');
    expect(isArabicText('كود')).toBe(true); expect(isArabicText('code')).toBe(false);
    expect(smsSegments('a'.repeat(160))).toEqual({ encoding: 'GSM7', segments: 1, length: 160 }); expect(smsSegments('a'.repeat(161)).segments).toBe(2);
    expect(smsSegments('ا'.repeat(70))).toMatchObject({ encoding: 'UCS2', segments: 1 }); expect(smsSegments('ا'.repeat(71)).segments).toBe(2); expect(smsSegments('ا'.repeat(135)).segments).toBe(3);
  });
});
