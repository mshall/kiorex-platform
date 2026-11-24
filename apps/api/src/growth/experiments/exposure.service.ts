import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { FlagsService } from '../../control-plane/control-plane-public';
import { PrismaService } from '../../prisma/prisma.service';
import { GROWTH_FLAG } from '../growth-flags';
import { assign, unitHashOf } from './assignment';
import { isEligible, type EligibilityContext } from './eligibility';
import type { Eligibility, UnitKind } from './experiment.types';
import { surfaceByKey } from './surfaces';

/** The unit a request resolves to. `none` = no assignment: control, nothing recorded (no consent and no session). */
export type Unit = { kind: UnitKind; key: string; sub?: string } | null;
export interface PublicAssignment { experiment: string; surface: string; variant: string; flagKey: string | null }

export const sha256hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
/** Unit key conventions: visitor `v:<kxv>`, person `s:<sub>`. The unit hash adds the experiment salt, so units cannot be joined across experiments. */
export const visitorUnit = (visitorKey: string): Unit => ({ kind: 'VISITOR', key: `v:${visitorKey}` });
export const subUnit = (sub: string): Unit => ({ kind: 'SUB', key: `s:${sub}`, sub });

@Injectable()
export class ExposureService {
  constructor(private readonly prisma: PrismaService, private readonly flags: FlagsService) {}

  /** Flag OFF = every visitor gets the control experience and nothing is written (catalogue `whenOff`). */
  enabled(market: string) { return this.flags.isEnabled(GROWTH_FLAG.EXPERIMENTS, { market }).catch(() => false); }

  /** Assignments of one unit for the RUNNING experiments of a market (optionally one surface). Only experiments that ENROL the unit are listed; anything else renders control. */
  async assignments(unit: Unit, ctx: EligibilityContext, surface?: string): Promise<PublicAssignment[]> {
    if (!unit || !(await this.enabled(ctx.market))) return [];
    const rows = await this.prisma.growthExperiment.findMany({ where: { market: ctx.market, status: 'RUNNING', ...(surface ? { surface } : {}) }, orderBy: { startedAt: 'asc' }, take: 20 });
    const out: PublicAssignment[] = [];
    for (const e of rows) {
      const def = surfaceByKey(e.surface);
      if (!def || !def.units.includes(unit.kind)) continue; // a surface lists which units it may use; an unknown surface (registry changed) renders control
      if (!isEligible(e.eligibility as Eligibility, ctx)) continue;
      const a = assign({ variants: e.variants as never, allocationBp: e.allocationBp, salt: e.salt, status: e.status }, unit.key);
      if (a.enrolled) out.push({ experiment: e.key, surface: e.surface, variant: a.variant, flagKey: e.flagKey });
    }
    return out;
  }

  /**
   * Record that the unit SAW its variant. The variant is recomputed here from the unit, never taken from the client. Idempotent on (experiment, unit hash): a repeat is a no-op.
   * Returns `recorded: false` for anything that is not an enrolment (flag OFF, stopped, holdback, ineligible, unknown experiment).
   */
  async expose(unit: Unit, ctx: EligibilityContext, experimentKey: string, now = new Date()): Promise<{ recorded: boolean; variant: string | null }> {
    if (!unit || !(await this.enabled(ctx.market))) return { recorded: false, variant: null };
    const e = await this.prisma.growthExperiment.findUnique({ where: { market_key: { market: ctx.market, key: experimentKey } } });
    if (!e || e.status !== 'RUNNING') return { recorded: false, variant: null };
    const def = surfaceByKey(e.surface);
    if (!def || !def.units.includes(unit.kind) || !isEligible(e.eligibility as Eligibility, ctx)) return { recorded: false, variant: null };
    const a = assign({ variants: e.variants as never, allocationBp: e.allocationBp, salt: e.salt, status: e.status }, unit.key);
    if (!a.enrolled || !a.unitHash) return { recorded: false, variant: a.variant };
    const res = await this.prisma.growthExperimentExposure.createMany({
      data: [{ experimentId: e.id, market: e.market, day: new Date(now.toISOString().slice(0, 10)), variant: a.variant, unitKind: unit.kind, unitHash: a.unitHash, subRef: unit.kind === 'SUB' && unit.sub ? sha256hex(unit.sub) : null, firstAt: now }],
      skipDuplicates: true,
    });
    return { recorded: res.count === 1, variant: a.variant };
  }

  unitHashFor(salt: string, unitKey: string) { return unitHashOf(salt, unitKey); }
}
