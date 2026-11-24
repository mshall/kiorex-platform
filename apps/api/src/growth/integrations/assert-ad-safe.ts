import { detectPhi } from '../../safety/safety-public';
import type { AnonymizedConversion } from './port';

/**
 * The single gate every payload to an advertising platform passes (GRW-P2-F, ADR-007, ARCH 14). It is a closed allow-list, not a deny-list: a key that is not one of the seven below rejects
 * the whole payload. It never returns the input object; it builds a new one with an hour-rounded timestamp and a bucketed value, so a precise time cannot re-identify a person.
 */
export const AD_PAYLOAD_KEYS = ['eventName', 'occurredAtHour', 'market', 'valueMinor', 'currency', 'campaignRef', 'clickId'] as const;
const EVENT = /^[A-Za-z][A-Za-z0-9_]{1,39}$/;
const CAMPAIGN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const CLICK = /^[A-Za-z0-9_.-]{10,150}$/;
/** Names that describe health, a person or a provider, even when inside an otherwise valid token. */
const HEALTH_OR_PERSON = /specialt|dermat|cardio|pediatr|paediatr|gyn|oncolog|ortho|psych|dental|dentist|ophthal|neuro|urolog|provider|doctor|clinic|clinician|nurse|diagnos|symptom|condition|drug|medic|prescri|treat|lab[_-]?result|pharm|patient|phone|mobile|email|mail|name|address|national/i;
/** Identifier shapes: uuid, cuid, long hex, prefixed ids, JWTs, e-mails, long digit runs. */
const STRICT_KEYS = ['occurredAtHour', 'market', 'currency'];
const IDENT: RegExp[] = [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, /\bc[a-z0-9]{24}\b/, /\b[0-9a-f]{16,}\b/i, /\b(?:sub|usr|user|pat|bk|prov|org|ten)[_-][A-Za-z0-9]{6,}/i, /eyJ[A-Za-z0-9_-]{10,}\./, /[\w.+-]+@[\w-]+\.[\w.-]+/, /\d{9,}/];

export class AdUnsafeError extends Error {
  readonly code = 'AD_PAYLOAD_UNSAFE';
  constructor(readonly reason: string) { super(`AD_PAYLOAD_UNSAFE: ${reason}`); }
}
export interface AdSafeOptions { consentAnalytics: boolean; valueBucketMinor?: number }

export const roundToHour = (iso: string): string => { const t = Date.parse(iso); if (Number.isNaN(t)) throw new AdUnsafeError('occurredAtHour is not a date'); return new Date(Math.floor(t / 3_600_000) * 3_600_000).toISOString(); };
export const bucketValue = (v: number, bucket: number): number => Math.round(v / bucket) * bucket;

const looksLikeIdentifier = (s: string) => IDENT.some((r) => r.test(s));

export function assertAdSafe(input: unknown, opts: AdSafeOptions): AnonymizedConversion {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AdUnsafeError('payload must be an object');
  const o = input as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!(AD_PAYLOAD_KEYS as readonly string[]).includes(k)) throw new AdUnsafeError(`key ${JSON.stringify(k.slice(0, 24))} is not allowed`);
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined) continue;
    if (typeof v === 'string') {
      if (STRICT_KEYS.includes(k)) continue; // validated by an exact pattern or a date parse below
      if (k !== 'clickId' && looksLikeIdentifier(v)) throw new AdUnsafeError(`${k} looks like an identifier`);
      if (detectPhi(v).length) throw new AdUnsafeError(`${k} looks like personal data`);
    } else if (typeof v !== 'number') throw new AdUnsafeError(`${k} has an unsupported type`);
  }
  const eventName = o.eventName; const market = o.market; const campaignRef = o.campaignRef;
  if (typeof eventName !== 'string' || !EVENT.test(eventName) || HEALTH_OR_PERSON.test(eventName)) throw new AdUnsafeError('eventName is not an allowed token');
  if (typeof market !== 'string' || !/^[A-Z]{2}$/.test(market)) throw new AdUnsafeError('market must be a two-letter code');
  if (typeof campaignRef !== 'string' || !CAMPAIGN.test(campaignRef) || HEALTH_OR_PERSON.test(campaignRef)) throw new AdUnsafeError('campaignRef is not an allowed token');
  if (typeof o.occurredAtHour !== 'string') throw new AdUnsafeError('occurredAtHour is required');
  const out: AnonymizedConversion = { eventName, occurredAtHour: roundToHour(o.occurredAtHour), market, campaignRef };
  if (o.valueMinor !== undefined) {
    if (typeof o.valueMinor !== 'number' || !Number.isFinite(o.valueMinor) || o.valueMinor < 0 || o.valueMinor > 1e9) throw new AdUnsafeError('valueMinor is out of range');
    out.valueMinor = bucketValue(o.valueMinor, Math.max(1, opts.valueBucketMinor ?? 1000));
  }
  if (o.currency !== undefined) { if (typeof o.currency !== 'string' || !/^[A-Z]{3}$/.test(o.currency)) throw new AdUnsafeError('currency must be an ISO code'); out.currency = o.currency; }
  if (o.clickId !== undefined) {
    if (!opts.consentAnalytics) throw new AdUnsafeError('clickId needs analytics consent');
    if (typeof o.clickId !== 'string' || !CLICK.test(o.clickId) || IDENT.slice(0, 2).concat(IDENT.slice(3, 6)).some((r) => r.test(o.clickId as string))) throw new AdUnsafeError('clickId is malformed');
    out.clickId = o.clickId;
  }
  return out;
}
