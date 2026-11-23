import { type MessagingMapping } from './mapping-types';
import { parseSesEvents, parseSesSend, sesSendBody, sesSigner, snsConfirmUrl, verifySnsBasicAuth } from './vendors/ses';

/** EMAIL_PROVIDER=ses: Amazon SES v2 over SigV4. See vendors/ses.ts for env and the SNS event wiring. */
export const emailSesMapping: MessagingMapping = {
  authHeaders: () => ({}), // SigV4 is applied per attempt by `sign`
  buildSend: (i) => ({
    path: '/v2/email/outbound-emails',
    body: sesSendBody({ from: i.senderId, to: i.to, subject: i.subject ?? 'Kiorex', text: i.body, reference: i.reference, configurationSet: process.env.EMAIL_SES_CONFIGURATION_SET || undefined }),
    sign: i.apiUrl && i.apiKey ? sesSigner(i.apiUrl, i.apiKey) : undefined,
  }),
  parseSend: parseSesSend,
  parseStatusWebhook: (raw) => parseSesEvents(raw),
  verifyWebhook: (o) => verifySnsBasicAuth(o.secret, o.headers),
  subscriptionConfirmUrl: snsConfirmUrl,
};
