import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '../../prisma/generated/client';
import { unitHashOf } from './assignment';
import { EXPERIMENT_POLICY, metricByKey, type GuardrailSpec } from './experiment.types';
import type { DayRow } from './stats/evaluate';

const DAY = 86_400_000;

/**
 * Daily rollup of one experiment (GRW-P3-A). Exposure day is the cohort day: `exposures` counts units first exposed that day, `conversions` those of them that did the primary event within
 * the conversion window after the exposure, `guardrailCounts[metric]` likewise for each guardrail. An event counts only when it can be tied to the SAME unit key:
 *  - visitor facts (event.visitorKey) match `v:<visitorKey>` units;
 *  - booking facts (event.bookingId) go through BookingIntent.sub to `s:<sub>` units and, through the visitor keys the same sub was linked to by consented touches, to `v:<visitorKey>` units.
 * No other join key exists (no fingerprint, no phone, no IP). Unmatched events are dropped. Idempotent: the experiment's daily rows are rebuilt from the exposure and event tables.
 */
@Injectable()
export class ExperimentRollupService {
  constructor(private readonly prisma: PrismaService) {}

  async rollup(experimentId: string, now = new Date()): Promise<DayRow[]> {
    const e = await this.prisma.growthExperiment.findUniqueOrThrow({ where: { id: experimentId } });
    const exposures = await this.prisma.growthExperimentExposure.findMany({ where: { experimentId }, select: { unitHash: true, variant: true, day: true, firstAt: true } });
    const byHash = new Map(exposures.map((x) => [x.unitHash, x]));
    const metrics = [e.primaryMetric, ...((e.guardrails as unknown as GuardrailSpec[]) ?? []).map((g) => g.metric)];
    const hits = new Map<string, Set<string>>(); // metric -> unit hashes that converted
    const windowMs = EXPERIMENT_POLICY.conversionWindowDays * DAY;
    for (const mk of new Set(metrics)) {
      const m = metricByKey(mk); if (!m) continue;
      const set = new Set<string>(); hits.set(mk, set);
      const events = await this.prisma.growthEvent.findMany({ where: { market: e.market, name: m.event, occurredAt: { gte: e.startedAt ?? e.createdAt, lte: now } }, select: { visitorKey: true, bookingId: true, occurredAt: true }, take: 200_000 });
      const subOfBooking = new Map<string, string>();
      const bookingIds = [...new Set(events.map((v) => v.bookingId).filter((b): b is string => !!b))];
      for (let i = 0; i < bookingIds.length; i += 1000) for (const b of await this.prisma.bookingIntent.findMany({ where: { id: { in: bookingIds.slice(i, i + 1000) } }, select: { id: true, sub: true } })) subOfBooking.set(b.id, b.sub);
      const subs = [...new Set(subOfBooking.values())];
      const linked = new Map<string, string[]>();
      for (let i = 0; i < subs.length; i += 1000) for (const t of await this.prisma.growthTouchpoint.findMany({ where: { sub: { in: subs.slice(i, i + 1000) }, visitorKey: { not: null } }, select: { sub: true, visitorKey: true }, distinct: ['sub', 'visitorKey'] })) { const l = linked.get(t.sub!) ?? []; l.push(t.visitorKey!); linked.set(t.sub!, l); }
      for (const ev of events) {
        const keys: string[] = [];
        if (ev.visitorKey) keys.push(`v:${ev.visitorKey}`);
        if (ev.bookingId) { const sub = subOfBooking.get(ev.bookingId); if (sub) { keys.push(`s:${sub}`); for (const vk of linked.get(sub) ?? []) keys.push(`v:${vk}`); } }
        for (const k of keys) {
          const h = unitHashOf(e.salt, k); const x = byHash.get(h);
          if (x && ev.occurredAt >= x.firstAt && ev.occurredAt.getTime() <= x.firstAt.getTime() + windowMs) set.add(h);
        }
      }
    }
    const cell = new Map<string, DayRow>();
    for (const x of exposures) {
      const day = x.day.toISOString().slice(0, 10); const k = `${day}|${x.variant}`;
      const row = cell.get(k) ?? { day, variant: x.variant, exposures: 0, conversions: 0, guardrails: {} };
      row.exposures++;
      if (hits.get(e.primaryMetric)?.has(x.unitHash)) row.conversions++;
      for (const g of (e.guardrails as unknown as GuardrailSpec[]) ?? []) if (hits.get(g.metric)?.has(x.unitHash)) row.guardrails[g.metric] = (row.guardrails[g.metric] ?? 0) + 1;
      cell.set(k, row);
    }
    const rows = [...cell.values()];
    await this.prisma.$transaction(async (tx) => {
      await tx.growthExperimentDaily.deleteMany({ where: { experimentId } });
      if (rows.length) await tx.growthExperimentDaily.createMany({ data: rows.map((r) => ({ experimentId, day: new Date(r.day), variant: r.variant, exposures: r.exposures, conversions: r.conversions, guardrailCounts: r.guardrails as Prisma.InputJsonValue })) });
    });
    return rows;
  }

  async rows(experimentId: string): Promise<DayRow[]> {
    return (await this.prisma.growthExperimentDaily.findMany({ where: { experimentId } })).map((d) => ({ day: d.day.toISOString().slice(0, 10), variant: d.variant, exposures: d.exposures, conversions: d.conversions, guardrails: (d.guardrailCounts ?? {}) as Record<string, number> }));
  }
}
