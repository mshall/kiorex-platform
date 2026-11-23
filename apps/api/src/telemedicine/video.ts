import { createHash, createHmac } from 'node:crypto';
import { cfg } from '../common/config';
import { videoProblems as _vp } from '../common/providers/problems';

export interface VideoToken { token: string; expiresAt: string; url: string; room: string; role: 'patient' | 'clinician'; provider: string }

/**
 * Video is NOT a paid vendor. VIDEO_MODE=mock (dev, deterministic fake rooms) | clinic-p2p (the Clinic owns the call: its own peer-to-peer
 * WebRTC, signalling and Cloudflare STUN/TURN credentials; Kiorex only stores the session id + patient join URL carried by the booking).
 * No media and no video SDK/key ever touches Kiorex.
 */
export type VideoMode = 'mock' | 'clinic-p2p';

export interface VideoAdapter {
  readonly mode: VideoMode;
  readonly name: string;
  createRoom(sessionId: string): Promise<{ roomName: string }>;
  issueToken(i: { roomName: string; identity: string; role: 'patient' | 'clinician'; ttlSeconds: number }): Promise<VideoToken>;
}

/** Deterministic fake: rooms `kxmock-<session>`, tokens `mockvid.<b64url payload>.<hmac>` (NOT a real token). */
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

/** VIDEO_MODE=clinic-p2p: the Clinic owns the call, so Kiorex never creates rooms or tokens (the old Kiorex-owned session path is dormant). */
export class ClinicP2pVideoAdapter implements VideoAdapter {
  readonly mode = 'clinic-p2p' as const;
  readonly name = 'clinic-p2p';
  async createRoom(): Promise<never> { throw new Error('CLINIC_OWNS_CALL: Kiorex does not host video; the Clinic issues the join link'); }
  async issueToken(): Promise<never> { throw new Error('CLINIC_OWNS_CALL: Kiorex does not host video; the Clinic issues the join link'); }
}

export const videoProblems = _vp;
export const VIDEO = Symbol('KX_VIDEO');
export const videoAdapter = (): VideoAdapter => (cfg().videoMode === 'clinic-p2p' ? new ClinicP2pVideoAdapter() : new MockVideoAdapter());
