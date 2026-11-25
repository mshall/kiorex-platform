import { signV4, awsRegionFromHost } from './sigv4';

/**
 * Amazon SES v2 over HTTPS (SigV4, no SDK).  EMAIL_API_URL=https://email.<region>.amazonaws.com
 *   send: POST /v2/email/outbound-emails  { FromEmailAddress, Destination:{ToAddresses}, Content:{Simple:{Subject,Body}}, ConfigurationSetName? } -> { MessageId }
 *   EMAIL_API_KEY = "<ACCESS_KEY_ID>:<SECRET_ACCESS_KEY>[:<SESSION_TOKEN>]" (IAM user limited to ses:SendEmail, from Secrets Manager).
 *   events: SES configuration set -> SNS topic -> HTTPS subscription to POST /messaging/webhooks/email with basic-auth password = EMAIL_WEBHOOK_SECRET
 *   (SNS supports credentials in the subscription URL). Handles SubscriptionConfirmation and Delivery / Bounce / Complaint / Reject notifications.
 */
export interface SesCreds { accessKeyId: string; secretAccessKey: string; sessionToken?: string }
export function parseSesCreds(apiKey: string): SesCreds | null {
  const [accessKeyId, secretAccessKey, sessionToken] = apiKey.split(':');
  return accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey, ...(sessionToken ? { sessionToken } : {}) } : null;
}

