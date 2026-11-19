import { Injectable } from '@nestjs/common';
import { notFound } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthSessionService {
  constructor(private readonly prisma: PrismaService) {}

  async isRevoked(sid: string): Promise<boolean> {
    const s = await this.prisma.authSession.findUnique({ where: { sid }, select: { revokedAt: true } });
    return !!s?.revokedAt;
  }

  async touch(sub: string, sid: string, meta: { clientId?: string; device?: string; ip?: string }) {
    const existing = await this.prisma.authSession.findUnique({ where: { sid } });
    if (!existing) {
      await this.prisma.authSession.upsert({ where: { sid }, create: { sid, sub, ...meta }, update: {} });
    } else if (Date.now() - existing.lastSeenAt.getTime() > 60_000) {
      await this.prisma.authSession.update({ where: { sid }, data: { lastSeenAt: new Date() } });
    }
  }

  async list(sub: string, currentSid?: string) {
    const rows = await this.prisma.authSession.findMany({ where: { sub, revokedAt: null }, orderBy: { lastSeenAt: 'desc' } });
    return rows.map((r) => ({ id: r.id, device: r.device, clientId: r.clientId, createdAt: r.createdAt, lastSeenAt: r.lastSeenAt, current: r.sid === currentSid }));
  }

  /** KXM-AC-05 remote sign-out. IdP-side refresh revocation: TODO_NEEDS_HUMAN (IdP admin API not specified in KX-04). */
  async revoke(sub: string, id: string) {
    const r = await this.prisma.authSession.updateMany({ where: { id, sub, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!r.count) throw notFound('SESSION_NOT_FOUND', 'Session not found');
    return { ok: true };
  }

  async revokeBySid(sid: string) {
    const r = await this.prisma.authSession.updateMany({ where: { sid, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!r.count) await this.prisma.authSession.upsert({ where: { sid }, create: { sid, sub: 'unknown', revokedAt: new Date() }, update: { revokedAt: new Date() } });
  }

  async revokeAllForSub(sub: string) {
    return this.prisma.authSession.updateMany({ where: { sub, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
