import { fx } from '../../../test/fixtures/messaging/fx';
import {
  classifyMetaError, MetaPayloadError, metaInteractiveButtonsBody, metaInteractiveListBody, metaTemplateBody, metaTemplateSubmission, metaTextBody, parseMetaAccountEvents, parseMetaWebhook,
  sanitizeTemplateParam, signMetaBody, verifyMetaSignature, metaVerifyChallenge,
} from '../../common/providers/vendors/meta-whatsapp';

const PAYLOAD = 'CONFIRM:hold_9f3a:Zk3p9QxT1mN8vB2cD4eF6g';

describe('Meta WhatsApp: interactive messages (assistant CONFIRM rule on the real channel)', () => {
  it('reply buttons carry the exact payload as id and the same id comes back verbatim in the inbound button_reply', () => {
    const out = metaInteractiveButtonsBody({ to: '+201001234567', body: 'تأكيد الحجز مع د. سامبل الساعة 10:30؟', buttons: [{ id: PAYLOAD, title: 'تأكيد' }, { id: 'DECLINE:hold_9f3a:Zk3p9QxT1mN8vB2cD4eF6g', title: 'إلغاء' }] });
    expect(out).toMatchObject({ messaging_product: 'whatsapp', to: '201001234567', type: 'interactive', interactive: { type: 'button', action: { buttons: [{ type: 'reply', reply: { id: PAYLOAD, title: 'تأكيد' } }, { type: 'reply', reply: { id: 'DECLINE:hold_9f3a:Zk3p9QxT1mN8vB2cD4eF6g', title: 'إلغاء' } }] } } });
    const inbound = parseMetaWebhook(JSON.stringify(fx('meta-inbound-button-reply'))).inbound[0];
    expect(inbound.buttonPayload).toBe(PAYLOAD); // the exact bytes, not a prefix, not decoded
    expect(inbound).toMatchObject({ kind: 'interactive', from: '+201001234567', providerRef: 'wamid.IN_BTN_1', contextRef: 'wamid.OUT_CONFIRM_1' });
    expect(inbound.occurredAtMs).toBe(1764036060_000);
  });
  it('refuses (never truncates) a payload that Meta would cut: id over 256, more than 3 buttons, duplicate ids, empty body', () => {
    const b = (id: string) => ({ id, title: 'x' });
    expect(() => metaInteractiveButtonsBody({ to: '+2010', body: 'b', buttons: [b('a'.repeat(257))] })).toThrow(MetaPayloadError);
    expect(() => metaInteractiveButtonsBody({ to: '+2010', body: 'b', buttons: [b('a'), b('b'), b('c'), b('d')] })).toThrow('WA_BUTTON_COUNT');
    expect(() => metaInteractiveButtonsBody({ to: '+2010', body: 'b', buttons: [b('a'), b('a')] })).toThrow('WA_BUTTON_ID_DUPLICATE');
    expect(() => metaInteractiveButtonsBody({ to: '+2010', body: '  ', buttons: [b('a')] })).toThrow('WA_BODY_EMPTY');
    expect(metaInteractiveButtonsBody({ to: '+2010', body: 'b', buttons: [b('a'.repeat(256))] }).interactive.action.buttons[0].reply.id).toHaveLength(256);
  });
  it('button titles longer than 20 characters are cut on character boundaries (Arabic and emoji safe), ids are untouched', () => {
    const t = 'ا'.repeat(30) + '😀';
    const r = metaInteractiveButtonsBody({ to: '+2010', body: 'b', buttons: [{ id: 'X', title: t }] }).interactive.action.buttons[0].reply;
    expect(Array.from(r.title)).toHaveLength(20); expect(r.id).toBe('X');
  });
  it('list message: 10 rows max, row id round-trips as list_reply.id', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: `slot_${i}`, title: `10:${i}0`, description: 'Dr. Sample' }));
    const l = metaInteractiveListBody({ to: '+201001234567', body: 'اختار الميعاد', buttonLabel: 'المواعيد', rows });
    expect(l.interactive.action.sections[0].rows).toHaveLength(10);
    expect(() => metaInteractiveListBody({ to: '+2010', body: 'b', buttonLabel: 'x', rows: [...rows, rows[0]] })).toThrow('WA_LIST_ROW_COUNT');
    expect(parseMetaWebhook(JSON.stringify(fx('meta-inbound-list-reply'))).inbound[0]).toMatchObject({ kind: 'interactive', buttonPayload: 'slot_3', text: '10:30' });
  });
  it('a template quick-reply payload also round-trips exactly in the inbound `button` message', () => {
    const t = metaTemplateBody({ to: '+201001234567', templateName: 'kx_reminder_v1', language: 'ar', bodyParams: ['د. سامبل', '10:30'], quickReplyPayloads: ['CONFIRM:bk_77:abc123', 'DECLINE:bk_77:abc123'] });
    expect(t.template.components).toEqual([
      { type: 'body', parameters: [{ type: 'text', text: 'د. سامبل' }, { type: 'text', text: '10:30' }] },
      { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: 'CONFIRM:bk_77:abc123' }] },
      { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: 'DECLINE:bk_77:abc123' }] },
    ]);
    expect(parseMetaWebhook(JSON.stringify(fx('meta-inbound-quick-reply'))).inbound[0]).toMatchObject({ kind: 'button', buttonPayload: 'CONFIRM:bk_77:abc123' });
  });
  it('session text is JSON-encoded (quotes, newlines and markup cannot alter the structure) and capped at 4096', () => {
    const body = 'a"},"type":"template","x":{"';
    const o = metaTextBody({ to: '+201001234567', body: `${body}\n<script>`.padEnd(5000, 'x') });
    expect(o.type).toBe('text'); expect(o.text.body).toHaveLength(4096); expect(Object.keys(o).sort()).toEqual(['messaging_product', 'recipient_type', 'text', 'to', 'type']);
  });
  it('template parameters: newlines, tabs and 5+ spaces are rewritten (Meta error 132012); empty becomes a dash; recipient is digits only', () => {
    expect(sanitizePushLike('a\nb\tc     d')).toBe('a | b c    d');
    expect(sanitizeTemplateParam('')).toBe('-');
    const t = metaTemplateBody({ to: '+20 100-123/4567;DROP', templateName: 'n', language: 'en', bodyParams: ['x\ny'] });
    expect(t.to).toBe('201001234567'); expect(t.template.components![0]).toEqual({ type: 'body', parameters: [{ type: 'text', text: 'x | y' }] });
  });
});
const sanitizePushLike = sanitizeTemplateParam;