/** RFC 2369 + RFC 8058 headers for MARKETING mail: a mailto and an https URL, plus one-click POST support (Gmail / Yahoo bulk-sender rules). Never added to transactional mail. */
export function listUnsubscribeHeaders(i: { url?: string; mailto?: string }): Array<{ Name: string; Value: string }> {
  const parts = [i.mailto ? `<mailto:${i.mailto}>` : '', i.url ? `<${i.url}>` : ''].filter(Boolean);
  if (!parts.length) return [];
  return [{ Name: 'List-Unsubscribe', Value: parts.join(', ') }, ...(i.url ? [{ Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' }] : [])];
}

export function sesSendBody(i: { from: string; to: string; subject: string; text: string; html?: string; configurationSet?: string; reference?: string; headers?: Array<{ Name: string; Value: string }> }) {
  return {
    FromEmailAddress: i.from, Destination: { ToAddresses: [i.to] },
    Content: { Simple: { Subject: { Data: i.subject, Charset: 'UTF-8' }, Body: { Text: { Data: i.text, Charset: 'UTF-8' }, ...(i.html ? { Html: { Data: i.html, Charset: 'UTF-8' } } : {}) }, ...(i.headers?.length ? { Headers: i.headers } : {}) } },
    ...(i.configurationSet ? { ConfigurationSetName: i.configurationSet } : {}),
    ...(i.reference ? { EmailTags: [{ Name: 'ref', Value: i.reference.replace(/[^A-Za-z0-9_.@-]/g, '_').slice(0, 256) }] } : {}),
  };
}
export const sesSigner = (apiUrl: string, apiKey: string) => {
  const creds = parseSesCreds(apiKey);
  const region = awsRegionFromHost(new URL(apiUrl).host);
  return creds && region ? (r: { method: string; url: string; body: string }) => signV4({ ...r, ...creds, region, service: 'ses', headers: { 'content-type': 'application/json' } }) : undefined;
};
export function parseSesSend(json: any): { providerRef: string } {
  if (typeof json?.MessageId !== 'string' || !json.MessageId) throw new Error('no MessageId in SES response');
  return { providerRef: json.MessageId };
}

/** Basic-auth verification of the SNS HTTPS subscription (password = webhook secret). */
export function verifySnsBasicAuth(secret: string, headers: Record<string, unknown>): boolean {
  if (!secret) return false;
  const a = String(Array.isArray(headers.authorization) ? headers.authorization[0] : headers.authorization ?? '');
  if (!a.startsWith('Basic ')) return false;
  const pw = Buffer.from(a.slice(6), 'base64').toString('utf8').split(':').slice(1).join(':');
  return pw.length === secret.length && pw === secret;
}
/** SNS SubscriptionConfirmation: only honour AWS SNS hosts. */
export function snsConfirmUrl(raw: string): string | null {
  try { const j = JSON.parse(raw); if (j?.Type !== 'SubscriptionConfirmation') return null; const u = new URL(String(j.SubscribeURL)); return u.protocol === 'https:' && /^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(u.host) ? u.toString() : null; } catch { return null; }
}
export interface SesEvent { providerRef: string; status: 'SENT' | 'DELIVERED' | 'FAILED'; error?: string; occurredAt?: string; /** addresses that must stop receiving mail (permanent bounce, complaint) */ suppress?: Array<{ address: string; reason: 'BOUNCE' | 'COMPLAINT' }> }
export function parseSesEvents(raw: string): SesEvent[] {
  let env: any; try { env = JSON.parse(raw); } catch { return []; }
  if (env?.Type !== 'Notification') return [];
  let m: any; try { m = JSON.parse(env.Message); } catch { return []; }
  const id = m?.mail?.messageId; const type = String(m?.eventType ?? m?.notificationType ?? '');
  if (!id) return [];
  const at = m?.[type.toLowerCase()]?.timestamp ?? m?.mail?.timestamp;
  const base = { providerRef: String(id), ...(at ? { occurredAt: String(at) } : {}) };
  const addrs = (list: any): string[] => (Array.isArray(list) ? list.map((r) => String(r?.emailAddress ?? '').trim().toLowerCase()).filter((a) => /^[^\s@]+@[^\s@]+$/.test(a)) : []);
  switch (type) {
    case 'Send': return [{ ...base, status: 'SENT' }];
    case 'Delivery': return [{ ...base, status: 'DELIVERED' }];
    case 'Bounce': {
      const permanent = String(m.bounce?.bounceType ?? '').toLowerCase() === 'permanent'; // transient (mailbox full, out of office) is retryable and never suppresses
      return [{ ...base, status: 'FAILED', error: `SES_BOUNCE_${String(m.bounce?.bounceType ?? 'UNKNOWN').toUpperCase()}`, ...(permanent ? { suppress: addrs(m.bounce?.bouncedRecipients).map((address) => ({ address, reason: 'BOUNCE' as const })) } : {}) }];
    }
    case 'Complaint': return [{ ...base, status: 'FAILED', error: 'SES_COMPLAINT', suppress: addrs(m.complaint?.complainedRecipients).map((address) => ({ address, reason: 'COMPLAINT' as const })) }];
    case 'Reject': return [{ ...base, status: 'FAILED', error: 'SES_REJECT' }];
    default: return [];
  }
}

/**
 * Amazon SNS message signature (SignatureVersion 1 = SHA1, 2 = SHA256 with RSA). Stronger than the basic-auth password because it proves AWS signed it. The signing
 * certificate URL is only fetched from https://sns.<region>.amazonaws.com/*.pem; the key lookup is injected (tests pass a generated key, production fetches and caches the cert).
 */
export function snsStringToSign(m: Record<string, any>): string | null {
  const t = String(m?.Type ?? '');
  const fields = t === 'Notification' ? ['Message', 'MessageId', ...(m.Subject !== undefined ? ['Subject'] : []), 'Timestamp', 'TopicArn', 'Type']
    : t === 'SubscriptionConfirmation' || t === 'UnsubscribeConfirmation' ? ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'] : null;
  if (!fields) return null;
  if (fields.some((f) => typeof m[f] !== 'string')) return null;
  return fields.map((f) => `${f}\n${m[f]}\n`).join('');
}
export const snsCertUrlOk = (u: string): boolean => { try { const x = new URL(u); return x.protocol === 'https:' && /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/.test(x.host) && x.pathname.endsWith('.pem'); } catch { return false; } };
export async function verifySnsSignature(raw: string, publicKeyFor: (certUrl: string) => Promise<import('node:crypto').KeyObject | string>, expectedTopicArns: string[] = []): Promise<boolean> {
  let m: any; try { m = JSON.parse(raw); } catch { return false; }
  const sts = snsStringToSign(m); if (!sts || typeof m.Signature !== 'string' || !snsCertUrlOk(String(m.SigningCertURL))) return false;
  if (expectedTopicArns.length && !expectedTopicArns.includes(String(m.TopicArn))) return false;
  const alg = String(m.SignatureVersion) === '2' ? 'RSA-SHA256' : String(m.SignatureVersion) === '1' ? 'RSA-SHA1' : null;
  if (!alg) return false;
  try {
    const { createVerify } = await import('node:crypto');
    return createVerify(alg).update(sts, 'utf8').verify(await publicKeyFor(String(m.SigningCertURL)), Buffer.from(m.Signature, 'base64'));
  } catch { return false; }
}
