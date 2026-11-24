import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { newId } from '../../common/ids';
import { FlagsService } from '../../control-plane/control-plane-public';
import { PrismaService } from '../../prisma/prisma.service';
import { ExposureService, subUnit } from '../experiments/experiments-public';
import type { CustomJourneyHooks } from '../lifecycle/journey-runner.service';
import { JourneyRunnerService } from '../lifecycle/journey-runner.service';
import type { JourneyDef } from '../lifecycle/journey.types';
import { inSegment, type SegmentFacts, type SegmentRule } from '../lifecycle/lifecycle-segments';
import { AUTOMATION_FLAG } from './automation-flags';
import { compileGraph } from './journey.compiler';
import { AUTOMATION_POLICY, BRANCH_SURFACE } from './journey.graph';
import { validateGraph } from './journey.validator';

const DAY = 86_400_000;
const ref = (key: string) => { const m = /^auto\.([a-z]{2})\.([a-z0-9-]+)$/.exec(key); return m ? { market: m[1]!.toUpperCase(), key: m[2]! } : null; };

/**
 * What the P2-E runner asks the automation module (GRW-P3-E). Every answer can only make a send rarer: the journey must be live (published, not killed, flag ON), the person must pass the
 * non-clinical conditions, stay inside the per-person caps and, for a branch, be in the arm the experiment assigns now. The compiled journey of a published definition never changes, so it
 * is cached by definition id; liveness is read from the row on every evaluation (a kill switch is seen on the very next one).
 */
@Injectable()
export class AutomationHooksService implements CustomJourneyHooks, OnModuleInit {
  private readonly log = new Logger('automation-hooks');
  private readonly compiled = new Map<string, JourneyDef>();
  constructor(private readonly prisma: PrismaService, private readonly flags: FlagsService, private readonly exposure: ExposureService, private readonly runner: JourneyRunnerService) {}
  onModuleInit() { this.runner.setCustomHooks(this); }

  async find(key: string): Promise<JourneyDef | undefined> {
    const r = ref(key); if (!r) return undefined;
    const row = (await this.prisma.lifecycleJourneyDefinition.findFirst({ where: { market: r.market, key: r.key, status: 'PUBLISHED' } }))
      ?? (await this.prisma.lifecycleJourneyDefinition.findFirst({ where: { market: r.market, key: r.key, status: 'RETIRED' }, orderBy: { version: 'desc' } }));
    if (!row) return undefined;
    const hit = this.compiled.get(row.id); if (hit) return hit;
    const v = validateGraph(row.graph);
    if (!v.valid) { this.log.warn(`published definition ${row.id} no longer validates: ${v.errors[0]?.code}`); return undefined; } // fail closed
    const def = compileGraph(v.graph, { definitionId: row.id, market: row.market, key: row.key, version: row.version, name: row.name }).def;
    this.compiled.set(row.id, def);
    return def;
  }

  async liveReason(def: JourneyDef, market: string): Promise<string | null> {
    const row = await this.prisma.lifecycleJourneyDefinition.findUnique({ where: { id: def.custom!.definitionId }, select: { status: true, killedAt: true } });
    if (!row) return 'RETIRED';
    if (row.killedAt) return 'KILLED';
    if (row.status !== 'PUBLISHED') return 'RETIRED';
    if (!(await this.flags.isEnabled(AUTOMATION_FLAG, { market }).catch(() => false))) return 'AUTOMATION_FLAG_OFF';
    return null;
  }

  async armOf(_def: JourneyDef, experiment: string, sub: string, market: string): Promise<string> {
    const lc = await this.prisma.patientLifecycle.findFirst({ where: { sub, market }, select: { language: true, platform: true } });
    const list = await this.exposure.assignments(subUnit(sub), { market, locale: lc?.language, platform: lc?.platform || undefined }, BRANCH_SURFACE);
    return list.find((a) => a.experiment === experiment)?.variant ?? 'control';
  }
  async expose(_def: JourneyDef, experiment: string, sub: string, market: string): Promise<void> {
    const lc = await this.prisma.patientLifecycle.findFirst({ where: { sub, market }, select: { language: true, platform: true } });
    await this.exposure.expose(subUnit(sub), { market, locale: lc?.language, platform: lc?.platform || undefined }, experiment);
  }

