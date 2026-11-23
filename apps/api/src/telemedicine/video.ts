import { createHash, createHmac } from 'node:crypto';
import { cfg } from '../common/config';
import { videoProblems as _vp } from '../common/providers/problems';
import { outboundFetch } from '../common/outbound-http';
import { dailyRoomBody, dailyTokenBody } from '../common/providers/vendors/video-daily';

export interface VideoToken { token: string; expiresAt: string; url: string; room: string; role: 'patient' | 'clinician'; provider: string }

/** Video provider behind an adapter (VIDEO_MODE=mock|real). No PHI: identities are opaque hashes, no names, no clinical text. */
export interface VideoAdapter {
  readonly mode: 'mock' | 'real';
  readonly name: string;
  createRoom(sessionId: string): Promise<{ roomName: string }>;
  issueToken(i: { roomName: string; identity: string; role: 'patient' | 'clinician'; ttlSeconds: number }): Promise<VideoToken>;
}

/** Deterministic fake: rooms `kxmock-<session>`, tokens `mockvid.<b64url payload>.<hmac>` (NOT a real provider JWT). */
export class MockVideoAdapter implements VideoAdapter {
  readonly mode = 'mock' as const;
  readonly name = 'mock';
  async createRoom(sessionId: string) { return { roomName: `kxmock-${sessionId}` }; }
  async issueToken(i: { roomName: string; identity: string; role: 'patient' | 'clinician'; ttlSeconds: number }): Promise<VideoToken> {
    const exp = new Date(Date.now() + i.ttlSeconds * 1000);
    const payload = Buffer.from(JSON.stringify({ room: i.roomName, id: createHash('sha256').update(i.identity).digest('hex').slice(0, 12), role: i.role, exp: Math.floor(exp.getTime() / 1000) })).toString('base64url');
    const sig = createHmac('sha256', cfg().fieldKey).update(payload).digest('base64url').slice(0, 22);
    return { token: `mockvid.${payload}.${sig}`, expiresAt: exp.toISOString(), url: `https://video.mock.invalid/${i.roomName}`, room: i.roomName, role: i.role, provider: 'mock' };
  }
}

/** VIDEO_MODE=real placeholder: provider choice (Twilio/Daily/Chime...), region and BAA/DPA are NEEDS_HUMAN. */
export class UnconfiguredVideoAdapter implements VideoAdapter {
  readonly mode = 'real' as const;
  readonly name = 'unconfigured';
  async createRoom(): Promise<never> { throw new Error('NEEDS_HUMAN: video provider not configured (see Docs/NEEDS_HUMAN.md, Provider go-live)'); }
  async issueToken(): Promise<never> { throw new Error('NEEDS_HUMAN: video provider not configured'); }
}

type Env = Record<string, string | undefined>;
export const videoProblems = _vp;

/** VIDEO_MODE=real, VIDEO_PROVIDER=daily: Daily.co REST. Private rooms, 2 participants, chat and recording OFF, opaque identities (no PHI). */
export class DailyVideoAdapter implements VideoAdapter {
  readonly mode = 'real' as const;
  readonly name = 'daily';
  constructor(private readonly env: Env = process.env, private readonly fetchImpl: typeof outboundFetch = outboundFetch) {}
  private async call(path: string, body: unknown): Promise<any> {
    const res = await this.fetchImpl(`${(this.env.VIDEO_API_URL ?? 'https://api.daily.co/v1').replace(/\/+$/, '')}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${this.env.VIDEO_API_KEY}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`VIDEO_PROVIDER_HTTP_${res.status}`);
    return res.json();
  }
  async createRoom(sessionId: string) {
    const name = `kx-${sessionId}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 64);
    try { const j = await this.call('/rooms', dailyRoomBody(name, 4 * 3600)); return { roomName: String(j.name ?? name) }; }
    catch (e) { if ((e as Error).message.endsWith('_400')) return { roomName: name }; throw e; } // room already exists (idempotent on the session id)
  }
  async issueToken(i: { roomName: string; identity: string; role: 'patient' | 'clinician'; ttlSeconds: number }): Promise<VideoToken> {
    const userId = createHash('sha256').update(i.identity).digest('hex').slice(0, 16);
    const j = await this.call('/meeting-tokens', dailyTokenBody({ roomName: i.roomName, userId, owner: i.role === 'clinician', ttlSeconds: i.ttlSeconds }));
    if (typeof j.token !== 'string') throw new Error('VIDEO_PROVIDER_BAD_RESPONSE');
    return { token: j.token, expiresAt: new Date(Date.now() + i.ttlSeconds * 1000).toISOString(), url: `https://${this.env.VIDEO_DOMAIN}/${i.roomName}`, room: i.roomName, role: i.role, provider: 'daily' };
  }
}

export const VIDEO = Symbol('KX_VIDEO');
export const videoAdapter = (): VideoAdapter => (cfg().videoMode === 'real' ? (videoProblems().length ? new UnconfiguredVideoAdapter() : new DailyVideoAdapter()) : new MockVideoAdapter());
