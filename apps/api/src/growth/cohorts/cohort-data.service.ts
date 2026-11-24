import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { marketTimezone } from '../../market/market-core-public';
import { startOfLocalDay } from '../campaigns/market-day';
import { addMonths, monthOf, monthStart, type CohortBasis, type PatientRecord } from './cohort-builder';

const CHUNK = 3000;
const REF = /^[A-Za-z0-9_-]{1,64}$/;
const SRC = /^[a-z0-9_-]{1,32}$/;
const chunks = <T>(a: readonly T[], n = CHUNK): T[][] => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

/**
 * Reads the first-party facts the cohorts need (GRW-P3-C). Read-only: it writes nothing and never touches an attribution decision. A person is an in-memory record that the
 * builder folds into aggregate cells; `sub` is used as a join key only and is never returned, stored or logged.
 */
@Injectable()
export class CohortDataService {
  constructor(private readonly prisma: PrismaService) {}

  /** First day (UTC instant) of the first month of the window: the last `months` calendar months of the market, including the current one. */
  windowStart(market: string, now: Date, months: number): Date { const zone = marketTimezone(market); return startOfLocalDay(monthStart(addMonths(monthOf(now.getTime(), zone), -(months - 1))), zone); }

  async load(market: string, basis: CohortBasis, now: Date, months: number): Promise<PatientRecord[]> {
    const since = this.windowStart(market, now, months);
    return basis === 'FIRST_COMPLETED' ? this.firstCompleted(market, since, now) : this.registered(market, since, now);
  }

