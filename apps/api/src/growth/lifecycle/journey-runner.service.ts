import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { newId } from '../../common/ids';
import { ConsentService, MARKETING_CONSENT_PURPOSES } from '../../patient/patient-public';
import { PatientService } from '../../patient/patient-public';
import { PrismaService } from '../../prisma/prisma.service';
import { anchorPrefix, decodeAnchor, encodeAnchor, type Anchor } from './journey-anchor';
import type { JourneyDef, JourneyStep, StopFacts } from './journey.types';
import { journeyByKey, JOURNEYS } from './journeys';
import type { SegmentRule } from './lifecycle-segments';
import { LifecyclePolicyService, type LifecyclePolicy } from './lifecycle-policy.service';
import { LifecycleStateService } from './lifecycle-state.service';
import { SendGateService } from './send-gate.service';
import { withinWindowBudget } from './frequency-cap';
import type { GateChannel } from './send-gate';

const LEASE_MS = 5 * 60_000;
const MIN = 60_000;

export interface RunSummary { picked: number; sent: number; skipped: number; deferred: number; ended: number; errors: number }
export type EnrolResult = { enrolled: true; id: string } | { enrolled: false; reason: 'FLAG_OFF' | 'JOURNEY_DISABLED' | 'ALREADY_ENROLLED' | 'NO_PERSON' | 'NOT_ELIGIBLE' | 'UNKNOWN_JOURNEY' };

/**
 * GRW-P3-E hooks: journeys compiled from the builder (`def.custom`) are resolved, gated, counted and branched by the automation module through this narrow port. The runner stays the
 * single executor: a custom journey passes the SAME send gate, the same stop conditions and the same decision log as the eight built-in ones; the hooks can only make a send rarer.
 */
export interface CustomJourneyHooks {
  find(key: string): Promise<JourneyDef | undefined>;
  /** null = live; otherwise why the journey must not run (KILLED, RETIRED, AUTOMATION_FLAG_OFF). */
  liveReason(def: JourneyDef, market: string): Promise<string | null>;
  armOf(def: JourneyDef, experiment: string, sub: string, market: string): Promise<string>;
  expose(def: JourneyDef, experiment: string, sub: string, market: string): Promise<void>;
  passesSegments(segments: readonly SegmentRule[], sub: string, now: Date): Promise<boolean>;
  sendBudget(def: JourneyDef, sub: string, now: Date): Promise<'OK' | 'JOURNEY_CAP' | 'THIRTY_DAY_CAP'>;
  count(def: JourneyDef, kind: 'enrolled' | 'sent' | 'skipped' | 'ended', reason: string | undefined, now: Date): Promise<void>;
}

/** Next applicable step after `done` (steps whose `when` fails for the anchor are skipped), honouring the policy `maxSteps`. */
export function nextStepOf(def: JourneyDef, done: number, params: Record<string, unknown>, maxSteps?: number): JourneyStep | null {
  const applicable = def.steps.filter((s) => !s.when || s.when(params));
  const capped = maxSteps ? applicable.slice(0, maxSteps) : applicable;
  return capped.find((s) => s.step > done) ?? null;
}

/**
 * The journey runner (GRW-P2-E). Enrolment is idempotent per (person, journey, anchor); a due enrolment is leased (so two instances never send the same step), its stop conditions
 * are checked, then each channel of the step is tried in preference order through the send gate until one sends. Every try writes a decision with a reason code. Quiet hours move
 * the step, they never drop it. `growth.lifecycle_journeys` OFF ends running enrolments with reason FLAG_OFF; nothing here ever touches a clinical or transactional message of the layer.
 */