describe('Meta WhatsApp: recorded-shape fixtures', () => {
  const p = (n: string) => parseMetaWebhook(JSON.stringify(fx(n)));
  it('text inbound keeps Arabic text, sender as E.164, provider id and the customer timestamp', () => {
    expect(p('meta-inbound-text').inbound).toEqual([{ from: '+201001234567', kind: 'text', text: 'عايز احجز كشف', providerRef: 'wamid.HBgLMjAxMDAxMjM0NTY3FQIAEhgg', occurredAtMs: 1764036000_000, phoneNumberId: '106540352242922' }]);
  });
  it('media, audio, location and contacts arrive with NO content (assistant rule: fixed reply, never forwarded): no text, no caption, no coordinates, no media id', () => {
    for (const [n, kind] of [['meta-inbound-image', 'media'], ['meta-inbound-audio', 'media'], ['meta-inbound-location', 'location'], ['meta-inbound-contacts', 'contacts']] as const) {
      const [m] = p(n).inbound;
      expect(m.kind).toBe(kind); expect(m.text).toBeUndefined(); expect(m.buttonPayload).toBeUndefined();
      expect(JSON.stringify(m)).not.toMatch(/glucose|30\.0444|MEDIA_ID|Someone|201112223334|Some Street/);
    }
  });
  it('reactions are not conversation turns', () => { expect(p('meta-inbound-reaction').inbound).toEqual([]); });
  it('status lifecycle sent -> delivered -> read with the billing category', () => {
    expect(p('meta-status-lifecycle').statuses).toEqual([
      { providerRef: 'wamid.OUT_1', status: 'SENT', occurredAt: '2025-11-25T02:01:40.000Z', category: 'utility' },
      { providerRef: 'wamid.OUT_1', status: 'DELIVERED', occurredAt: '2025-11-25T02:01:45.000Z', category: 'utility' },
      { providerRef: 'wamid.OUT_1', status: 'READ', occurredAt: '2025-11-25T02:03:20.000Z' },
    ]);
  });
  it('failed status keeps the numeric code only (never Meta\'s text) and classifies it', () => {
    const [s] = p('meta-status-failed-131047').statuses;
    expect(s).toMatchObject({ status: 'FAILED', error: 'META_131047', errorCode: 131047 }); expect(JSON.stringify(s)).not.toContain('Re-engagement');
    expect(classifyMetaError(131047)).toBe('NEED_TEMPLATE'); expect(classifyMetaError(131026)).toBe('INVALID_RECIPIENT'); expect(classifyMetaError(130429)).toBe('THROTTLE'); expect(classifyMetaError(131056)).toBe('THROTTLE');
    expect(classifyMetaError(132001)).toBe('TEMPLATE'); expect(classifyMetaError(190)).toBe('AUTH'); expect(classifyMetaError(131000)).toBe('RETRY'); expect(classifyMetaError(999999)).toBe('UNKNOWN'); expect(classifyMetaError(undefined)).toBe('UNKNOWN');
  });
  it('account events: template review, template quality, phone-number quality / tier and account updates', () => {
    const ev = (n: string) => parseMetaAccountEvents(JSON.stringify(fx(n)));
    expect(ev('meta-template-status-approved')).toEqual([{ type: 'TEMPLATE_STATUS', templateId: '1689556908129', name: 'kx_booking_confirmed_v1', language: 'ar', event: 'APPROVED' }]);
    expect(ev('meta-template-status-rejected')).toEqual([{ type: 'TEMPLATE_STATUS', templateId: '1689556908130', name: 'kx_review_invitation_v1', language: 'en', event: 'REJECTED', reason: 'INVALID_FORMAT' }]);
    expect(ev('meta-template-quality')).toEqual([{ type: 'TEMPLATE_QUALITY', templateId: '1689556908129', name: 'kx_booking_confirmed_v1', language: 'ar', quality: 'YELLOW' }]);
    expect(ev('meta-phone-quality-downgrade')).toEqual([{ type: 'PHONE_QUALITY', event: 'DOWNGRADE', tier: 'TIER_1K' }]);
    expect(ev('meta-account-update')).toEqual([{ type: 'ACCOUNT', event: 'DISABLED_UPDATE' }]);
    expect(ev('meta-inbound-text')).toEqual([]); expect(parseMetaAccountEvents('not json')).toEqual([]);
  });
  it('malformed and foreign payloads are ignored, never thrown', () => {
    expect(parseMetaWebhook('{}')).toEqual({ statuses: [], inbound: [] });
    expect(parseMetaWebhook(JSON.stringify({ object: 'page', entry: [] }))).toEqual({ statuses: [], inbound: [] });
    expect(parseMetaWebhook(JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { messages: [{ type: 'text' }] } }] }] }))).toEqual({ statuses: [], inbound: [] });
  });
});