  private async attendedBy(market: string, subs: readonly string[], until: Date): Promise<Map<string, { bookingId: string; at: Date }[]>> {
    const out = new Map<string, { bookingId: string; at: Date }[]>(); const owner = new Map<string, string>();
    for (const c of chunks(subs)) for (const b of await this.prisma.bookingIntent.findMany({ where: { sub: { in: c } }, select: { id: true, sub: true } })) owner.set(b.id, b.sub);
    const ids = [...owner.keys()];
    for (const c of chunks(ids)) for (const e of await this.prisma.growthEvent.findMany({ where: { market, name: 'BookingAttended', bookingId: { in: c }, occurredAt: { lte: until } }, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }], select: { bookingId: true, occurredAt: true } })) {
      const sub = owner.get(e.bookingId!)!; const l = out.get(sub) ?? []; if (!l.some((x) => x.bookingId === e.bookingId)) l.push({ bookingId: e.bookingId!, at: e.occurredAt }); out.set(sub, l);
    }
    return out;
  }

  private async revenueOf(market: string, bookingIds: readonly string[]): Promise<Map<string, number>> {
    const revenue = new Map<string, number>();
    for (const c of chunks(bookingIds)) {
      const facts = await this.prisma.growthRevenueFact.findMany({ where: { market, bookingId: { in: c } }, select: { kind: true, chargeId: true, status: true, amountMinor: true, bookingId: true }, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] });
      const counted = new Set<string>();
      for (const f of facts) if (f.kind === 'CHARGE' && (f.status === 'CONFIRMED' || f.status === 'BILLED') && !counted.has(f.chargeId)) { counted.add(f.chargeId); revenue.set(f.bookingId!, (revenue.get(f.bookingId!) ?? 0) + f.amountMinor); }
      for (const f of facts) if (f.kind === 'REVERSAL' && counted.has(f.chargeId)) revenue.set(f.bookingId!, Math.max(0, (revenue.get(f.bookingId!) ?? 0) - f.amountMinor));
    }
    return revenue;
  }

  /** Source of the acquisition booking: the touch that decided the origin (its kind, campaign, platform), else the origin itself. */
  private async sourceOf(market: string, bookingIds: readonly string[]): Promise<Map<string, { sourceKind: string; campaignId: string; platform: string }>> {
    const out = new Map<string, { sourceKind: string; campaignId: string; platform: string }>();
    const campaigns = new Map((await this.prisma.growthCampaign.findMany({ where: { market }, select: { id: true, utmCampaign: true }, take: 5000 })).map((c) => [c.utmCampaign, c.id] as const));
    for (const c of chunks(bookingIds)) {
      const decisions = await this.prisma.growthAttributionDecision.findMany({ where: { market, bookingId: { in: c } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { bookingId: true, origin: true, winningTouchId: true } });
      const first = new Map<string, { origin: string; winningTouchId: string | null }>(); for (const d of decisions) if (!first.has(d.bookingId)) first.set(d.bookingId, d);
      const touchIds = [...first.values()].map((d) => d.winningTouchId).filter((x): x is string => !!x);
      const touches = new Map<string, { kind: string; utmCampaign: string | null; utmSource: string | null }>();
      for (const t of chunks(touchIds)) for (const r of await this.prisma.growthTouchpoint.findMany({ where: { id: { in: t } }, select: { id: true, kind: true, utmCampaign: true, utmSource: true } })) touches.set(r.id, r);
      for (const [bookingId, d] of first) {
        const t = d.winningTouchId ? touches.get(d.winningTouchId) : undefined;
        const ref = t?.utmCampaign ?? ''; const src = (t?.utmSource ?? '').toLowerCase();
        out.set(bookingId, { sourceKind: t?.kind ?? d.origin, campaignId: t && REF.test(ref) ? (campaigns.get(ref) ?? '') : '', platform: t && SRC.test(src) ? src : '' });
      }
    }
    return out;
  }

  private async rewardsBy(market: string, subs: readonly string[], until: Date): Promise<Map<string, { at: number; costMinor: number }[]>> {
    const out = new Map<string, { at: number; costMinor: number }[]>();
    for (const c of chunks(subs)) for (const e of await this.prisma.rewardLedgerEntry.findMany({ where: { type: 'REDEEM', createdAt: { lte: until }, lot: { market, sub: { in: c }, funding: 'PLATFORM_MARKETING' } }, select: { amountMinor: true, createdAt: true, lot: { select: { sub: true } } } })) {
      const l = out.get(e.lot.sub) ?? []; l.push({ at: e.createdAt.getTime(), costMinor: e.amountMinor }); out.set(e.lot.sub, l);
    }
    return out;
  }

  private async firstCompleted(market: string, since: Date, now: Date): Promise<PatientRecord[]> {
    const inWindow = await this.prisma.growthEvent.findMany({ where: { market, name: 'BookingAttended', bookingId: { not: null }, occurredAt: { gte: since, lte: now } }, select: { bookingId: true }, distinct: ['bookingId'] });
    const ids = inWindow.map((e) => e.bookingId!);
    const subs = new Set<string>(); for (const c of chunks(ids)) for (const b of await this.prisma.bookingIntent.findMany({ where: { id: { in: c } }, select: { sub: true } })) subs.add(b.sub);
    const attended = await this.attendedBy(market, [...subs], now);
    const people = [...attended.entries()].filter(([, l]) => l.length && l[0]!.at >= since); // a first completed booking before the window means the person belongs to an older cohort
    const firstIds = people.map(([, l]) => l[0]!.bookingId); const allIds = people.flatMap(([, l]) => l.map((v) => v.bookingId));
    const [revenue, source, rewards] = await Promise.all([this.revenueOf(market, allIds), this.sourceOf(market, firstIds), this.rewardsBy(market, people.map(([s]) => s), now)]);
    return people.map(([sub, l]) => {
      const src = source.get(l[0]!.bookingId) ?? { sourceKind: 'UNATTRIBUTED', campaignId: '', platform: '' };
      return { acquiredAt: l[0]!.at.getTime(), registeredAt: null, ...src, visits: l.map((v) => ({ at: v.at.getTime(), revenueMinor: revenue.get(v.bookingId) ?? 0 })), rewards: rewards.get(sub) ?? [] };
    });
  }

  private async registered(market: string, since: Date, now: Date): Promise<PatientRecord[]> {
    const profiles: { sub: string; createdAt: Date }[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await this.prisma.patientProfile.findMany({ where: { market, createdAt: { gte: since, lte: now } }, orderBy: { id: 'asc' }, take: 5000, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, sub: true, createdAt: true } });
      if (!page.length) break; cursor = page[page.length - 1]!.id; profiles.push(...page.map((p) => ({ sub: p.sub, createdAt: p.createdAt }))); if (page.length < 5000) break;
    }
    const attended = await this.attendedBy(market, profiles.map((p) => p.sub), now);
    const allIds = [...attended.values()].flatMap((l) => l.map((v) => v.bookingId)); const firstIds = [...attended.values()].filter((l) => l.length).map((l) => l[0]!.bookingId);
    const [revenue, source, rewards] = await Promise.all([this.revenueOf(market, allIds), this.sourceOf(market, firstIds), this.rewardsBy(market, profiles.map((p) => p.sub), now)]);
    return profiles.map((p) => {
      const l = attended.get(p.sub) ?? []; const src = l.length ? (source.get(l[0]!.bookingId) ?? { sourceKind: 'UNATTRIBUTED', campaignId: '', platform: '' }) : { sourceKind: 'NO_BOOKING', campaignId: '', platform: '' };
      return { acquiredAt: l[0]?.at.getTime() ?? null, registeredAt: p.createdAt.getTime(), ...src, visits: l.map((v) => ({ at: v.at.getTime(), revenueMinor: revenue.get(v.bookingId) ?? 0 })), rewards: rewards.get(p.sub) ?? [] };
    });
  }
}