@Injectable()
export class JourneyRunnerService {
  private readonly log = new Logger('lifecycle-runner');
  private custom: CustomJourneyHooks | null = null;
  /** The automation module registers itself once at start (GRW-P3-E). */
  setCustomHooks(h: CustomJourneyHooks | null) { this.custom = h; }
  private defFor(key: string): Promise<JourneyDef | undefined> { const d = journeyByKey(key); return d ? Promise.resolve(d) : this.custom ? this.custom.find(key) : Promise.resolve(undefined); }
  /** The next step the person is in: a step tagged with an experiment arm applies only to the arm the person is in now (control when the experiment stopped or never enrolled them). */
  private async nextFor(def: JourneyDef, done: number, params: Record<string, unknown>, maxSteps: number | undefined, sub: string, market: string): Promise<JourneyStep | null> {
    let cur = done;
    for (let guard = 0; guard < 64; guard++) {
      const s = nextStepOf(def, cur, params, maxSteps);
      if (!s) return null;
      if (!s.branch?.length || !this.custom) return s;
      let inArm = true;
      for (const b of s.branch) if ((await this.custom.armOf(def, b.experiment, sub, market)) !== b.variant) { inArm = false; break; }
      if (inArm) return s;
      cur = s.step;
    }
    return null;
  }
  private cnt(def: JourneyDef, kind: 'enrolled' | 'sent' | 'skipped' | 'ended', reason: string | undefined, now: Date) { return def.custom && this.custom ? this.custom.count(def, kind, reason, now).catch(() => undefined) : Promise.resolve(); }
  constructor(
    private readonly prisma: PrismaService, private readonly gate: SendGateService, private readonly policies: LifecyclePolicyService, private readonly state: LifecycleStateService,
    @Inject(forwardRef(() => ConsentService)) private readonly consents: ConsentService, @Inject(forwardRef(() => PatientService)) private readonly patients: PatientService,
  ) {}

  async enrol(i: { sub: string; journeyKey: string; anchorId?: string; anchorAt?: Date; params?: Record<string, unknown>; now?: Date }): Promise<EnrolResult> {
    const def = await this.defFor(i.journeyKey);
    if (!def) return { enrolled: false, reason: 'UNKNOWN_JOURNEY' };
    const now = i.now ?? new Date();
    const profile = await this.patients.profileBySub(i.sub);
    if (!profile || (profile as { deletedAt?: Date | null }).deletedAt) return { enrolled: false, reason: 'NO_PERSON' };
    const market = profile.market ?? 'EG';
    if (!(await this.policies.journeysOn(market))) return { enrolled: false, reason: 'FLAG_OFF' };
    const policy = await this.policies.resolve(market);
    if (!this.policies.journeyPolicy(policy, def).enabled) return { enrolled: false, reason: 'JOURNEY_DISABLED' };
    if (def.custom) {
      if (def.custom.market !== market) return { enrolled: false, reason: 'NOT_ELIGIBLE' };
      const live = await this.custom!.liveReason(def, market);
      if (live) return { enrolled: false, reason: live === 'AUTOMATION_FLAG_OFF' ? 'FLAG_OFF' : 'JOURNEY_DISABLED' };
    }
    const params = i.params ?? {};
    const anchor: Anchor = { id: i.anchorId ?? 'self', at: (i.anchorAt ?? now).getTime(), params };
    const journeyKey = def.anchored || i.anchorId || Object.keys(params).length ? encodeAnchor(def.key, anchor) : def.key;
    // one enrolment per (person, journey, anchor): an earlier one with the same anchor id (whatever its parameters) or a plain one blocks a second
    const earlier = await this.prisma.lifecycleEnrollment.findFirst({ where: { sub: i.sub, journeyVersion: def.version, OR: [{ journeyKey: def.key }, { journeyKey: { startsWith: anchorPrefix(def.key, anchor.id) } }] }, select: { id: true } });
    if (earlier) return { enrolled: false, reason: 'ALREADY_ENROLLED' };
    const first = await this.nextFor(def, 0, params, policy.journeys[def.key]?.maxSteps, i.sub, market);
    if (!first) return { enrolled: false, reason: 'NOT_ELIGIBLE' };
    if (def.key === 'reengagement') {
      const f = await this.state.factsFor(i.sub, now);
      const stage = f ? (await this.prisma.patientLifecycle.findUnique({ where: { sub_market: { sub: i.sub, market } }, select: { stage: true } }))?.stage : null;
      if (stage !== 'DORMANT') return { enrolled: false, reason: 'NOT_ELIGIBLE' };
    }
    try {
      const row = await this.prisma.lifecycleEnrollment.create({ data: { id: newId('kx_lce'), sub: i.sub, market, journeyKey, journeyVersion: def.version, state: 'ACTIVE', step: 0, nextRunAt: new Date(anchor.at + first.delayMinutes * MIN) } });
      await this.cnt(def, 'enrolled', undefined, now);
      return { enrolled: true, id: row.id };
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') return { enrolled: false, reason: 'ALREADY_ENROLLED' };
      throw e;
    }
  }

