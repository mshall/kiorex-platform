import { bearer, genericVerify, parseGenericSend, parseGenericStatus, type MessagingMapping } from './mapping-types';

/**
 * EMAIL mapping (ADAPT HERE for a given email vendor). Neutral contract:
 *   POST {EMAIL_API_URL}/messages  { "to": "a@b.c", "from": "<EMAIL_SENDER_ID>", "subject": "...", "text": "...", "reference": "..." }
 *   -> 2xx { "id": "<providerRef>" }
 *   webhook -> { "events": [ { "id": "<providerRef>", "status": "sent|delivered|read|failed|bounced", "error": "..." } ] }
 * Templates carry a rendered body only today, so the subject is the static brand string; the vendor mapping can derive a richer one from `template`.
 */
export const emailMapping: MessagingMapping = {
  authHeaders: bearer,
  buildSend: (i) => ({ path: '/messages', body: { to: i.to, from: i.senderId, subject: 'Kiorex', text: i.body, reference: i.reference, template: i.templateId, locale: i.locale } }),
  parseSend: parseGenericSend,
  parseStatusWebhook: parseGenericStatus,
  verifyWebhook: genericVerify,
};
