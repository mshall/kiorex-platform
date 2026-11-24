import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JourneyRunnerService } from './journey-runner.service';
import { LifecycleStateService } from './lifecycle-state.service';

const H = 3_600_000;

/**
 * Event to enrolment (GRW-P2-E). The facts live in tables the platform already owns, so the triggers are windowed scans that are IDEMPOTENT by construction (an enrolment is unique per
 * person, journey and anchor): a missed run is repaired by the next one, a double run changes nothing. Events that other modules own (reward and referral outcomes) arrive through
 * `signal()` on the lifecycle façade instead. Nothing here reads what a visit was for.
 *   registration -> welcome | hold expired -> booking-recovery | deposit pending -> reminders | completed -> post-visit (+ stage) | first attended -> referral-invite, family-onboarding | stage DORMANT -> reengagement
 */
@Injectable()
export class LifecycleTriggersService {
  private readonly log = new Logger('lifecycle-triggers');
  constructor(private readonly prisma: PrismaService, private readonly runner: JourneyRunnerService, private readonly state: LifecycleStateService) {}

  async scan(now = new Date()): Promise<Record<string, number>> {
    const n = { registered: 0, holdExpired: 0, depositPending: 0, completed: 0, firstAttended: 0, dormant: 0, enrolled: 0 };
    const enrol = async (r: ReturnType<JourneyRunnerService['enrol']>) => { const x = await r; if (x.enrolled) n.enrolled++; return x; };

    for (const p of await this.prisma.patientProfile.findMany({ where: { deletedAt: null, createdAt: { gte: new Date(now.getTime() - 48 * H) } }, select: { sub: true, createdAt: true }, take: 500 })) {
      await this.state.refresh(p.sub, now); n.registered++;
      await enrol(this.runner.enrol({ sub: p.sub, journeyKey: 'welcome', anchorAt: p.createdAt, params: {}, now }));
    }
    for (const b of await this.prisma.bookingIntent.findMany({ where: { status: 'EXPIRED', updatedAt: { gte: new Date(now.getTime() - 6 * H) } }, select: { id: true, sub: true, holdExpiresAt: true, updatedAt: true }, take: 500 })) {
      n.holdExpired++;
      await enrol(this.runner.enrol({ sub: b.sub, journeyKey: 'booking-recovery', anchorId: b.id, anchorAt: b.holdExpiresAt ?? b.updatedAt, now }));
    }
    for (const b of await this.prisma.bookingIntent.findMany({ where: { status: { in: ['HELD', 'PENDING_CLINIC', 'INTENT'] }, depositStatus: 'REQUIRED', startsAt: { gt: new Date(now.getTime() + 2 * H), lt: new Date(now.getTime() + 48 * H) } }, select: { id: true, sub: true, startsAt: true }, take: 500 })) {
      n.depositPending++;
      await enrol(this.runner.enrol({ sub: b.sub, journeyKey: 'reminders', anchorId: b.id, anchorAt: new Date(b.startsAt.getTime() - 24 * H), params: { time: b.startsAt.toISOString() }, now }));
    }
    const done = await this.prisma.bookingIntent.findMany({ where: { status: 'COMPLETED', updatedAt: { gte: new Date(now.getTime() - 72 * H) } }, select: { id: true, sub: true, updatedAt: true }, take: 500 });
    for (const b of done) {
      n.completed++;
      await this.state.refresh(b.sub, now);
      await enrol(this.runner.enrol({ sub: b.sub, journeyKey: 'post-visit', anchorId: b.id, anchorAt: b.updatedAt, now }));
      const total = await this.prisma.bookingIntent.count({ where: { sub: b.sub, status: 'COMPLETED' } });
      if (total === 1) {
        n.firstAttended++;
        await enrol(this.runner.enrol({ sub: b.sub, journeyKey: 'referral-invite', anchorAt: b.updatedAt, now }));
        await enrol(this.runner.enrol({ sub: b.sub, journeyKey: 'family-onboarding', anchorAt: b.updatedAt, now }));
      }
    }
    for (const l of await this.prisma.patientLifecycle.findMany({ where: { stage: 'DORMANT', stageAt: { gte: new Date(now.getTime() - 24 * H) } }, select: { sub: true, stageAt: true }, take: 500 })) {
      n.dormant++;
      await enrol(this.runner.enrol({ sub: l.sub, journeyKey: 'reengagement', anchorId: `d${Math.floor(l.stageAt.getTime() / 86_400_000)}`, anchorAt: l.stageAt, now }));
    }
    return n;
  }
}