  async stopFacts(sub: string, anchor: Anchor | null, now: Date): Promise<StopFacts> {
    const at = new Date(anchor?.at ?? now.getTime());
    const [profile, life, booked, review, dependant, intent, marketing] = await Promise.all([
      this.prisma.patientProfile.findUnique({ where: { sub }, select: { deletedAt: true } }),
      this.prisma.patientLifecycle.findFirst({ where: { sub }, select: { stage: true } }),
      this.prisma.bookingIntent.count({ where: { sub, createdAt: { gt: at }, status: { notIn: ['EXPIRED'] } } }),
      anchor && anchor.id !== 'self' ? this.prisma.review.count({ where: { bookingId: anchor.id } }) : Promise.resolve(0),
      this.prisma.dependant.count({ where: { guardianSub: sub, createdAt: { gt: at } } }),
      anchor && anchor.id !== 'self' ? this.prisma.bookingIntent.findUnique({ where: { id: anchor.id }, select: { status: true, depositStatus: true } }) : Promise.resolve(null),
      Promise.all(MARKETING_CONSENT_PURPOSES.map((p) => this.consents.hasConsent(sub, p))),
    ]);
    return {
      bookedAfterAnchor: booked > 0, reviewedAnchor: review > 0, stage: (life?.stage as StopFacts['stage']) ?? null, marketingAnyConsent: marketing.some(Boolean),
      rewardClosed: anchor?.params.closed === true, dependantAdded: dependant > 0, accountDeleted: !profile || !!profile.deletedAt,
      depositSettled: !intent || intent.depositStatus !== 'REQUIRED' || !['INTENT', 'HELD', 'PENDING_CLINIC'].includes(intent.status), leftDormant: !!life && life.stage !== 'DORMANT',
    };
  }

  private stopReason(step: JourneyStep, f: StopFacts): string | null {
    for (const c of step.stopOn) {
      if (c === 'MARKETING_CONSENT_LOST') { if (step.messageClass === 'MARKETING' && !f.marketingAnyConsent) return c; continue; }
      if (c === 'stage') continue;
      if (f[c] === true) return c;
    }
    return null;
  }

  private async end(id: string, reason: string, now: Date, def?: JourneyDef) {
    await this.prisma.lifecycleEnrollment.update({ where: { id }, data: { state: 'ENDED', endedAt: now, endReason: reason, nextRunAt: null } });
    if (def) await this.cnt(def, 'ended', reason.split(':')[0], now);
  }

  /** Process due enrolments (leased). Safe to call from several instances. */
  async runDue(now = new Date(), limit = 200): Promise<RunSummary> {
    const out: RunSummary = { picked: 0, sent: 0, skipped: 0, deferred: 0, ended: 0, errors: 0 };
    const due = await this.prisma.lifecycleEnrollment.findMany({ where: { state: 'ACTIVE', nextRunAt: { lte: now } }, orderBy: { nextRunAt: 'asc' }, take: limit });
    const policies = new Map<string, LifecyclePolicy>();
    for (const e of due) {
      const claim = await this.prisma.lifecycleEnrollment.updateMany({ where: { id: e.id, state: 'ACTIVE', nextRunAt: e.nextRunAt }, data: { nextRunAt: new Date(now.getTime() + LEASE_MS) } });
      if (claim.count !== 1) continue;
      out.picked++;
      try {
        if (!policies.has(e.market)) policies.set(e.market, await this.policies.resolve(e.market));
        await this.processOne(e, policies.get(e.market)!, now, out);
      } catch (err) {
        out.errors++; this.log.warn(`enrolment ${e.id} failed: ${(err as Error).message}`);
        await this.prisma.lifecycleEnrollment.updateMany({ where: { id: e.id, state: 'ACTIVE' }, data: { nextRunAt: new Date(now.getTime() + 15 * MIN) } }); // retry later, never lose the step
      }
    }
    return out;
  }

