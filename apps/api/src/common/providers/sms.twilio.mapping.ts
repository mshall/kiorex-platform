import { type MessagingMapping } from './mapping-types';
import { parseTwilioSend, parseTwilioStatus, twilioAuth, twilioCreds, twilioForm, twilioPath, verifyTwilioSignature } from './vendors/twilio-sms';

/** SMS_PROVIDER=twilio: Twilio Programmable Messaging. SMS_API_KEY = "<AccountSid>:<AuthToken>"; the status callback is signed with the auth token. */
export const smsTwilioMapping: MessagingMapping = {
  authHeaders: twilioAuth,
  buildSend: (i) => ({ path: twilioPath(i.apiKey ?? ''), form: twilioForm({ to: i.to, from: i.senderId, body: i.body, statusCallback: i.publicWebhookUrl }) }),
  parseSend: parseTwilioSend,
  parseStatusWebhook: (raw) => parseTwilioStatus(raw),
  verifyWebhook: (o) => verifyTwilioSignature(o.secret, o.publicUrl ?? '', o.rawBody, o.headers),
};
export { twilioCreds };
