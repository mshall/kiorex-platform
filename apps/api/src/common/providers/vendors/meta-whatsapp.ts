import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Meta WhatsApp Business Cloud API (Graph API). Pure wire-format helpers, no I/O.
 *   send:    POST {WHATSAPP_API_URL = https://graph.facebook.com/v21.0}/{phone-number-id}/messages   Authorization: Bearer <system-user token>
 *            business-initiated messages MUST be approved templates (type=template); free text only inside the 24 h customer-service window.
 *   webhook: GET  ?hub.mode=subscribe&hub.verify_token=<WHATSAPP_VERIFY_TOKEN>&hub.challenge=<n>  -> echo the challenge
 *            POST X-Hub-Signature-256: sha256=HMAC-SHA256(<app secret>, raw body); body entry[].changes[].value.{statuses[],messages[]}
 */
export interface MetaStatus { providerRef: string; status: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'; error?: string; occurredAt?: string; /** numeric Meta error code of a failed status (e.g. 131047), no text */ errorCode?: number; /** conversation / pricing category (marketing | utility | authentication | service | referral_conversion), for cost reporting only */ category?: string }
export type MetaInboundKind = 'text' | 'button' | 'interactive' | 'media' | 'location' | 'contacts' | 'reaction' | 'system' | 'unsupported' | 'other';
/**
 * One inbound customer message. Media, location and contacts carry NO content (no id, url, caption, coordinates): the assistant rules say they are
 * answered with a fixed text and never forwarded, so the parser drops them at the edge. Reactions and system messages are not conversation turns.
 */
export interface MetaInbound { from: string; text?: string; buttonPayload?: string; providerRef?: string; kind?: MetaInboundKind; /** epoch ms from Meta's `timestamp` (seconds) */ occurredAtMs?: number; /** wamid of the message this replies to (button taps) */ contextRef?: string; phoneNumberId?: string }
/** Account-level events carried by the same webhook (template review, quality rating / messaging tier, account alerts). */
export type MetaAccountEvent =
  | { type: 'TEMPLATE_STATUS'; templateId: string; name: string; language: string; event: string; reason?: string }
  | { type: 'TEMPLATE_QUALITY'; templateId: string; name: string; language: string; quality: string }
  | { type: 'PHONE_QUALITY'; event: string; tier?: string }
  | { type: 'ACCOUNT'; event: string };

export const metaPhone = (e164: string) => e164.replace(/^\+/, '').replace(/[^\d]/g, '');

/**
 * Meta rejects a template parameter that contains a newline, a tab or more than four consecutive spaces (error 132012), and the value must be non-empty.
 * Newlines become " | " so a multi-line rendered body still sends; the text is otherwise untouched (no PHI is added or removed here).
 */
export function sanitizeTemplateParam(v: string): string {
  const t = String(v ?? '').replace(/[\r\n]+/g, ' | ').replace(/\t/g, ' ').replace(/ {5,}/g, '    ').trim();
  return (t || '-').slice(0, 1024);
}

export function metaTemplateBody(i: { to: string; templateName: string; language: string; bodyParams: string[]; urlButtonParam?: string; /** payloads of QUICK_REPLY buttons by index (they round-trip exactly in the inbound `button.payload`) */ quickReplyPayloads?: string[] }) {
  const components: unknown[] = [];
  if (i.bodyParams.length) components.push({ type: 'body', parameters: i.bodyParams.map((text) => ({ type: 'text', text: sanitizeTemplateParam(text) })) });
  if (i.urlButtonParam) components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: i.urlButtonParam }] }); // OTP "copy code" button
  (i.quickReplyPayloads ?? []).forEach((payload, index) => components.push({ type: 'button', sub_type: 'quick_reply', index: String(index), parameters: [{ type: 'payload', payload }] }));
  return { messaging_product: 'whatsapp', recipient_type: 'individual', to: metaPhone(i.to), type: 'template', template: { name: i.templateName, language: { code: i.language }, ...(components.length ? { components } : {}) } };
}

export function parseMetaSend(json: any): { providerRef: string } {
  const id = json?.messages?.[0]?.id;
  if (typeof id !== 'string' || !id) throw new Error('no message id in Meta response');
  return { providerRef: id };
}

