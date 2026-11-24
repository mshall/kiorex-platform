import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cfg } from '../../common/config';
import { growthPublic } from './assistant.growth-bridge';
import { PrismaService } from '../../prisma/prisma.service';
import { sha } from './assistant.audit';
import { LIMITS } from './assistant.policy';

export type LinkIntent = 'BOOK' | 'VERIFY' | 'PAY' | 'CONSENT';
export interface LinkPayload { providerId?: string; startsAt?: string; typeId?: string; bookingId?: string }

/**
 * Short-lived, signed, ONE-TIME hand-off links (TTL 15 minutes): the only URLs the assistant ever sends. Used for unverified numbers (Passport verification), payment and 3-D Secure, and whenever the
 * patient prefers the app. Token `kxa1.<expiry>.<random>.<hmac>`: the HMAC key is the growth link-token key (no key in production means no link, never a guessable one), the database keeps only a hash,
 * `verify` marks it used atomically. No URL is ever taken from a model: the model asks for an intent, this service creates the link.
 */
@Injectable()
export class AssistantLinkService {
  constructor(private readonly prisma: PrismaService) {}

  private async sign(exp: string, rand: string): Promise<string | null> {
    const k = (await growthPublic()).linkTokenKey(); if (!k) return null;
    return createHmac('sha256', k).update(`kxa1.${exp}.${rand}`).digest('base64url').slice(0, 32);
  }

  async create(o: { phoneHash: string; intent: LinkIntent; payload?: LinkPayload; now?: Date }): Promise<{ url: string; expiresAt: Date } | null> {
    const now = o.now ?? new Date();
    const expiresAt = new Date(now.getTime() + LIMITS.linkTtlMinutes * 60_000);
    const exp = Math.floor(expiresAt.getTime() / 1000).toString(36); const rand = randomBytes(18).toString('base64url');
    const sig = await this.sign(exp, rand); if (!sig) return null;
    const token = `kxa1.${exp}.${rand}.${sig}`;
    await this.prisma.assistantLink.create({ data: { tokenHash: sha(token), phoneHash: o.phoneHash, intent: o.intent, payload: (o.payload ?? {}) as object, expiresAt } });
    return { url: `${cfg().appLinkBase.replace(/\/$/, '')}/assistant?al=${token}`, expiresAt };
  }

  /** Verifies the signature and the expiry, then consumes the token. Returns the prefill (ids only) or a reason. */
  async verify(token: string, now = new Date()): Promise<{ ok: true; intent: LinkIntent; payload: LinkPayload; phoneHash: string } | { ok: false; code: 'INVALID' | 'EXPIRED' | 'USED' }> {
    const parts = token.split('.');
    if (parts.length !== 4 || parts[0] !== 'kxa1' || token.length > 200) return { ok: false, code: 'INVALID' };
    const [, exp, rand, sig] = parts;
    const want = await this.sign(exp, rand);
    if (!want || want.length !== sig.length || !timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return { ok: false, code: 'INVALID' };
    if (parseInt(exp, 36) * 1000 <= now.getTime()) return { ok: false, code: 'EXPIRED' };
    const row = await this.prisma.assistantLink.findUnique({ where: { tokenHash: sha(token) } });
    if (!row) return { ok: false, code: 'INVALID' };
    if (row.usedAt) return { ok: false, code: 'USED' };
    const claimed = await this.prisma.assistantLink.updateMany({ where: { id: row.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
    if (claimed.count !== 1) return { ok: false, code: 'USED' };
    return { ok: true, intent: row.intent as LinkIntent, payload: (row.payload ?? {}) as LinkPayload, phoneHash: row.phoneHash };
  }
}
