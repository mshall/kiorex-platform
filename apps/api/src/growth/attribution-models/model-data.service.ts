import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { startOfLocalDay, addDays, marketTimezone } from '../campaigns/market-day';
import { buildPaths, type ConversionFact, type RawTouch } from './path-builder';

const CHUNK = 4000;
const REF = /^[A-Za-z0-9_-]{1,64}$/;
const chunks = <T>(a: readonly T[], n = CHUNK): T[][] => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

/** Reads the first-party facts the models need. Read-only: it never writes and never touches `GrowthAttributionDecision`. */
@Injectable()
export class ModelDataService {
  constructor(private readonly prisma: PrismaService) {}

  /** Attended new-patient conversions (the canonical conversion, KX-32) whose event falls in the market days [from, to], one per booking, with their net Kiorex revenue facts. */
  async conversions(market: string, from: string, to: string): Promise<ConversionFact[]> {
    const zone = marketTimezone(market);
    const ev = await this.prisma.growthEvent.findMany({ where: { market, name: 'BookingAttended', bookingId: { not: null }, props: { path: ['bucket'], equals: 'new' }, occurredAt: { gte: startOfLocalDay(from, zone), lt: startOfLocalDay(addDays(to, 1), zone) } }, select: { bookingId: true, occurredAt: true }, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] });
    const first = new Map<string, Date>(); for (const e of ev) if (e.bookingId && !first.has(e.bookingId)) first.set(e.bookingId, e.occurredAt);
    const ids = [...first.keys()]; if (!ids.length) return [];
    const subs = new Map<string, string>(); const revenue = new Map<string, number>();
    for (const c of chunks(ids)) {
      for (const b of await this.prisma.bookingIntent.findMany({ where: { id: { in: c } }, select: { id: true, sub: true } })) subs.set(b.id, b.sub);
      const facts = await this.prisma.growthRevenueFact.findMany({ where: { market, bookingId: { in: c } }, select: { kind: true, chargeId: true, status: true, amountMinor: true, bookingId: true }, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] });
      const counted = new Set<string>();
      for (const f of facts) if (f.kind === 'CHARGE' && (f.status === 'CONFIRMED' || f.status === 'BILLED') && !counted.has(f.chargeId)) { counted.add(f.chargeId); revenue.set(f.bookingId!, (revenue.get(f.bookingId!) ?? 0) + f.amountMinor); }
      for (const f of facts) if (f.kind === 'REVERSAL' && counted.has(f.chargeId)) revenue.set(f.bookingId!, Math.max(0, (revenue.get(f.bookingId!) ?? 0) - f.amountMinor));
    }
    return ids.map((id) => ({ id, sub: subs.get(id) ?? null, at: first.get(id)!.getTime(), revenueMinor: revenue.get(id) ?? 0 }));
  }

  /** Touches of the given people: those that carry their `sub`, and every touch of a visitorKey seen on them (the only join keys, identity-link.ts). Touches before an analytics WITHDRAWAL are dropped. */
  async touchesOf(market: string, subs: readonly string[], since: Date, until: Date): Promise<RawTouch[]> {
    const rows = new Map<string, RawTouch>(); const campaigns = await this.campaignIds(market);
    const add = (t: { id: string; sub: string | null; visitorKey: string | null; occurredAt: Date; kind: string; linkCode: string | null; utmCampaign: string | null }) => {
      const ref = t.kind === 'CAMPAIGN' ? (t.utmCampaign ?? '') : (t.linkCode ?? '');
      const safe = REF.test(ref) ? ref : ''; rows.set(t.id, { id: t.id, sub: t.sub, visitorKey: t.visitorKey, at: t.occurredAt.getTime(), kind: t.kind, ref: safe, campaignId: t.kind === 'CAMPAIGN' && safe ? (campaigns.get(safe) ?? '') : '' });
    };
    const sel = { id: true, sub: true, visitorKey: true, occurredAt: true, kind: true, linkCode: true, utmCampaign: true } as const;
    const vks = new Set<string>();
    for (const c of chunks(subs)) for (const t of await this.prisma.growthTouchpoint.findMany({ where: { market, sub: { in: c }, occurredAt: { gte: since, lte: until } }, select: sel })) { add(t); if (t.visitorKey) vks.add(t.visitorKey); }
    for (const c of chunks([...vks])) for (const t of await this.prisma.growthTouchpoint.findMany({ where: { market, visitorKey: { in: c }, occurredAt: { gte: since, lte: until } }, select: sel })) add(t);
    // consent: analytics WITHDRAWAL stops use of earlier touches (same rule as the decision)
    const withdrawn = new Map<string, number>();
    for (const c of chunks(subs)) for (const r of await this.prisma.consentRecord.findMany({ where: { sub: { in: c }, purpose: 'ANALYTICS_MEASUREMENT' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { sub: true, granted: true, createdAt: true } })) { if (r.granted) withdrawn.delete(r.sub); else withdrawn.set(r.sub, r.createdAt.getTime()); }
    // QUARANTINE_TOUCH (fraud action on the TOUCH surface): reports do not count a quarantined touch; the touch row and every attribution decision stay untouched
    const quarantined = await this.quarantinedIds(since);
    return [...rows.values()].filter((t) => !quarantined.has(t.id) && !(t.sub && withdrawn.has(t.sub) && t.at <= withdrawn.get(t.sub)!));
  }

  /** Every touch of the market in a window, paged by id (data-driven only: non-converting people are part of the graph). */
  async allTouches(market: string, since: Date, until: Date, onPage: (rows: RawTouch[]) => void) {
    const campaigns = await this.campaignIds(market); let cursor: string | undefined;
    for (;;) {
      const page = await this.prisma.growthTouchpoint.findMany({ where: { market, occurredAt: { gte: since, lte: until } }, orderBy: { id: 'asc' }, take: 20_000, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, sub: true, visitorKey: true, occurredAt: true, kind: true, linkCode: true, utmCampaign: true } });
      if (!page.length) break; cursor = page[page.length - 1]!.id;
      const q = await this.quarantinedIds(since);
      onPage(page.filter((t) => !q.has(t.id)).map((t) => { const ref = t.kind === 'CAMPAIGN' ? (t.utmCampaign ?? '') : (t.linkCode ?? ''); const safe = REF.test(ref) ? ref : ''; return { id: t.id, sub: t.sub, visitorKey: t.visitorKey, at: t.occurredAt.getTime(), kind: t.kind, ref: safe, campaignId: t.kind === 'CAMPAIGN' && safe ? (campaigns.get(safe) ?? '') : '' }; }));
      if (page.length < 20_000) break;
    }
  }

  /** Touch ids quarantined by the fraud engine since `since` (audit rows `growth.fraud.touch_quarantine`, written by FraudHoldService.quarantineTouch). */
  async quarantinedIds(since: Date): Promise<Set<string>> {
    return new Set((await this.prisma.auditLog.findMany({ where: { action: 'growth.fraud.touch_quarantine', createdAt: { gte: new Date(since.getTime() - 400 * 86_400_000) } }, select: { resourceId: true }, take: 100_000 })).map((r) => r.resourceId!).filter(Boolean));
  }

  private async campaignIds(market: string) { return new Map((await this.prisma.growthCampaign.findMany({ where: { market }, select: { id: true, utmCampaign: true }, take: 5000 })).map((c) => [c.utmCampaign, c.id] as const)); }
}
export { buildPaths };
