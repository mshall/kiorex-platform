import { Injectable } from '@nestjs/common';
import { badRequest } from '../common/errors';
import { cfg } from '../common/config';
import { detectPhi, SPECIALTY_CODES } from '../safety/safety-public';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Client analytics ingestion (KX-03 §07). RULE: no symptoms, diagnoses or free text. Event names and property keys are a
 * closed whitelist; values must match strict patterns; nothing identifying the user (no sub, no IP, no device id) is stored.
 */
export const CLIENT_EVENTS = ['search_started', 'results_viewed', 'slot_viewed', 'booking_started', 'booking_failed', 'review_submitted', 'waitlist_joined', 'vault_opened', 'whatsapp_link_clicked'] as const;
export const ALLOWED_PROPS = ['specialtyCode', 'providerId', 'market', 'code'] as const;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const CODE = /^[A-Za-z0-9_]{1,40}$/;
const MARKET = /^[A-Z]{2}$/;

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  validate(e: { name: string; props?: Record<string, unknown> }) {
    if (!(CLIENT_EVENTS as readonly string[]).includes(e.name)) throw badRequest('EVENT_NOT_ALLOWED', `event "${String(e.name).slice(0, 40)}" is not in the client analytics whitelist`, { allowed: CLIENT_EVENTS });
    const props = e.props ?? {};
    const out: { specialtyCode?: string; providerId?: string; market?: string; code?: string } = {};
    for (const [k, v] of Object.entries(props)) {
      if (!(ALLOWED_PROPS as readonly string[]).includes(k)) throw badRequest('PROPERTY_NOT_ALLOWED', `property "${k.slice(0, 40)}" is not allowed (PHI-free whitelist)`, { allowed: ALLOWED_PROPS });
      if (typeof v !== 'string') throw badRequest('PROPERTY_INVALID', `property ${k} must be a short string`);
      if (k === 'specialtyCode' && !(SPECIALTY_CODES as readonly string[]).includes(v)) throw badRequest('PROPERTY_INVALID', 'specialtyCode must be a launch specialty code');
      if (k === 'providerId' && !ID.test(v)) throw badRequest('PROPERTY_INVALID', 'providerId format invalid');
      if (k === 'market' && !MARKET.test(v)) throw badRequest('PROPERTY_INVALID', 'market must be ISO-3166 alpha-2');
      if (k === 'code' && !CODE.test(v)) throw badRequest('PROPERTY_INVALID', 'code must be [A-Za-z0-9_]{1,40}');
      if (detectPhi(v).length) throw badRequest('PROPERTY_INVALID', 'value looks like personal data and was rejected');
      (out as Record<string, string>)[k] = v;
    }
    return { name: e.name, ...out };
  }

  async ingest(events: { name: string; props?: Record<string, unknown> }[]) {
    if (!events.length) throw badRequest('EMPTY_BATCH', 'events must not be empty');
    if (events.length > cfg().analyticsMaxBatch) throw badRequest('BATCH_TOO_LARGE', `max ${cfg().analyticsMaxBatch} events per request`);
    const valid = events.map((e) => this.validate(e)); // all-or-nothing: never partially ingest a batch containing a rejected event
    await this.prisma.analyticsEvent.createMany({ data: valid.map((v) => ({ name: v.name, specialtyCode: v.specialtyCode, providerId: v.providerId, market: v.market ?? 'EG', code: v.code })) });
    return { accepted: valid.length };
  }
}
