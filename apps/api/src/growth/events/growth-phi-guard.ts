import { GROWTH_CARE_TYPES, GROWTH_CLIENT_EVENT_NAMES, GROWTH_LANDING_KINDS } from '@kiorex/contracts';
import { detectPhi } from '../../safety/safety-public';
import { growthError } from '../growth-errors';

/**
 * No-PHI guard for the funnel stream (ARCH sections 8 and 18). A closed allow-list of prop keys; a key that names health or identity data
 * (specialty, provider, doctor, clinic, symptom, diagnosis, search text, name, phone, e-mail, address, ids) is rejected as PHI (422), any other
 * unknown key as not allowed (422), values must be short tokens and must not look like personal data. `careType` is allowed as a TOP-LEVEL field only.
 */
export const GROWTH_EVENT_PROP_KEYS = ['surface', 'platform', 'locale', 'step', 'variant', 'position', 'count', 'bucket', 'reason', 'sourceKind', 'market', 'appVersion', 'widgetId'] as const;
const PHI_KEY = /specialt|provider|doctor|clinic|clinician|nurse|lab|pharm|diagnos|symptom|condition|drug|medic|prescri|treat|visit|reason_text|query|search|text|note|comment|name|phone|mobile|email|mail|address|district|city|national|sub\b|user|patient|booking|appointment|ip\b/i;
const TOKEN = /^[A-Za-z0-9_.:-]{1,64}$/;
export const GROWTH_PROP_MAX = 8;

export function guardEventProps(props: unknown): Record<string, string | number | boolean> {
  if (props === undefined || props === null) return {};
  if (typeof props !== 'object' || Array.isArray(props)) throw growthError('GROWTH_INVALID_REQUEST', 'props must be an object');
  const entries = Object.entries(props as Record<string, unknown>);
  if (entries.length > GROWTH_PROP_MAX) throw growthError('GROWTH_INVALID_REQUEST', `props has at most ${GROWTH_PROP_MAX} keys`);
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of entries) {
    if (PHI_KEY.test(k)) throw growthError('GROWTH_PHI_REJECTED', `props.${k.slice(0, 40)} names data that never enters the visitor stream`);
    if (!(GROWTH_EVENT_PROP_KEYS as readonly string[]).includes(k)) throw growthError('GROWTH_EVENT_NOT_ALLOWED', `props.${k.slice(0, 40)} is not an allowed key`, { allowed: GROWTH_EVENT_PROP_KEYS });
    if (typeof v === 'number') { if (!Number.isFinite(v) || Math.abs(v) > 1e9) throw growthError('GROWTH_INVALID_REQUEST', `props.${k} is out of range`); out[k] = v; continue; }
    if (typeof v === 'boolean') { out[k] = v; continue; }
    if (typeof v !== 'string' || !TOKEN.test(v)) throw growthError('GROWTH_INVALID_REQUEST', `props.${k} must be a short token`);
    if (detectPhi(v).length) throw growthError('GROWTH_PHI_REJECTED', `props.${k} looks like personal data`);
    out[k] = v;
  }
  return out;
}

export interface ParsedEvent { name: string; occurredAt?: Date; careType?: string; landingKind?: string; props: Record<string, string | number | boolean> }

export function parseEventsBody(body: unknown, now = new Date()): ParsedEvent[] {
  if (!body || typeof body !== 'object' || !Array.isArray((body as { events?: unknown }).events)) throw growthError('GROWTH_INVALID_REQUEST', 'events must be an array');
  const list = (body as { events: unknown[] }).events;
  if (list.length < 1 || list.length > 20) throw growthError('GROWTH_INVALID_REQUEST', 'events must hold 1 to 20 items');
  return list.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw growthError('GROWTH_INVALID_REQUEST', 'every event must be an object');
    const e = raw as Record<string, unknown>;
    if (typeof e.name !== 'string') throw growthError('GROWTH_INVALID_REQUEST', 'event name is required');
    if (!(GROWTH_CLIENT_EVENT_NAMES as readonly string[]).includes(e.name)) throw growthError('GROWTH_EVENT_NOT_ALLOWED', `${e.name.slice(0, 40)} cannot be reported by a client`, { allowed: GROWTH_CLIENT_EVENT_NAMES });
    const out: ParsedEvent = { name: e.name, props: {} };
    if (e.occurredAt !== undefined) {
      const t = typeof e.occurredAt === 'string' ? new Date(e.occurredAt) : null;
      if (!t || Number.isNaN(t.getTime())) throw growthError('GROWTH_INVALID_REQUEST', 'occurredAt must be an ISO date-time');
      // a client clock may drift but never writes the future or the distant past
      out.occurredAt = t.getTime() > now.getTime() + 5 * 60_000 || t.getTime() < now.getTime() - 48 * 3600_000 ? now : t;
    }
    if (e.careType !== undefined) { if (!(GROWTH_CARE_TYPES as readonly unknown[]).includes(e.careType)) throw growthError('GROWTH_INVALID_REQUEST', 'careType must be DOCTORS, PHYSIOTHERAPY or HOME_NURSING'); out.careType = e.careType as string; }
    if (e.landingKind !== undefined) { if (!(GROWTH_LANDING_KINDS as readonly unknown[]).includes(e.landingKind)) throw growthError('GROWTH_INVALID_REQUEST', 'landingKind is not a known landing kind'); out.landingKind = e.landingKind as string; }
    for (const k of Object.keys(e)) if (!['name', 'occurredAt', 'careType', 'landingKind', 'props'].includes(k)) { if (PHI_KEY.test(k)) throw growthError('GROWTH_PHI_REJECTED', `${k.slice(0, 40)} never enters the visitor stream`); throw growthError('GROWTH_EVENT_NOT_ALLOWED', `${k.slice(0, 40)} is not an allowed field`); }
    out.props = guardEventProps(e.props);
    return out;
  });
}
