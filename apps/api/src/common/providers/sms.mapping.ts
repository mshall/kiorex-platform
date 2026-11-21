import { bearer, genericVerify, parseGenericSend, parseGenericStatus, type MessagingMapping } from './mapping-types';

/**
 * SMS mapping (ADAPT HERE for a given SMS vendor). Neutral contract:
 *   POST {SMS_API_URL}/messages   { "to": "+2010...", "from": "<SMS_SENDER_ID>", "body": "...", "reference": "<idempotency/reference>" }
 *   -> 2xx { "id": "<providerRef>" }
 *   webhook -> { "events": [ { "id": "<providerRef>", "status": "sent|delivered|failed", "error": "..." } ] }
 */
export const smsMapping: MessagingMapping = {
  authHeaders: bearer,
  buildSend: (i) => ({ path: '/messages', body: { to: i.to, from: i.senderId, body: i.body, reference: i.reference } }),
  parseSend: parseGenericSend,
  parseStatusWebhook: parseGenericStatus,
  verifyWebhook: genericVerify,
};
