import { bearer, type MessagingMapping } from './mapping-types';
import { metaTemplateBody, parseMetaSend, parseMetaWebhook, verifyMetaSignature, metaVerifyChallenge } from './vendors/meta-whatsapp';
import { whatsappTemplateName } from './whatsapp.mapping';

/**
 * WHATSAPP_PROVIDER=meta: Meta WhatsApp Business Cloud API. WHATSAPP_API_URL (default https://graph.facebook.com/v21.0), WHATSAPP_API_KEY = system-user token,
 * WHATSAPP_SENDER_ID = phone-number-id, WHATSAPP_WEBHOOK_SECRET = app secret (X-Hub-Signature-256), WHATSAPP_VERIFY_TOKEN (GET handshake).
 * Business-initiated messages are always approved templates; the rendered text goes in the single {{1}} body parameter unless `variables` lists numbered params;
 * OTP (`variables.code`) uses the AUTHENTICATION template shape: code as {{1}} + the copy-code button.
 */
export const whatsappMetaMapping: MessagingMapping = {
  authHeaders: bearer,
  buildSend: (i) => {
    const numbered = Object.keys(i.variables ?? {}).filter((k) => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b)).map((k) => i.variables![k]);
    return { path: `/${encodeURIComponent(i.senderId)}/messages`, body: metaTemplateBody({ to: i.to, templateName: whatsappTemplateName(i.templateId), language: i.locale === 'en' ? 'en' : 'ar', bodyParams: numbered.length ? numbered : i.variables?.code ? [i.variables.code] : [i.body], urlButtonParam: i.variables?.code }) };
  },
  parseSend: parseMetaSend,
  parseStatusWebhook: (raw) => parseMetaWebhook(raw).statuses.map((s) => ({ providerRef: s.providerRef, status: s.status, ...(s.error ? { error: s.error } : {}), ...(s.occurredAt ? { occurredAt: s.occurredAt } : {}) })),
  parseInbound: (raw) => parseMetaWebhook(raw).inbound,
  verifyWebhook: (o) => verifyMetaSignature(o.secret, o.rawBody, o.headers),
  verifyChallenge: metaVerifyChallenge,
};
