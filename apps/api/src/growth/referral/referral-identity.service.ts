import { Injectable } from '@nestjs/common';
import { addressHash } from '../../common/privacy-hash';
import { PrismaService } from '../../prisma/prisma.service';

export type SignalKind = 'PHONE' | 'PAY_FINGERPRINT' | 'DEVICE' | 'IP24';

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
  recordPhone(sub: string, phone: string | undefined) { return phone ? this.record(sub, 'PHONE', addressHash(phone)) : Promise.resolve(); }

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

/** The Clinic exposes ONLY a salted hash of staff phone numbers per provider (signed GET /growth/staff-phone-match, a Clinic-side item of lane CM, not built yet). Until it exists the port answers "no match" in mock mode. */
export interface StaffPhoneMatchPort { matches(providerClinicId: string, phoneHashes: readonly string[]): Promise<boolean> }
export const STAFF_PHONE_MATCH = 'GROWTH_STAFF_PHONE_MATCH';
@Injectable()
export class MockStaffPhoneMatch implements StaffPhoneMatchPort {
  /** Test and demo hook: provider ids whose staff phone hashes are set. */
  readonly staff = new Map<string, Set<string>>();
  async matches(providerClinicId: string, phoneHashes: readonly string[]): Promise<boolean> { const s = this.staff.get(providerClinicId); return !!s && phoneHashes.some((h) => s.has(h)); }
}