  private async processOne(e: { id: string; sub: string; market: string; journeyKey: string; journeyVersion: number; step: number }, policy: LifecyclePolicy, now: Date, out: RunSummary) {
    const { key, anchor } = decodeAnchor(e.journeyKey);
    const def = await this.defFor(key);
    if (!def) { await this.end(e.id, 'UNKNOWN_JOURNEY', now); out.ended++; return; }
    const params = anchor?.params ?? {};
    const market = e.market;
    // a custom journey: killed, retired or the automation flag OFF ends the enrolment before anything else (the kill switch must always win)
    if (def.custom) {
      const live = def.version !== e.journeyVersion ? 'RETIRED' : await this.custom!.liveReason(def, market);
      if (live) { const s0 = nextStepOf(def, e.step, params); if (s0) await this.gate.record({ sub: e.sub, market, def, step: s0, channel: s0.channels[0]!, reason: 'JOURNEY_DISABLED' }); await this.end(e.id, live, now, def); out.ended++; out.skipped++; return; }
    }
    const step = await this.nextFor(def, e.step, params, policy.journeys[def.key]?.maxSteps, e.sub, market);
    if (!step) { await this.end(e.id, 'COMPLETED', now, def); out.ended++; return; }
    if (!(await this.policies.journeysOn(market))) { await this.gate.record({ sub: e.sub, market, def, step, channel: step.channels[0]!, reason: 'JOURNEY_DISABLED' }); await this.end(e.id, 'FLAG_OFF', now, def); out.ended++; out.skipped++; return; }
    const jp = this.policies.journeyPolicy(policy, def);
    if (!jp.enabled) { await this.gate.record({ sub: e.sub, market, def, step, channel: step.channels[0]!, reason: 'JOURNEY_DISABLED' }); await this.end(e.id, 'JOURNEY_DISABLED', now, def); out.ended++; out.skipped++; return; }
    const facts = await this.stopFacts(e.sub, anchor, now);
    const stopped = this.stopReason(step, facts);
    if (stopped) { await this.gate.record({ sub: e.sub, market, def, step, channel: step.channels[0]!, reason: 'STOPPED' }); await this.end(e.id, `STOPPED:${stopped}`, now, def); out.ended++; out.skipped++; return; }
    if (def.custom) {
      // conditions are non-clinical segments checked now, at send time: false ends the journey
      if (step.segments?.length && !(await this.custom!.passesSegments(step.segments, e.sub, now))) { await this.gate.record({ sub: e.sub, market, def, step, channel: step.channels[0]!, reason: 'NOT_ELIGIBLE' }); await this.end(e.id, 'EXIT:CONDITION_FALSE', now, def); out.ended++; out.skipped++; return; }
      const budget = await this.custom!.sendBudget(def, e.sub, now); // per person per journey and per 30 days
      if (budget !== 'OK') { await this.gate.record({ sub: e.sub, market, def, step, channel: step.channels[0]!, reason: 'NOT_ELIGIBLE' }); await this.end(e.id, `EXIT:${budget}`, now, def); out.ended++; out.skipped++; return; }
    }
    if (def.key === 'reengagement' && step.messageClass === 'MARKETING') {
      const prior = await this.prisma.lifecycleMessageDecision.findMany({ where: { sub: e.sub, journeyKey: def.key, decision: 'SEND', at: { gte: new Date(now.getTime() - (def.params.windowDays ?? 90) * 86_400_000) } }, select: { at: true } });
      if (!withinWindowBudget(prior.map((p) => p.at), now.getTime(), def.params.maxPer90Days ?? 2, def.params.windowDays ?? 90)) { await this.gate.record({ sub: e.sub, market, def, step, channel: step.channels[0]!, reason: 'NOT_ELIGIBLE' }); await this.advance(e.id, def, step, params, policy, now, out, e.sub, market); out.skipped++; return; }
    }
    const marketingFlagOn = step.messageClass === 'MARKETING' ? await this.policies.marketingOn(market) : false;
    let deferUntil: number | null = null; let sent = false; let lastReason = 'NONE';
    for (const channel of step.channels as GateChannel[]) {
      const r = await this.gate.send({ sub: e.sub, def, step, channel, anchorId: anchor?.id ?? 'self', anchorParams: params, now, policy, marketingFlagOn, journeyEnabled: true });
      if (r.outcome.decision === 'SEND') { sent = true; out.sent++; break; }
      lastReason = r.outcome.reason;
      if (r.outcome.reason === 'QUIET_HOURS' && r.outcome.deferUntil) deferUntil = Math.min(deferUntil ?? Infinity, r.outcome.deferUntil);
      if (r.outcome.reason === 'MARKETING_FLAG_OFF' || r.outcome.reason === 'HOLDOUT' || r.outcome.reason === 'DUPLICATE') break; // the same for every channel: no point asking again
    }
    if (!sent && deferUntil !== null) { await this.prisma.lifecycleEnrollment.update({ where: { id: e.id }, data: { nextRunAt: new Date(deferUntil) } }); out.deferred++; return; }
    if (sent && def.custom && step.branch?.length) for (const b of step.branch) await this.custom!.expose(def, b.experiment, e.sub, market).catch(() => undefined);
    if (def.custom) {
      await this.cnt(def, sent ? 'sent' : 'skipped', sent ? undefined : lastReason, now);
      // suppression or a missing marketing consent ends an automation journey for this person (mandatory exit); the gate already recorded why
      if (!sent && step.messageClass === 'MARKETING' && (lastReason === 'SUPPRESSED' || lastReason === 'NO_CONSENT')) { await this.end(e.id, `EXIT:${lastReason}`, now, def); out.ended++; out.skipped++; return; }
    }
    if (!sent) out.skipped++;
    await this.advance(e.id, def, step, params, policy, now, out, e.sub, market);
  }

