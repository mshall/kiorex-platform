import { createSign } from 'node:crypto';

/**
 * Apple Push Notification service, token-based (.p8, ES256 JWT) over HTTP/2: no certificate to renew, one key for every app of the team.
 *   POST https://api.push.apple.com/3/device/<hex device token>   (sandbox: api.sandbox.push.apple.com)
 *   headers: authorization: bearer <JWT>, apns-topic: <bundle id>, apns-push-type: alert, apns-priority: 10, apns-expiration
 * The JWT (iss = team id, kid = key id, iat) is cached for 40 minutes (Apple wants a refresh between 20 and 60 minutes; more often is throttled with 429 TooManyProviderTokenUpdates).
 * Alert pushes only: `background` / content-available pushes are NOT supported by design (no silent push, see push.ts). The HTTP/2 transport is injected so tests never open a socket.
 */
export interface ApnsConfig { keyP8?: string; keyId?: string; teamId?: string; bundleId?: string; production?: boolean }
export interface ApnsMessage { token: string; title: string; body: string; data?: Record<string, unknown>; badge?: number; ttlSeconds?: number; collapseId?: string }
export interface ApnsOutcome { ok: boolean; providerRef?: string; error?: string; invalidToken?: boolean; retryable?: boolean; authFailed?: boolean }
export interface Http2Response { status: number; headers: Record<string, string>; body: string }
export type Http2Request = (o: { host: string; path: string; headers: Record<string, string>; body: string; timeoutMs: number }) => Promise<Http2Response>;

export const isApnsToken = (t: string) => /^[0-9a-fA-F]{64,200}$/.test(t);
export const APNS_HOSTS = { production: 'api.push.apple.com', sandbox: 'api.sandbox.push.apple.com' } as const;

export function normalizeP8(raw: string | undefined): string | null {
  const t = (raw ?? '').trim(); if (!t) return null;
  const pem = t.includes('BEGIN PRIVATE KEY') ? t.replace(/\\n/g, '\n') : Buffer.from(t, 'base64').toString('utf8');
  return pem.includes('BEGIN PRIVATE KEY') ? pem : null;
}
export function apnsProblems(c: ApnsConfig): string[] {
  const out: string[] = [];
  if (!normalizeP8(c.keyP8)) out.push('PUSH_APNS_KEY_P8 must be the .p8 private key (PEM, raw or base64)');
  if (!c.keyId || !/^[A-Z0-9]{10}$/.test(c.keyId)) out.push('PUSH_APNS_KEY_ID must be the 10-character key id');
  if (!c.teamId || !/^[A-Z0-9]{10}$/.test(c.teamId)) out.push('PUSH_APNS_TEAM_ID must be the 10-character team id');
  if (!c.bundleId) out.push('PUSH_APNS_BUNDLE_ID is required');
  return out;
}
export const apnsConfigFromEnv = (env: Record<string, string | undefined>): ApnsConfig => ({ keyP8: env.PUSH_APNS_KEY_P8, keyId: env.PUSH_APNS_KEY_ID, teamId: env.PUSH_APNS_TEAM_ID, bundleId: env.PUSH_APNS_BUNDLE_ID, production: env.PUSH_APNS_PRODUCTION !== 'false' });

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');
/** ES256 JWT with the raw (r||s) signature JOSE needs (`dsaEncoding: ieee-p1363`), not the DER default. */
export function apnsJwt(c: ApnsConfig, nowMs: number): string {
  const pem = normalizeP8(c.keyP8); if (!pem || !c.keyId || !c.teamId) throw new Error('APNS_NOT_CONFIGURED');
  const unsigned = `${b64u(JSON.stringify({ alg: 'ES256', kid: c.keyId }))}.${b64u(JSON.stringify({ iss: c.teamId, iat: Math.floor(nowMs / 1000) }))}`;
  return `${unsigned}.${b64u(createSign('SHA256').update(unsigned).sign({ key: pem, dsaEncoding: 'ieee-p1363' }))}`;
}

