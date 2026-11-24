import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JourneyRunnerService } from '../lifecycle/journey-runner.service';

const H = 3_600_000;

/**
 * Event to enrolment for published builder journeys (GRW-P3-E). Same idea as the P2-E scan: windowed reads of facts the platform already owns (ids and times only, never what a visit was
 * for), idempotent because an enrolment is unique per (person, journey, anchor). A killed, retired or flag-OFF journey is skipped by `runner.enrol`. Nothing here sends anything.
 */
@Injectable()
export class AutomationTriggersService {
  constructor(private readonly prisma: PrismaService, private readonly runner: JourneyRunnerService) {}

  async scan(now = new Date()): Promise<Record<string, number>> {
    const out: Record<string, number> = { journeys: 0, anchors: 0, enrolled: 0 };
    const defs = await this.prisma.lifecycleJourneyDefinition.findMany({ where: { status: 'PUBLISHED', killedAt: null }, select: { market: true, key: true, graph: true } });
    for (const d of defs) {
      const trig = (d.graph as { nodes: Array<{ type: string; event?: string }> }).nodes.find((n) => n.type === 'TRIGGER')?.event;
      if (!trig) continue;
      out.journeys!++;
      const jk = `auto.${d.market.toLowerCase()}.${d.key}`;
      for (const a of await this.anchors(trig, d.market, now)) {
        out.anchors!++;
        const r = await this.runner.enrol({ sub: a.sub, journeyKey: jk, anchorId: a.id, anchorAt: a.at, now });
        if (r.enrolled) out.enrolled!++;
      }
    }
    return out;
  }

  /** The (person, anchor id, time) triples of one event inside its scan window. Ids are opaque and non-clinical. */
  private async anchors(event: string, market: string, now: Date): Promise<Array<{ sub: string; id: string; at: Date }>> {
    const since = (h: number) => new Date(now.getTime() - h * H);
    switch (event) {
      case 'REGISTERED': return (await this.prisma.patientProfile.findMany({ where: { deletedAt: null, market, createdAt: { gte: since(48) } }, select: { sub: true, createdAt: true }, take: 500 })).map((p) => ({ sub: p.sub, id: 'reg', at: p.createdAt }));
      case 'BOOKING_STARTED': return (await this.prisma.bookingIntent.findMany({ where: { createdAt: { gte: since(6) } }, select: { id: true, sub: true, createdAt: true }, take: 500 })).map((b) => ({ sub: b.sub, id: b.id, at: b.createdAt }));
      case 'BOOKING_EXPIRED': return (await this.prisma.bookingIntent.findMany({ where: { status: 'EXPIRED', updatedAt: { gte: since(6) } }, select: { id: true, sub: true, holdExpiresAt: true, updatedAt: true }, take: 500 })).map((b) => ({ sub: b.sub, id: b.id, at: b.holdExpiresAt ?? b.updatedAt }));
      case 'VISIT_COMPLETED': return (await this.prisma.bookingIntent.findMany({ where: { status: 'COMPLETED', updatedAt: { gte: since(72) } }, select: { id: true, sub: true, updatedAt: true }, take: 500 })).map((b) => ({ sub: b.sub, id: b.id, at: b.updatedAt }));
      case 'REFERRAL_QUALIFIED': return (await this.prisma.referralRelationship.findMany({ where: { market, status: 'QUALIFIED', qualifiedAt: { gte: since(72) } }, select: { id: true, referrerSub: true, qualifiedAt: true }, take: 500 })).map((r) => ({ sub: r.referrerSub, id: r.id, at: r.qualifiedAt! }));
      case 'REWARD_EVENT': return (await this.prisma.rewardLot.findMany({ where: { market, createdAt: { gte: since(72) } }, select: { id: true, sub: true, createdAt: true }, take: 500 })).map((r) => ({ sub: r.sub, id: r.id, at: r.createdAt }));
      case 'CONSENT_CHANGED': return (await this.prisma.consentRecord.findMany({ where: { createdAt: { gte: since(6) } }, select: { id: true, sub: true, createdAt: true }, take: 500 })).map((c) => ({ sub: c.sub, id: c.id, at: c.createdAt }));
      case 'STAGE_DORMANT': return (await this.prisma.patientLifecycle.findMany({ where: { market, stage: 'DORMANT', stageAt: { gte: since(24) } }, select: { sub: true, stageAt: true }, take: 500 })).map((l) => ({ sub: l.sub, id: `d${Math.floor(l.stageAt.getTime() / 86_400_000)}`, at: l.stageAt }));
      default: return [];
    }
  }
}
