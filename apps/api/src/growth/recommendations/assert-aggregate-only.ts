import { ApiError } from '../../common/errors';
import { healthWordIn } from '../automation/health-terms';

/**
 * The aggregate-only guard (GRW-P3-E). Everything that becomes a recommendation, an evidence reference or a model prompt passes through here first. It rejects, anywhere in the value:
 *   - a key that names a person, a contact, a provider, a doctor or a health fact (the same list the database CHECK repeats),
 *   - a key that asks for an audience (audience, segment members, list of people, targeting),
 *   - a value that looks like an identifier (e-mail, phone number, 24+ character token or hash, a UUID),
 *   - a small cell: a count under k that is not zero, in a key that is a count,
 *   - a health or provider word in a string value,
 *   - an over-long string, an over-deep structure or a huge list (free text cannot smuggle anything in).
 * PURE. The result lists every violation with a JSON pointer, so a test can say which rule fired.
 */
export type AggregateViolationCode = 'IDENTIFIER_KEY' | 'AUDIENCE_KEY' | 'IDENTIFIER_VALUE' | 'SMALL_CELL' | 'HEALTH_WORD' | 'TOO_LONG' | 'TOO_DEEP' | 'TOO_MANY' | 'NOT_FINITE';
export interface AggregateViolation { path: string; code: AggregateViolationCode; detail: string }

const IDENTIFIER_KEYS = /^(sub|subs|subject|subjectref|subjecthash|userid|user|patient|patientid|patientref|phone|mobile|msisdn|email|mail|name|fullname|firstname|lastname|dob|dateofbirth|nationalid|visitorkey|visitor|addresshash|devicetoken|deviceid|ip|ipaddress|doctor|doctorid|doctorref|clinician|provider|providerid|providerref|branch|branchref|specialty|specialtycode|diagnosis|condition|symptom|symptoms|icd|prescription|medication|drug|reason|visitreason)$/i;
const AUDIENCE_KEYS = /(audience|lookalike|retarget|remarket|segmentmembers|members|userlist|subjectlist|recipients|cohortmembers|targetlist|hashedlist|custommatch)/i;
const COUNT_KEYS = /^(n|count|counts|people|patients|persons|bookings|attended\w*|conversions|registrations|exposures|views|clicks|sample\w*|pages|campaigns|sent|holdout|failingPages|submitted|indexed)$/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE = /(?:\+|00)?\d[\d\s-]{8,}\d/;
const TOKEN = /\b(?=[A-Za-z_]*\d)[A-Za-z0-9_]{24,}\b/; // a long run with a digit and no hyphen: an id or a hash (human keys have hyphens and short words)
const HEX = /\b[0-9a-f]{32,}\b/i;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const MAX_STR = 240; const MAX_DEPTH = 6; const MAX_LIST = 50;

export function checkAggregateOnly(value: unknown, opts: { k?: number } = {}): AggregateViolation[] {
  const k = opts.k ?? 10; const out: AggregateViolation[] = [];
  const add = (path: string, code: AggregateViolationCode, detail: string) => { if (out.length < 40) out.push({ path, code, detail }); };
  const visit = (v: unknown, path: string, key: string, depth: number) => {
    if (depth > MAX_DEPTH) { add(path, 'TOO_DEEP', `deeper than ${MAX_DEPTH}`); return; }
    if (v === null || v === undefined || typeof v === 'boolean') return;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) add(path, 'NOT_FINITE', 'not a finite number');
      else if (COUNT_KEYS.test(key) && Number.isInteger(v) && v > 0 && v < k) add(path, 'SMALL_CELL', `${key} is ${v}, under k = ${k}`);
      return;
    }
    if (typeof v === 'string') {
      if (v.length > MAX_STR) { add(path, 'TOO_LONG', `longer than ${MAX_STR}`); return; }
      if (EMAIL.test(v)) add(path, 'IDENTIFIER_VALUE', 'looks like an e-mail address');
      else if (UUID.test(v) || HEX.test(v) || TOKEN.test(v)) add(path, 'IDENTIFIER_VALUE', 'looks like an identifier or a hash');
      else if (PHONE.test(v.replace(/\d{4}-\d{2}-\d{2}/g, ''))) add(path, 'IDENTIFIER_VALUE', 'looks like a phone number');
      const w = healthWordIn(v); if (w) add(path, 'HEALTH_WORD', `"${w}" is a health or provider word`);
      return;
    }
    if (Array.isArray(v)) {
      if (v.length > MAX_LIST) { add(path, 'TOO_MANY', `more than ${MAX_LIST} entries`); return; }
      v.forEach((x, i) => visit(x, `${path}/${i}`, key, depth + 1));
      return;
    }
    if (typeof v === 'object') {
      for (const [kk, x] of Object.entries(v as Record<string, unknown>)) {
        const p = `${path}/${kk}`;
        if (IDENTIFIER_KEYS.test(kk)) add(p, 'IDENTIFIER_KEY', `"${kk}" names a person, a provider or a health fact`);
        else if (AUDIENCE_KEYS.test(kk)) add(p, 'AUDIENCE_KEY', `"${kk}" asks for an audience; a recommendation never builds a list of people`);
        visit(x, p, kk, depth + 1);
      }
      return;
    }
    add(path, 'IDENTIFIER_VALUE', `unsupported value type ${typeof v}`);
  };
  visit(value, '', '', 0);
  return out;
}

export function assertAggregateOnly(value: unknown, opts: { k?: number } = {}): void {
  const v = checkAggregateOnly(value, opts);
  if (v.length) throw new ApiError(422, 'RECOMMENDATION_NOT_AGGREGATE', 'A recommendation may only rest on aggregates (k >= 10): no identifier, audience, small cell or health word', { violations: v.slice(0, 10) });
}
