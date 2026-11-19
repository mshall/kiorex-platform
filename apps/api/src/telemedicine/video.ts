import { createHash, createHmac } from 'node:crypto';
import { cfg } from '../common/config';

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

export const VIDEO = Symbol('KX_VIDEO');
export const videoAdapter = (): VideoAdapter => (cfg().videoMode === 'real' ? new UnconfiguredVideoAdapter() : new MockVideoAdapter());