/** APNs reasons -> what to do. `Unregistered` (410) and `BadDeviceToken` / `DeviceTokenNotForTopic` mean the token is dead for this app and environment: revoke it. */
const DEAD = new Set(['Unregistered', 'BadDeviceToken', 'DeviceTokenNotForTopic']);
const RETRY = new Set(['TooManyRequests', 'InternalServerError', 'ServiceUnavailable', 'Shutdown']);
const AUTH = new Set(['ExpiredProviderToken', 'InvalidProviderToken', 'MissingProviderToken', 'Forbidden', 'BadCertificate']);

export function apnsPayload(m: ApnsMessage): Record<string, unknown> {
  return { aps: { alert: { title: m.title, body: m.body }, sound: 'default', ...(typeof m.badge === 'number' && m.badge >= 0 ? { badge: Math.floor(m.badge) } : {}) }, ...(m.data ?? {}) };
}

export class ApnsSender {
  private jwt?: { value: string; at: number };
  constructor(private readonly cfg: ApnsConfig, private readonly h2: Http2Request, private readonly now: () => number = Date.now) {}
  private token(): string { if (!this.jwt || this.now() - this.jwt.at > 40 * 60_000) this.jwt = { value: apnsJwt(this.cfg, this.now()), at: this.now() }; return this.jwt.value; }

  async send(m: ApnsMessage): Promise<ApnsOutcome> {
    if (apnsProblems(this.cfg).length) return { ok: false, error: 'APNS_NOT_CONFIGURED', authFailed: true };
    if (!m.title.trim() || !m.body.trim()) return { ok: false, error: 'PUSH_SILENT_REFUSED' };
    if (!isApnsToken(m.token)) return { ok: false, error: 'APNS_BadDeviceToken', invalidToken: true };
    let jwt: string; try { jwt = this.token(); } catch { return { ok: false, error: 'APNS_NOT_CONFIGURED', authFailed: true }; }
    const ttl = m.ttlSeconds ?? 86_400;
    try {
      const r = await this.h2({
        host: this.cfg.production === false ? APNS_HOSTS.sandbox : APNS_HOSTS.production, path: `/3/device/${m.token}`, timeoutMs: 8000, body: JSON.stringify(apnsPayload(m)),
        headers: { authorization: `bearer ${jwt}`, 'apns-topic': this.cfg.bundleId!, 'apns-push-type': 'alert', 'apns-priority': '10', 'apns-expiration': String(Math.floor(this.now() / 1000) + ttl), ...(m.collapseId ? { 'apns-collapse-id': m.collapseId.slice(0, 64) } : {}), 'content-type': 'application/json' },
      });
      if (r.status === 200) return { ok: true, providerRef: r.headers['apns-id'] ?? 'apns' };
      let reason = ''; try { reason = String(JSON.parse(r.body || '{}').reason ?? ''); } catch { /* not JSON */ }
      if (AUTH.has(reason)) this.jwt = undefined; // force a new token next time
      return { ok: false, error: `APNS_${reason || r.status}`.slice(0, 80), invalidToken: r.status === 410 || DEAD.has(reason), retryable: r.status >= 500 || RETRY.has(reason), authFailed: AUTH.has(reason) };
    } catch { return { ok: false, error: 'APNS_NETWORK', retryable: true }; }
  }
}

/** Default transport: one HTTP/2 session per request (simple and correct; Apple recommends reuse above ~hundreds of pushes per minute, an optimisation for load testing). */
export const nodeHttp2: Http2Request = async (o) => {
  const http2 = await import('node:http2');
  return new Promise<Http2Response>((resolve, reject) => {
    const client = http2.connect(`https://${o.host}`);
    const timer = setTimeout(() => { client.destroy(); reject(new Error('timeout')); }, o.timeoutMs);
    client.on('error', (e) => { clearTimeout(timer); reject(e); });
    const req = client.request({ ':method': 'POST', ':path': o.path, ...o.headers });
    let status = 0; const headers: Record<string, string> = {}; const chunks: Buffer[] = [];
    req.on('response', (h) => { status = Number(h[':status']); for (const [k, v] of Object.entries(h)) if (!k.startsWith(':')) headers[k] = String(v); });
    req.on('data', (c) => chunks.push(Buffer.from(c)));
    req.on('end', () => { clearTimeout(timer); client.close(); resolve({ status, headers, body: Buffer.concat(chunks).toString('utf8') }); });
    req.on('error', (e) => { clearTimeout(timer); client.destroy(); reject(e); });
    req.end(o.body);
  });
};