  /** Facts of ONE person for the conditions. A person with no lifecycle row fails every condition (unknown facts never pass). */
  async factsOf(sub: string, now: Date): Promise<SegmentFacts | null> {
    const l = await this.prisma.patientLifecycle.findFirst({ where: { sub } });
    if (!l) return null;
    return {
      stage: l.stage, platform: l.platform, language: l.language, city: l.city, district: l.district, hasDependants: l.hasDependants, referralStatus: l.referralStatus,
      registeredDaysAgo: Math.max(0, Math.floor((now.getTime() - l.registeredAt.getTime()) / DAY)), lastBookingDaysAgo: l.lastBookingAt ? Math.max(0, Math.floor((now.getTime() - l.lastBookingAt.getTime()) / DAY)) : null,
    };
  }
  async passesSegments(segments: readonly SegmentRule[], sub: string, now: Date) {
    const f = await this.factsOf(sub, now); if (!f) return false;
    return segments.every((s) => inSegment(s, f));
  }

  async sendBudget(def: JourneyDef, sub: string, now: Date): Promise<'OK' | 'JOURNEY_CAP' | 'THIRTY_DAY_CAP'> {
    const own = await this.prisma.lifecycleMessageDecision.count({ where: { sub, journeyKey: def.key, decision: 'SEND' } });
    if (own >= (def.custom?.maxSends ?? AUTOMATION_POLICY.maxSendsPerJourney)) return 'JOURNEY_CAP';
    const recent = await this.prisma.lifecycleMessageDecision.count({ where: { sub, journeyKey: { startsWith: 'auto.' }, decision: 'SEND', at: { gte: new Date(now.getTime() - 30 * DAY) } } });
    return recent >= AUTOMATION_POLICY.maxSendsPer30Days ? 'THIRTY_DAY_CAP' : 'OK';
  }

  /** Counts only: one row per journey and day; never a person, never a message id. */
  async count(def: JourneyDef, kind: 'enrolled' | 'sent' | 'skipped' | 'ended', reason: string | undefined, now: Date): Promise<void> {
    const day = now.toISOString().slice(0, 10); const id = def.custom!.definitionId; const market = def.custom!.market;
    const inc = { enrolled: kind === 'enrolled' ? 1 : 0, sent: kind === 'sent' ? 1 : 0, skipped: kind === 'skipped' ? 1 : 0, ended: kind === 'ended' ? 1 : 0 };
    await this.prisma.$executeRaw`INSERT INTO "LifecycleJourneyRunLog" ("id","definitionId","market","day","enrolled","sent","skipped","ended","byReason","updatedAt")
      VALUES (${newId('kx_jrl')}, ${id}, ${market}, ${day}::date, ${inc.enrolled}, ${inc.sent}, ${inc.skipped}, ${inc.ended}, '{}'::jsonb, now())
      ON CONFLICT ("definitionId","day") DO UPDATE SET "enrolled" = "LifecycleJourneyRunLog"."enrolled" + ${inc.enrolled}, "sent" = "LifecycleJourneyRunLog"."sent" + ${inc.sent}, "skipped" = "LifecycleJourneyRunLog"."skipped" + ${inc.skipped}, "ended" = "LifecycleJourneyRunLog"."ended" + ${inc.ended}, "updatedAt" = now()`;
    if (reason) {
      await this.prisma.$executeRaw`UPDATE "LifecycleJourneyRunLog" SET "byReason" = jsonb_set("byReason", ARRAY[${reason}]::text[], to_jsonb(COALESCE(("byReason"->>${reason})::int, 0) + 1)) WHERE "definitionId" = ${id} AND "day" = ${day}::date`;
    }
  }
}
