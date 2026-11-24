import { createHmac } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { cfg } from '../../common/config';
import { KiorlyClient } from '../../kiorly/kiorly-public';
import { addressHash } from '../../common/privacy-hash';
import { PrismaService } from '../../prisma/prisma.service';

export type SignalKind = 'PHONE' | 'PAY_FINGERPRINT' | 'DEVICE' | 'IP24' | 'STAFF_MATCH';

/**
 * Identity signals for duplicate and self-referral detection (GRW-P2-B1): keyed hashes ONLY, one row per (kind, value hash, subject). A phone number, e-mail address or card fingerprint never
 * enters this table in the clear, and nothing here is ever sent to a referrer or an ad platform. Rows follow the subject erasure (growth_erase_subject deletes them).
 */
@Injectable()
export class ReferralIdentityService {
  constructor(private readonly prisma: PrismaService) {}

  async record(sub: string, kind: SignalKind, valueHash: string | null | undefined): Promise<void> {
    if (!valueHash) return;
    // idempotent and race-safe: two parallel requests of one person insert the same (kind, hash, sub) once (an upsert is not atomic under a race)
    await this.prisma.referralIdentitySignal.createMany({ data: [{ sub, kind, valueHash }], skipDuplicates: true });
  }
  async recordPhone(sub: string, phone: string | undefined): Promise<void> {
    if (!phone) return;
    await this.record(sub, 'PHONE', addressHash(phone));
    // the second keyed hash the Clinic can recompute (contracts 1.13.0 staffPhoneMatchHash, key derived from the shared marketplace client secret); never the phone itself
    const secret = cfg().kiorlyClientSecret;
    if (secret) await this.record(sub, 'STAFF_MATCH', staffPhoneMatchHash(phone, secret));
  }

  async hashesOf(sub: string, kind: SignalKind): Promise<string[]> { return (await this.prisma.referralIdentitySignal.findMany({ where: { sub, kind }, select: { valueHash: true } })).map((r) => r.valueHash); }
  /** The same value on a DIFFERENT subject. */
  async seenOnOtherSub(kind: SignalKind, valueHash: string, sub: string): Promise<boolean> { return !!(await this.prisma.referralIdentitySignal.findFirst({ where: { kind, valueHash, sub: { not: sub } }, select: { id: true } })); }
  async shared(kindOf: SignalKind, a: string, b: string): Promise<boolean> {
    const [x, y] = await Promise.all([this.hashesOf(a, kindOf), this.hashesOf(b, kindOf)]);
    return x.some((h) => y.includes(h));
  }
  async distinctSubsSince(kind: SignalKind, valueHash: string, since: Date): Promise<number> {
    return (await this.prisma.referralIdentitySignal.findMany({ where: { kind, valueHash, firstSeenAt: { gte: since } }, select: { sub: true }, distinct: ['sub'] })).length;
  }
}

/** contracts 1.13.0 `staffPhoneMatchHash` (vectors in kiorex-contracts fixtures/growth-v1.13): base64url(HMAC(HMAC(clientSecret, label), last ten digits)). */
export function staffPhoneMatchHash(phone: string, clientSecret: string): string {
  const d = phone.replace(/\D+/g, ''); const key = createHmac('sha256', clientSecret).update('kx-staff-phone-match-v1').digest();
  return createHmac('sha256', key).update(d.length > 10 ? d.slice(-10) : d).digest('base64url');
}

/** The Clinic exposes ONLY a boolean for keyed staff phone hashes (signed GET /marketplace/v1/growth/staff-phone-match, built in wave 9). `MockStaffPhoneMatch` stays the default (`STAFF_PHONE_MATCH_MODE=mock`). */
export interface StaffPhoneMatchPort { matches(providerClinicId: string, phoneHashes: readonly string[]): Promise<boolean> }
export const STAFF_PHONE_MATCH = 'GROWTH_STAFF_PHONE_MATCH';
@Injectable()
export class MockStaffPhoneMatch implements StaffPhoneMatchPort {
  /** Test and demo hook: provider ids whose staff phone hashes are set. */
  readonly staff = new Map<string, Set<string>>();
  async matches(providerClinicId: string, phoneHashes: readonly string[]): Promise<boolean> { const s = this.staff.get(providerClinicId); return !!s && phoneHashes.some((h) => s.has(h)); }
}

/** Real adapter (`STAFF_PHONE_MATCH_MODE=clinic`): asks the Clinic. Any failure answers "no match": fraud scoring must never block or fail a booking or a reward. */
@Injectable()
export class ClinicStaffPhoneMatch implements StaffPhoneMatchPort {
  private readonly log = new Logger('staff-phone-match');
  constructor(@Optional() @Inject(KiorlyClient) private readonly kiorly?: KiorlyClient) {}
  async matches(providerClinicId: string, phoneHashes: readonly string[]): Promise<boolean> {
    const hashes = [...new Set(phoneHashes)].slice(0, 20);
    if (!this.kiorly || !hashes.length) return false;
    try { return (await this.kiorly.staffPhoneMatch(providerClinicId, hashes)).data.match === true; } catch (e) { this.log.debug(`staff phone match unavailable (${(e as Error).message}); answering no match`); return false; }
  }
}
