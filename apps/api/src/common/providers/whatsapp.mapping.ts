import { bearer, genericVerify, parseGenericSend, parseGenericStatus, type MessagingMapping } from './mapping-types';

/**
 * Optional `WHATSAPP_TEMPLATE_MAP` (JSON, e.g. {"TODO_NEEDS_HUMAN_booking_confirmed":"kx_booking_confirmed_v1"}) maps Kiorex template ids to
 * the Meta-approved template names, so go-live needs no code change. Unmapped ids are sent unchanged.
 */
export function whatsappTemplateName(templateId: string, env: Record<string, string | undefined> = process.env): string {
  try { const m = JSON.parse(env.WHATSAPP_TEMPLATE_MAP ?? '{}'); return typeof m?.[templateId] === 'string' ? m[templateId] : templateId; } catch { return templateId; }
}

/**
 * WHATSAPP mapping (ADAPT HERE for a given BSP / Meta Cloud API gateway). Neutral contract:
 *   POST {WHATSAPP_API_URL}/messages
 *     { "to": "+2010...", "from": "<WHATSAPP_SENDER_ID>", "type": "template",
 *       "template": { "name": "<approved template>", "language": "ar|en", "variables": { "body": "<rendered text>", ...extra e.g. "code" for OTP } }, "reference": "..." }
 *   -> 2xx { "id": "<providerRef>" }
 *   webhook -> { "events": [ { "id": "<providerRef>", "status": "sent|delivered|read|failed", "error": "..." } ] }
 */
export const whatsappMapping: MessagingMapping = {
  authHeaders: bearer,
  buildSend: (i) => ({ path: '/messages', body: { to: i.to, from: i.senderId, type: 'template', template: { name: whatsappTemplateName(i.templateId), language: i.locale === 'en' ? 'en' : 'ar', variables: { body: i.body, ...(i.variables ?? {}) } }, reference: i.reference } }),
  parseSend: parseGenericSend,
  parseStatusWebhook: parseGenericStatus,
  verifyWebhook: genericVerify,
};