const eq = (a: string, b: string) => { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const h = (headers: Record<string, unknown>, n: string) => { const v = headers[n]; return Array.isArray(v) ? String(v[0] ?? '') : String(v ?? ''); };

export function verifyMetaSignature(appSecret: string, rawBody: string, headers: Record<string, unknown>): boolean {
  if (!appSecret) return false;
  const sig = h(headers, 'x-hub-signature-256');
  if (!sig.startsWith('sha256=')) return false;
  return eq(sig, `sha256=${createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')}`);
}
export const signMetaBody = (appSecret: string, rawBody: string) => `sha256=${createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')}`;

/** Returns the challenge to echo, or null when the token / mode is wrong. */
export function metaVerifyChallenge(q: Record<string, unknown>, verifyToken: string): string | null {
  if (!verifyToken || q['hub.mode'] !== 'subscribe' || q['hub.verify_token'] !== verifyToken || q['hub.challenge'] === undefined) return null;
  return String(q['hub.challenge']);
}

/** Plain session text (valid only inside the 24 h customer-service window). */
export function metaTextBody(i: { to: string; body: string; replyToWamid?: string }) {
  return { messaging_product: 'whatsapp', recipient_type: 'individual', to: metaPhone(i.to), type: 'text', text: { preview_url: false, body: i.body.slice(0, 4096) }, ...(i.replyToWamid ? { context: { message_id: i.replyToWamid } } : {}) };
}

/** Meta limits (Cloud API interactive messages). Violations are refused BEFORE the call so a button payload can never be silently truncated. */
export const META_LIMITS = { buttons: 3, buttonTitle: 20, buttonId: 256, body: 1024, header: 60, footer: 60, listRows: 10, listRowTitle: 24, listRowDescription: 72, listRowId: 200, listButton: 20, listSectionTitle: 24 } as const;
export interface InteractiveButton { id: string; title: string }
export interface InteractiveRow { id: string; title: string; description?: string }
export class MetaPayloadError extends Error { constructor(public readonly code: string) { super(code); this.name = 'MetaPayloadError'; } }

/**
 * Interactive REPLY BUTTONS (max 3). The button `id` is the payload that comes back verbatim as `interactive.button_reply.id`
 * (this is what the assistant's `CONFIRM:<id>:<nonce>` rule relies on): it is never altered, truncated or re-encoded; too long means an error, not a cut.
 */
export function metaInteractiveButtonsBody(i: { to: string; body: string; buttons: InteractiveButton[]; header?: string; footer?: string }) {
  if (!i.buttons.length || i.buttons.length > META_LIMITS.buttons) throw new MetaPayloadError('WA_BUTTON_COUNT');
  const ids = new Set<string>();
  for (const b of i.buttons) {
    if (!b.id || b.id.length > META_LIMITS.buttonId) throw new MetaPayloadError('WA_BUTTON_ID_TOO_LONG');
    if (ids.has(b.id)) throw new MetaPayloadError('WA_BUTTON_ID_DUPLICATE');
    ids.add(b.id);
    if (!b.title.trim()) throw new MetaPayloadError('WA_BUTTON_TITLE_EMPTY');
  }
  if (!i.body.trim()) throw new MetaPayloadError('WA_BODY_EMPTY');
  return {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: metaPhone(i.to), type: 'interactive',
    interactive: {
      type: 'button',
      ...(i.header ? { header: { type: 'text', text: i.header.slice(0, META_LIMITS.header) } } : {}),
      body: { text: i.body.slice(0, META_LIMITS.body) },
      ...(i.footer ? { footer: { text: i.footer.slice(0, META_LIMITS.footer) } } : {}),
      action: { buttons: i.buttons.map((b) => ({ type: 'reply', reply: { id: b.id, title: Array.from(b.title).slice(0, META_LIMITS.buttonTitle).join('') } })) },
    },
  };
}

/** Interactive LIST (max 10 rows in total, one section is enough). Row id is the payload that returns as `interactive.list_reply.id`. */
export function metaInteractiveListBody(i: { to: string; body: string; buttonLabel: string; rows: InteractiveRow[]; sectionTitle?: string; footer?: string }) {
  if (!i.rows.length || i.rows.length > META_LIMITS.listRows) throw new MetaPayloadError('WA_LIST_ROW_COUNT');
  for (const r of i.rows) if (!r.id || r.id.length > META_LIMITS.listRowId) throw new MetaPayloadError('WA_LIST_ROW_ID_TOO_LONG');
  const cut = (s: string, n: number) => Array.from(s).slice(0, n).join('');
  return {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: metaPhone(i.to), type: 'interactive',
    interactive: {
      type: 'list', body: { text: i.body.slice(0, META_LIMITS.body) }, ...(i.footer ? { footer: { text: i.footer.slice(0, META_LIMITS.footer) } } : {}),
      action: { button: cut(i.buttonLabel, META_LIMITS.listButton), sections: [{ title: cut(i.sectionTitle ?? '-', META_LIMITS.listSectionTitle), rows: i.rows.map((r) => ({ id: r.id, title: cut(r.title, META_LIMITS.listRowTitle), ...(r.description ? { description: cut(r.description, META_LIMITS.listRowDescription) } : {}) })) }] },
    },
  };
}

/** Marks an inbound message as read (blue ticks). */
export const metaMarkReadBody = (wamid: string) => ({ messaging_product: 'whatsapp', status: 'read', message_id: wamid });

/**
 * Meta error codes (Graph `error.code` on a send, or `statuses[].errors[].code` on a failed status) grouped by what the platform does about them.
 * THROTTLE: back the channel off (tier / pair / spam rate limit); NEED_TEMPLATE: outside the 24 h window, a template is required; TEMPLATE: the template is
 * missing, unapproved, paused or its parameters do not match; INVALID_RECIPIENT: never retry this number; AUTH: stop the channel and alert ops; RETRY: transient.
 * Hand-maintained from Meta's "error codes" page: VERIFY at go-live against the current list.
 */
export type MetaErrorAction = 'THROTTLE' | 'NEED_TEMPLATE' | 'TEMPLATE' | 'INVALID_RECIPIENT' | 'AUTH' | 'RETRY' | 'PAYLOAD' | 'UNKNOWN';
export const META_ERROR_ACTIONS: Record<number, MetaErrorAction> = {
  0: 'AUTH', 190: 'AUTH', 10: 'AUTH', 200: 'AUTH', 368: 'AUTH', 131031: 'AUTH', 131005: 'AUTH', 133010: 'AUTH',
  4: 'THROTTLE', 17: 'THROTTLE', 32: 'THROTTLE', 613: 'THROTTLE', 80007: 'THROTTLE', 130429: 'THROTTLE', 131048: 'THROTTLE', 131056: 'THROTTLE',
  131047: 'NEED_TEMPLATE',
  132000: 'TEMPLATE', 132001: 'TEMPLATE', 132005: 'TEMPLATE', 132007: 'TEMPLATE', 132012: 'TEMPLATE', 132015: 'TEMPLATE', 132016: 'TEMPLATE', 132068: 'TEMPLATE', 132069: 'TEMPLATE',
  131026: 'INVALID_RECIPIENT', 131030: 'INVALID_RECIPIENT', 131021: 'INVALID_RECIPIENT', 1: 'RETRY', 2: 'RETRY', 131000: 'RETRY', 131016: 'RETRY', 131057: 'RETRY',
  100: 'PAYLOAD', 131008: 'PAYLOAD', 131009: 'PAYLOAD', 131051: 'PAYLOAD', 131052: 'PAYLOAD', 131053: 'PAYLOAD', 135000: 'PAYLOAD',
};
export const classifyMetaError = (code: number | string | undefined): MetaErrorAction => (code === undefined || code === '' ? 'UNKNOWN' : META_ERROR_ACTIONS[Number(code)] ?? 'UNKNOWN');

/** Meta messaging tiers (unique people messaged in a rolling 24 h window, business-initiated). */
export const META_TIER_LIMITS: Record<string, number> = { TIER_NOT_SET: 0, TIER_50: 50, TIER_250: 250, TIER_1K: 1000, TIER_2K: 2000, TIER_10K: 10_000, TIER_100K: 100_000, TIER_UNLIMITED: Number.POSITIVE_INFINITY };

const MEDIA_TYPES = new Set(['image', 'audio', 'video', 'document', 'sticker']);
function inboundKind(m: any): MetaInboundKind {
  const t = String(m?.type ?? '');
  if (t === 'text') return 'text'; if (t === 'button') return 'button'; if (t === 'interactive') return 'interactive';
  if (MEDIA_TYPES.has(t)) return 'media'; if (t === 'location') return 'location'; if (t === 'contacts') return 'contacts';
  if (t === 'reaction') return 'reaction'; if (t === 'system') return 'system'; if (t === 'unsupported') return 'unsupported';
  return 'other';
}

export function parseMetaWebhook(raw: string): { statuses: MetaStatus[]; inbound: MetaInbound[] } {
  const out = { statuses: [] as MetaStatus[], inbound: [] as MetaInbound[] };
  let j: any; try { j = JSON.parse(raw); } catch { return out; }
  if (j?.object !== 'whatsapp_business_account') return out;
  for (const entry of j.entry ?? []) for (const ch of entry?.changes ?? []) {
    const v = ch?.value; if (!v) continue;
    const phoneNumberId = v?.metadata?.phone_number_id ? String(v.metadata.phone_number_id) : undefined;
    for (const s of v.statuses ?? []) {
      const st = String(s?.status ?? '').toLowerCase(); const id = String(s?.id ?? '');
      const status = st === 'sent' ? 'SENT' : st === 'delivered' ? 'DELIVERED' : st === 'read' ? 'READ' : st === 'failed' ? 'FAILED' : undefined;
      if (!status || !id) continue;
      const err = s?.errors?.[0]; const code = Number(err?.code);
      const category = s?.pricing?.category ?? s?.conversation?.origin?.type;
      out.statuses.push({ providerRef: id, status, ...(status === 'FAILED' ? { error: `META_${err?.code ?? 'FAILED'}`.slice(0, 200), ...(Number.isFinite(code) ? { errorCode: code } : {}) } : {}), ...(s?.timestamp ? { occurredAt: new Date(Number(s.timestamp) * 1000).toISOString() } : {}), ...(typeof category === 'string' ? { category: category.slice(0, 40) } : {}) });
    }
    for (const m of v.messages ?? []) {
      if (!m?.from) continue;
      const kind = inboundKind(m);
      if (kind === 'reaction' || kind === 'system') continue; // not conversation turns
      const text = kind === 'text' ? m.text?.body : kind === 'interactive' ? (m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title) : kind === 'button' ? m.button?.text : undefined;
      const buttonPayload = kind === 'button' ? m.button?.payload : kind === 'interactive' ? (m.interactive?.button_reply?.id ?? m.interactive?.list_reply?.id) : undefined;
      const ts = Number(m.timestamp);
      out.inbound.push({
        from: `+${String(m.from).replace(/^\+/, '')}`, kind,
        ...(text ? { text: String(text) } : {}), ...(buttonPayload ? { buttonPayload: String(buttonPayload) } : {}),
        ...(m.id ? { providerRef: String(m.id) } : {}), ...(Number.isFinite(ts) && ts > 0 ? { occurredAtMs: ts * 1000 } : {}),
        ...(m.context?.id ? { contextRef: String(m.context.id) } : {}), ...(phoneNumberId ? { phoneNumberId } : {}),
      });
    }
  }
  return out;
}

/** Template review, template / phone-number quality and account events (the `field` of a change is not `messages`). Unknown fields are ignored, never guessed. */
export function parseMetaAccountEvents(raw: string): MetaAccountEvent[] {
  const out: MetaAccountEvent[] = [];
  let j: any; try { j = JSON.parse(raw); } catch { return out; }
  if (j?.object !== 'whatsapp_business_account') return out;
  const str = (x: unknown, n = 120) => String(x ?? '').slice(0, n);
  for (const entry of j.entry ?? []) for (const ch of entry?.changes ?? []) {
    const v = ch?.value; if (!v) continue;
    switch (ch.field) {
      case 'message_template_status_update': if (v.message_template_id !== undefined) out.push({ type: 'TEMPLATE_STATUS', templateId: str(v.message_template_id, 40), name: str(v.message_template_name, 512), language: str(v.message_template_language, 20), event: str(v.event, 40).toUpperCase(), ...(v.reason && v.reason !== 'NONE' ? { reason: str(v.reason, 80) } : {}) }); break;
      case 'message_template_quality_update': if (v.message_template_id !== undefined) out.push({ type: 'TEMPLATE_QUALITY', templateId: str(v.message_template_id, 40), name: str(v.message_template_name, 512), language: str(v.message_template_language, 20), quality: str(v.new_quality_score, 20).toUpperCase() }); break;
      case 'phone_number_quality_update': out.push({ type: 'PHONE_QUALITY', event: str(v.event, 40).toUpperCase(), ...(v.current_limit ? { tier: str(v.current_limit, 30).toUpperCase() } : {}) }); break;
      case 'account_update': case 'account_alerts': case 'account_review_update': out.push({ type: 'ACCOUNT', event: str(v.event ?? v.alert_type ?? v.decision, 60).toUpperCase() }); break;
      default: break;
    }
  }
  return out;
}

/**
 * Graph payload for `POST /{waba-id}/message_templates` (submit for approval). Body parameters use {{1}}..{{n}} with one example value each (Meta requires examples).
 * AUTHENTICATION templates use the OTP structure (no free body text; Meta fills it), so only `add_security_recommendation` and the copy-code button are set.
 */
export interface MetaTemplateDefinition { name: string; language: string; category: 'UTILITY' | 'MARKETING' | 'AUTHENTICATION'; body: string; examples: string[]; quickReplies?: string[]; footer?: string }
export function metaTemplateSubmission(d: MetaTemplateDefinition) {
  if (d.category === 'AUTHENTICATION') {
    return { name: d.name, language: d.language, category: 'AUTHENTICATION', components: [{ type: 'BODY', add_security_recommendation: true }, { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE', text: d.language === 'ar' ? 'نسخ الكود' : 'Copy code' }] }] };
  }
  const components: unknown[] = [{ type: 'BODY', text: d.body, ...(d.examples.length ? { example: { body_text: [d.examples] } } : {}) }];
  if (d.footer) components.push({ type: 'FOOTER', text: d.footer });
  if (d.quickReplies?.length) components.push({ type: 'BUTTONS', buttons: d.quickReplies.map((text) => ({ type: 'QUICK_REPLY', text: text.slice(0, 25) })) });
  return { name: d.name, language: d.language, category: d.category, components };
}