  private async advance(id: string, def: JourneyDef, done: JourneyStep, params: Record<string, unknown>, policy: LifecyclePolicy, now: Date, out: RunSummary, sub: string, market: string) {
    const next = await this.nextFor(def, done.step, params, policy.journeys[def.key]?.maxSteps, sub, market);
    if (!next) { await this.prisma.lifecycleEnrollment.update({ where: { id }, data: { step: done.step, state: 'ENDED', endedAt: now, endReason: 'COMPLETED', nextRunAt: null } }); await this.cnt(def, 'ended', 'COMPLETED', now); out.ended++; return; }
    await this.prisma.lifecycleEnrollment.update({ where: { id }, data: { step: done.step, nextRunAt: new Date(now.getTime() + next.delayMinutes * MIN) } });
  }

  /** The reminders already handled by engagement.service.ts are recorded as decisions so the log is the single place to look (no second send). */
  async recordLegacyReminder(i: { sub: string; market?: string; step: 'REMINDER_24H' | 'REMINDER_2H' | 'REVIEW_INVITATION'; decision: 'SEND' | 'SKIP'; reason: string; messageLogId?: string }) {
    return this.prisma.lifecycleMessageDecision.create({ data: { id: newId('kx_lmd'), sub: i.sub, market: i.market ?? 'EG', journeyKey: 'reminders', step: i.step === 'REMINDER_24H' ? 101 : i.step === 'REMINDER_2H' ? 102 : 103, messageClass: 'TRANSACTIONAL', channel: 'ALL', templateKey: i.step, decision: i.decision, reason: i.reason, messageLogId: i.messageLogId ?? null } });
  }

  catalogue() { return JOURNEYS; }
}