describe('Meta WhatsApp: webhook signature and handshake vectors', () => {
  const secret = 'app_secret_0123456789ab'; const body = '{"object":"whatsapp_business_account","entry":[]}';
  // independent vector: printf '%s' "$body" | openssl dgst -sha256 -hmac "$secret"
  const hex = '97cd12ba13e0e980e183ec9be50e26be2242e57f5cd9d402449a30b82e80c0db';
  it('accepts the openssl vector and rejects every tampering', () => {
    expect(signMetaBody(secret, body)).toBe(`sha256=${hex}`);
    expect(verifyMetaSignature(secret, body, { 'x-hub-signature-256': `sha256=${hex}` })).toBe(true);
    expect(verifyMetaSignature(secret, body + ' ', { 'x-hub-signature-256': `sha256=${hex}` })).toBe(false);
    expect(verifyMetaSignature(secret, body, { 'x-hub-signature-256': `sha1=${hex}` })).toBe(false);
    expect(verifyMetaSignature(secret, body, { 'x-hub-signature-256': `sha256=${hex.slice(0, -1)}0` })).toBe(false);
    expect(verifyMetaSignature(secret, body, { 'x-hub-signature-256': `sha256=${hex.slice(0, 10)}` })).toBe(false);
    expect(verifyMetaSignature('', body, { 'x-hub-signature-256': `sha256=${hex}` })).toBe(false);
    expect(verifyMetaSignature('other_secret_0123456789', body, { 'x-hub-signature-256': `sha256=${hex}` })).toBe(false);
    expect(verifyMetaSignature(secret, body, {})).toBe(false);
  });
  it('hub.challenge: echoes only for subscribe + the right token', () => {
    expect(metaVerifyChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': 'tok', 'hub.challenge': '1158201444' }, 'tok')).toBe('1158201444');
    expect(metaVerifyChallenge({ 'hub.mode': 'unsubscribe', 'hub.verify_token': 'tok', 'hub.challenge': '1' }, 'tok')).toBeNull();
    expect(metaVerifyChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': 'tok', 'hub.challenge': '1' }, '')).toBeNull();
    expect(metaVerifyChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': 'tok' }, 'tok')).toBeNull();
  });
});

describe('Meta template submission export', () => {
  it('utility body with numbered examples; authentication uses the OTP structure', () => {
    expect(metaTemplateSubmission({ name: 'kx_a_v1', language: 'en', category: 'UTILITY', body: 'Visit with {{1}} at {{2}}.', examples: ['Dr. Sample', '10:30'], quickReplies: ['Confirm', 'Cancel'] })).toEqual({
      name: 'kx_a_v1', language: 'en', category: 'UTILITY', components: [{ type: 'BODY', text: 'Visit with {{1}} at {{2}}.', example: { body_text: [['Dr. Sample', '10:30']] } }, { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Confirm' }, { type: 'QUICK_REPLY', text: 'Cancel' }] }],
    });
    expect(metaTemplateSubmission({ name: 'kx_otp_v1', language: 'ar', category: 'AUTHENTICATION', body: '', examples: [] }).components[1]).toMatchObject({ type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE' }] });
  });
});
