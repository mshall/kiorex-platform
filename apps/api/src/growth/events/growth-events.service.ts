import { Injectable } from '@nestjs/common';
import { growthCanonicalJson, GROWTH_EVENT_NAMES } from '@kiorex/contracts';
import { FlagsService } from '../../control-plane/control-plane-public';
import { PrismaService } from '../../prisma/prisma.service';
import { growthError } from '../growth-errors';
import { GROWTH_DEFAULT_MARKET, GROWTH_FLAG } from '../growth-flags';
import { GrowthLimiter, growthLimits } from '../growth-limiter';
import { sha256Hex } from '../growth-secrets';
import { guardEventProps, type ParsedEvent } from './growth-phi-guard';

export interface IngestContext { ipHash: string; visitorKey?: string | null; consentAnalytics: boolean; market?: string; now?: Date }
export interface ServerFact { name: string; /** natural key of the fact, e.g. the booking id: the same fact reported twice is stored once */ naturalKey: string; bookingId?: string; careType?: string; props?: Record<string, unknown>; occurredAt?: Date; market?: string; visitorKey?: string | null }

/**
 * Canonical funnel events (GRW-P1-B). Idempotent by construction: every row has a `dedupeKey`, unique in the database, and writes use
 * `ON CONFLICT DO NOTHING`, so a retry, a double submit, or the same fact reported by web, mobile, messaging AND backend is stored exactly once.
 *  - client events: key = sha256(identity | name | landing | careType | props | minute bucket); identity = the visitor key (consent present) or the rotating ipHash
 *    (anonymous aggregate stream: the hash enters only the key, never a column).
 *  - server facts: key = `fact|<name>|<naturalKey>`, whichever channel reports it.
 * Without analytics consent nothing is keyed to a visitor: events are stored anonymously (careType and market only).
 */
@Injectable()
export class GrowthEventsService {
  constructor(private readonly prisma: PrismaService, private readonly flags: FlagsService, private readonly limiter: GrowthLimiter) {}

  async ingest(events: ParsedEvent[], ctx: IngestContext): Promise<{ accepted: number; duplicates: number }> {
    const market = ctx.market ?? GROWTH_DEFAULT_MARKET; const now = ctx.now ?? new Date();
    await this.limiter.take('events', ctx.ipHash, growthLimits().eventsPerMin);
    const keyed = ctx.consentAnalytics && !!ctx.visitorKey && (await this.flags.isEnabled(GROWTH_FLAG.ANALYTICS_VISITOR, { market }).catch(() => false));
    const rows = events.map((e) => {
      const at = e.occurredAt ?? now;
      const identity = keyed ? `v:${ctx.visitorKey}` : `a:${ctx.ipHash}`;
      const dedupeKey = sha256Hex(`c|${identity}|${e.name}|${e.landingKind ?? ''}|${e.careType ?? ''}|${growthCanonicalJson(e.props)}|${Math.floor(at.getTime() / 60_000)}`);
      return { market, name: e.name, visitorKey: keyed ? ctx.visitorKey! : null, careType: e.careType ?? null, props: { ...(e.landingKind ? { landingKind: e.landingKind } : {}), ...e.props } as never, dedupeKey, occurredAt: at };
    });
    const r = await this.prisma.growthEvent.createMany({ data: rows, skipDuplicates: true });
    return { accepted: rows.length, duplicates: rows.length - r.count };
  }

  /** Server-side operational fact (SlotSelected onwards, BookingConfirmed, PatientRegistered...). Same fact twice = one row. Returns true when newly stored. */
  async recordFact(f: ServerFact): Promise<boolean> {
    if (!(GROWTH_EVENT_NAMES as readonly string[]).includes(f.name)) throw growthError('GROWTH_EVENT_NOT_ALLOWED', `${f.name.slice(0, 40)} is not a canonical growth event`);
    const props = guardEventProps(f.props ?? {}); // the same PHI guard applies to backend writers
    const r = await this.prisma.growthEvent.createMany({
      data: [{ market: f.market ?? GROWTH_DEFAULT_MARKET, name: f.name, bookingId: f.bookingId ?? null, careType: f.careType ?? null, visitorKey: f.visitorKey ?? null, props: props as never, dedupeKey: `fact|${f.name}|${f.naturalKey}`, occurredAt: f.occurredAt ?? new Date() }],
      skipDuplicates: true,
    });
    return r.count === 1;
  }
}
