import { Inject, Injectable } from '@nestjs/common';
import { subRefOf } from '../../common/privacy-hash';
import { PrismaService } from '../../prisma/prisma.service';
import { RewardPolicyService } from '../rewards/reward-policy.service';
import { evaluateFraud, type FraudAction, type FraudFacts, type FraudSignal, type FraudStage } from './referral-fraud.rules';
import { ReferralIdentityService, STAFF_PHONE_MATCH, type StaffPhoneMatchPort } from './referral-identity.service';

const DAY = 86_400_000;

/**
 * Gathers the facts of the referral fraud rules from the tables (hashes and counts only) and records the signals on GrowthFraudSignal (rule id, a keyed hash of the subject, a score, the relationship
 * id as evidence). Enforcement follows the flag growth.referral_fraud_enforce (shipped ON; OFF = shadow mode: signals are recorded, nothing is rejected or held). A signal never changes an attribution decision or a commission.
 */
@Injectable()
export class ReferralFraudService {
  constructor(private readonly prisma: PrismaService, private readonly identity: ReferralIdentityService, private readonly policy: RewardPolicyService, @Inject(STAFF_PHONE_MATCH) private readonly staff: StaffPhoneMatchPort) {}

  async evaluate(stage: FraudStage, facts: FraudFacts) {
    const { rules } = await this.policy.referralRules();
    return evaluateFraud(stage, facts, { enforce: await this.policy.fraudEnforced(), paymentFingerprint: rules.signals.paymentFingerprint, deviceSignal: rules.signals.deviceSignal });
  }

  /** One OPEN signal per (rule, relationship): a re-evaluation never piles up duplicates. */
  async record(signals: readonly FraudSignal[], o: { subject: string; evidenceRef: string; score: number }) {
    for (const s of signals) {
      const exists = await this.prisma.growthFraudSignal.findFirst({ where: { ruleId: s.ruleId, evidenceRef: o.evidenceRef, reviewStatus: 'OPEN' }, select: { id: true } });
      if (!exists) await this.prisma.growthFraudSignal.create({ data: { ruleId: s.ruleId, subjectHash: subRefOf(o.subject), score: s.score, evidenceRef: o.evidenceRef } });
    }
  }

  async claimFacts(i: { referrerSub: string; refereeSub: string; refereePhoneHash?: string; ipHash?: string; touch?: { id: string; occurredAt: Date; ipHash: string } | null; now: Date }): Promise<FraudFacts> {
    const refPhone = (await this.identity.hashesOf(i.referrerSub, 'PHONE'))[0];
    const phoneOther = i.refereePhoneHash ? await this.identity.seenOnOtherSub('PHONE', i.refereePhoneHash, i.refereeSub) : false;
    const payShared = await this.identity.shared('PAY_FINGERPRINT', i.referrerSub, i.refereeSub);
    const deviceShared = await this.identity.shared('DEVICE', i.referrerSub, i.refereeSub);
    const ip = i.ipHash ? await this.identity.distinctSubsSince('IP24', i.ipHash, new Date(i.now.getTime() - DAY)) : 0;
    const botFlag = i.touch ? !!(await this.prisma.growthFraudSignal.findFirst({ where: { evidenceRef: i.touch.id }, select: { id: true } })) : false;
    return {
      referrerSub: i.referrerSub, refereeSub: i.refereeSub,
      phoneHash: { referrer: refPhone, referee: i.refereePhoneHash },
      ...(payShared ? { paymentFingerprint: { referrer: 'shared', referee: 'shared' } } : {}), ...(deviceShared ? { deviceHash: { referrer: 'shared', referee: 'shared' } } : {}),
      refereePhoneSeenOnOtherSub: phoneOther, signupsFromIpPrefix24h: ip, touchFlaggedBot: botFlag,
      ...(i.touch ? { secondsClaimToSignup: Math.max(0, Math.round((i.now.getTime() - i.touch.occurredAt.getTime()) / 1000)) } : {}),
    };
  }

  /** Facts at booking and qualification time: velocity of the referrer, clustering of referees, the booked provider, cancellation behaviour. */
  async qualificationFacts(rel: { id: string; referrerSub: string; refereeSub: string; createdAt: Date; qualifiedAt: Date | null }, booking: { id: string; clinicId: string; providerId: string; status: string; createdAt: Date; startsAt: Date; endsAt: Date; terminalAt: Date | null; depositStatus: string } | null, now: Date): Promise<FraudFacts> {
    const siblings = await this.prisma.referralRelationship.findMany({ where: { referrerSub: rel.referrerSub, createdAt: { gte: new Date(now.getTime() - 30 * DAY) } }, select: { id: true, refereeSub: true, firstBookingId: true } });
    const sibBookings = await this.prisma.bookingIntent.findMany({ where: { id: { in: siblings.map((s) => s.firstBookingId ?? '-') } }, select: { id: true, providerId: true, createdAt: true, sub: true } });
    const byProvider = new Map<string, number>();
    for (const b of sibBookings) byProvider.set(b.providerId, (byProvider.get(b.providerId) ?? 0) + 1);
    const top = Math.max(0, ...byProvider.values());
    const t0 = sibBookings.length ? Math.min(...sibBookings.map((b) => b.createdAt.getTime())) : 0;
    const refPay = await this.identity.hashesOf(rel.referrerSub, 'PAY_FINGERPRINT');
    const reefPhones = await this.identity.hashesOf(rel.refereeSub, 'PHONE');
    const refPhones = await this.identity.hashesOf(rel.referrerSub, 'PHONE');
    const staffMatch = booking ? await this.staff.matches(booking.clinicId, [...reefPhones, ...refPhones]) : false;
    const checkedIn = booking ? !!(await this.prisma.bookingEvent.findFirst({ where: { bookingId: booking.id, kind: 'STATE', toStatus: { in: ['CHECKED_IN', 'COMPLETED'] } }, select: { id: true } })) : true;
    const slotRebooks = booking ? await this.prisma.bookingIntent.count({ where: { sub: rel.refereeSub, providerId: booking.providerId, startsAt: booking.startsAt, status: 'CANCELLED' } }) : 0;
    const refRefunded = booking?.depositStatus === 'REFUNDED';
    return {
      referrerSub: rel.referrerSub, refereeSub: rel.refereeSub,
      refereesInWindow: siblings.length, refereesWithSameProvider: top,
      firstBookingTimesMinutes: sibBookings.map((b) => Math.round((b.createdAt.getTime() - t0) / 60_000)),
      refereesSharingPaymentFingerprint: refPay.length && (await this.identity.shared('PAY_FINGERPRINT', rel.referrerSub, rel.refereeSub)) ? 2 : 0,
      staffPhoneMatch: staffMatch, topProviderShare: sibBookings.length >= 4 ? top / sibBookings.length : 0,
      completionWithoutCheckIn: booking?.status === 'COMPLETED' ? !checkedIn : false,
      // visitMinutes is not fed: the Clinic sends no check-in and check-out times yet (gap in GROWTH.md), so the RF_FAKE_BOOKING short-visit rule is covered by unit tests only
     
      depositRefundedAfterReward: !!rel.qualifiedAt && refRefunded, repeatedSlotCancelRebook: slotRebooks >= 2,
      refereeCancelledInHold: booking ? ['CANCELLED', 'EXPIRED'].includes(booking.status) || refRefunded : false,
      cancelledAfterRewardInWindow: !!rel.qualifiedAt && !!booking && booking.status === 'CANCELLED',
    };
  }
}

export type { FraudAction };
