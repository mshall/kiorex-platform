/** Strict validation of a public join request against the effective configuration. Pure functions: no I/O, no logging of values. */
import { createHash } from 'node:crypto';
import { LEAD_LOCALES, LEAD_MODES, LICENCE_FIELDS, typeSpec, type LeadConfig, type LeadMode, type RequirableField } from './lead-config';

export type FieldCode = 'required' | 'invalid' | 'too_long' | 'too_short' | 'not_allowed' | 'too_many';
export type FieldErrors = Record<string, FieldCode>;

export interface ParsedLead {
  mode: LeadMode; providerType: string; legalName: string; tradeName?: string; contactName: string; contactRole?: string; phone: string; email?: string;
  market: string; governorate?: string; city?: string; branches?: number; staffCount?: number; specialties: string[]; services?: string; currentSoftware?: string;
  licences: Partial<Record<(typeof LICENCE_FIELDS)[number], string>>; modules: string[]; goLive?: string; locale: 'ar' | 'en'; contactChannel?: string; contactTime?: string; note?: string;
  extra: Record<string, string | number | boolean>; consentTextVersion: string; sourceEnv?: string; honeypot: boolean;
}

export const BODY_FIELDS = [
  'source', 'env', 'mode', 'providerType', 'legalName', 'tradeName', 'contactName', 'contactRole', 'phone', 'email', 'market', 'governorate', 'city', 'branches', 'staffCount',
  'specialties', 'services', 'currentSoftware', 'licences', 'modules', 'goLive', 'locale', 'contactChannel', 'contactTime', 'note', 'answers', 'consent', 'website', 'submittedAt',
] as const;
export const LIMITS = { legalName: 120, tradeName: 120, contactName: 100, contactRole: 80, email: 254, city: 80, services: 300, currentSoftware: 80, licence: 40, note: 1000, specialties: 12 } as const;

const TYPE_SCOPED: ReadonlySet<string> = new Set(['tradeName', 'branches', 'staffCount', 'specialties', 'services', 'currentSoftware', ...LICENCE_FIELDS]);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
// eslint-disable-next-line no-control-regex
const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
export const normaliseDigits = (s: string): string => s.replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d))).replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)));
const EMAIL = /^[^\s@]{1,64}@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
const LICENCE = /^[\p{L}\p{N} ./_-]{1,40}$/u;
const VERSION = /^[A-Za-z0-9._-]{1,32}$/;

/**
 * E.164 normalisation. A number without a leading + or 00 gets the market's dial code (a leading national 0 is dropped).
 * +20 numbers must be an Egyptian mobile (1[0125] + 8 digits) or landline (area code + 7 or 8 digits); other countries: 7 to 15 digits. Never checked against any operator or authority.
 */
export function normalisePhone(raw: string, dialCode: string): { ok: true; e164: string } | { ok: false } {
  let t = normaliseDigits(raw.trim()).replace(/[\s().-]/g, '');
  if (!/^\+?\d+$/.test(t.replace(/^00/, '+'))) return { ok: false };
  if (t.startsWith('00')) t = `+${t.slice(2)}`;
  if (!t.startsWith('+')) t = `${dialCode}${t.replace(/^0+/, '')}`;
  if (!/^\+[1-9]\d{6,14}$/.test(t)) return { ok: false };
  if (t.startsWith('+20')) {
    const n = t.slice(3);
    const mobile = /^1[0125]\d{8}$/.test(n); const landline = /^[2-9]\d{7,8}$/.test(n);
    if (!mobile && !landline) return { ok: false };
  }
  return { ok: true, e164: t };
}

const clean = (v: unknown, max: number, errs: FieldErrors, field: string, opts: { multiline?: boolean } = {}): string | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string') { errs[field] = 'invalid'; return undefined; }
  const s = (opts.multiline ? v : v.replace(/[\r\n\t]+/g, ' ')).normalize('NFKC').trim();
  if (CTRL.test(s) || /[<>]/.test(s)) { errs[field] = 'invalid'; return undefined; }
  if (s.length > max) { errs[field] = 'too_long'; return undefined; }
  return s || undefined;
};
const intOf = (v: unknown, min: number, max: number, errs: FieldErrors, field: string): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'string' && /^\d{1,6}$/.test(normaliseDigits(v.trim())) ? Number(normaliseDigits(v.trim())) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) { errs[field] = 'invalid'; return undefined; }
  return n;
};
const active = (list: { key: string; active: boolean }[]) => new Set(list.filter((x) => x.active).map((x) => x.key));

/** Validate and normalise. `errors` is empty on success. Unknown top-level keys are an error (a bot or a stale client), not silently stored. */
export function parseSubmission(body: unknown, cfg: LeadConfig): { errors: FieldErrors; value?: ParsedLead } {
  const errors: FieldErrors = {};
  if (!isObj(body)) return { errors: { body: 'invalid' } };
  for (const k of Object.keys(body)) if (!(BODY_FIELDS as readonly string[]).includes(k)) errors[k] = 'not_allowed';
  if (Object.keys(errors).length) return { errors };
  const honeypot = typeof body.website === 'string' && body.website.trim() !== '';

  const mode = body.mode as LeadMode;
  if (!(LEAD_MODES as readonly unknown[]).includes(mode)) errors.mode = body.mode ? 'invalid' : 'required';
  const types = active(cfg.providerTypes);
  const providerType = typeof body.providerType === 'string' ? body.providerType : '';
  if (!providerType) errors.providerType = 'required'; else if (!types.has(providerType)) errors.providerType = 'invalid';
  const spec = typeSpec(providerType);
  const applies = (f: RequirableField) => !TYPE_SCOPED.has(f) || spec.fields.includes(f);
  const need = (f: RequirableField) => cfg.requiredFields.includes(f) && applies(f);

  const legalName = clean(body.legalName, LIMITS.legalName, errors, 'legalName'); if (!legalName && !errors.legalName) errors.legalName = 'required';
  const tradeName = applies('tradeName') ? clean(body.tradeName, LIMITS.tradeName, errors, 'tradeName') : undefined;
  const contactName = clean(body.contactName, LIMITS.contactName, errors, 'contactName'); if (!contactName && !errors.contactName) errors.contactName = 'required';
  const contactRole = clean(body.contactRole, LIMITS.contactRole, errors, 'contactRole');

  // market first: it fixes the dial code and the governorate list
  const markets = cfg.markets.filter((m) => m.active);
  const marketKey = typeof body.market === 'string' && body.market ? body.market.toUpperCase() : markets.length === 1 ? markets[0]!.key : '';
  const market = markets.find((m) => m.key === marketKey);
  if (!market) errors.market = marketKey ? 'invalid' : 'required';

  let phone: string | undefined;
  if (typeof body.phone !== 'string' || !body.phone.trim()) errors.phone = 'required';
  else if (body.phone.length > 30) errors.phone = 'too_long';
  else { const r = normalisePhone(body.phone, market?.dialCode ?? '+20'); if (r.ok) phone = r.e164; else errors.phone = 'invalid'; }

  let email = clean(body.email, LIMITS.email, errors, 'email');
  if (email && !EMAIL.test(email)) { errors.email = 'invalid'; email = undefined; }
  email = email?.toLowerCase();

  let governorate: string | undefined;
  if (body.governorate !== undefined && body.governorate !== '') {
    if (typeof body.governorate !== 'string' || !market || !active(market.governorates).has(body.governorate)) errors.governorate = 'invalid'; else governorate = body.governorate;
  }
  const city = clean(body.city, LIMITS.city, errors, 'city');
  const branches = applies('branches') ? intOf(body.branches, 1, 500, errors, 'branches') : undefined;
  if (applies('branches') && spec.minBranches && branches !== undefined && branches < spec.minBranches) errors.branches = 'too_short';
  const staffCount = applies('staffCount') ? intOf(body.staffCount, 1, 5000, errors, 'staffCount') : undefined;

  const strList = (v: unknown, field: string, allowed: Set<string>, max: number): string[] => {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) { errors[field] = 'invalid'; return []; }
    const u = [...new Set(v as string[])];
    if (u.length > max) { errors[field] = 'too_many'; return []; }
    if (u.some((x) => !allowed.has(x))) { errors[field] = 'invalid'; return []; }
    return u;
  };
  const specialties = applies('specialties') ? strList(body.specialties, 'specialties', active(cfg.specialties), LIMITS.specialties) : [];
  const modules = strList(body.modules, 'modules', active(cfg.modules), 10);
  const services = applies('services') ? clean(body.services, LIMITS.services, errors, 'services', { multiline: true }) : undefined;
  const currentSoftware = applies('currentSoftware') ? clean(body.currentSoftware, LIMITS.currentSoftware, errors, 'currentSoftware') : undefined;

  const oneOf = (v: unknown, field: string, list: { key: string; active: boolean }[]): string | undefined => {
    if (v === undefined || v === null || v === '') return undefined;
    if (typeof v !== 'string' || !active(list).has(v)) { errors[field] = 'invalid'; return undefined; }
    return v;
  };
  const goLive = oneOf(body.goLive, 'goLive', cfg.goLive);
  const contactChannel = oneOf(body.contactChannel, 'contactChannel', cfg.contactChannels);
  const contactTime = oneOf(body.contactTime, 'contactTime', cfg.contactTimes);
  const note = clean(body.note, LIMITS.note, errors, 'note', { multiline: true });

  const licences: ParsedLead['licences'] = {};
  if (body.licences !== undefined && body.licences !== null) {
    if (!isObj(body.licences)) errors.licences = 'invalid';
    else for (const [k, v] of Object.entries(body.licences)) {
      if (!(LICENCE_FIELDS as readonly string[]).includes(k)) { errors[`licences.${k}`] = 'not_allowed'; continue; }
      if (!applies(k as RequirableField)) continue; // not asked for this provider type: ignored, never stored
      if (v === undefined || v === null || v === '') continue;
      if (typeof v !== 'string') { errors[k] = 'invalid'; continue; }
      const s = v.normalize('NFKC').trim();
      if (s.length > LIMITS.licence) errors[k] = 'too_long'; else if (!LICENCE.test(s)) errors[k] = 'invalid'; else licences[k as (typeof LICENCE_FIELDS)[number]] = s;
    }
  }

  const extra: ParsedLead['extra'] = {};
  if (body.answers !== undefined && body.answers !== null) {
    if (!isObj(body.answers)) errors.answers = 'invalid';
    else for (const [k, v] of Object.entries(body.answers)) {
      const a = spec.answers[k];
      if (!a) { errors[`answers.${k}`] = 'not_allowed'; continue; }
      if (v === undefined || v === null || v === '') continue;
      if (a.kind === 'bool') { if (typeof v === 'boolean') extra[k] = v; else errors[`answers.${k}`] = 'invalid'; }
      else if (a.kind === 'int') { const n = intOf(v, a.min, a.max, errors, `answers.${k}`); if (n !== undefined) extra[k] = n; }
      else if (a.kind === 'enum') { if (typeof v === 'string' && a.values.includes(v)) extra[k] = v; else errors[`answers.${k}`] = 'invalid'; }
      else { const s = clean(v, a.max, errors, `answers.${k}`); if (s) extra[k] = s; }
    }
  }
  if (providerType === 'OTHER' && !extra.otherDescription && !errors['answers.otherDescription']) errors['answers.otherDescription'] = 'required';

  const locale = (body.locale ?? 'en') as 'ar' | 'en';
  if (!(LEAD_LOCALES as readonly unknown[]).includes(locale)) errors.locale = 'invalid';

  const c = body.consent;
  let consentTextVersion = '';
  if (!isObj(c) || c.accepted !== true) errors.consent = 'required';
  else if (typeof c.textVersion !== 'string' || !VERSION.test(c.textVersion)) errors.consent = 'invalid';
  else consentTextVersion = c.textVersion;

  const sourceEnv = clean(body.env, 16, errors, 'env');
  if (body.source !== undefined && body.source !== 'kiorly-site') errors.source = 'invalid';
  if (body.submittedAt !== undefined && (typeof body.submittedAt !== 'string' || body.submittedAt.length > 40)) errors.submittedAt = 'invalid';

  // team-configured mandatory optional fields (only those that apply to the type)
  const present: Record<RequirableField, boolean> = {
    tradeName: !!tradeName, contactRole: !!contactRole, email: !!email, governorate: !!governorate, city: !!city, branches: branches !== undefined, staffCount: staffCount !== undefined,
    specialties: specialties.length > 0, services: !!services, currentSoftware: !!currentSoftware, modules: modules.length > 0, goLive: !!goLive, contactChannel: !!contactChannel,
    contactTime: !!contactTime, note: !!note, facilityLicence: !!licences.facilityLicence, professionalLicence: !!licences.professionalLicence, commercialRegister: !!licences.commercialRegister, taxCard: !!licences.taxCard,
  };
  for (const f of cfg.requiredFields as RequirableField[]) {
    const isGov = f === 'governorate'; if (isGov && !(market && market.governorates.some((g) => g.active))) continue; // nothing to pick in this market
    if (need(f) && !present[f] && !errors[f]) errors[f] = 'required';
  }

  if (Object.keys(errors).length || !market || !phone || !legalName || !contactName) return { errors };
  return {
    errors,
    value: {
      mode, providerType, legalName, ...(tradeName ? { tradeName } : {}), contactName, ...(contactRole ? { contactRole } : {}), phone, ...(email ? { email } : {}), market: market.key,
      ...(governorate ? { governorate } : {}), ...(city ? { city } : {}), ...(branches !== undefined ? { branches } : {}), ...(staffCount !== undefined ? { staffCount } : {}), specialties,
      ...(services ? { services } : {}), ...(currentSoftware ? { currentSoftware } : {}), licences, modules, ...(goLive ? { goLive } : {}), locale, ...(contactChannel ? { contactChannel } : {}),
      ...(contactTime ? { contactTime } : {}), ...(note ? { note } : {}), extra, consentTextVersion, ...(sourceEnv ? { sourceEnv } : {}), honeypot,
    },
  };
}

/** Stable hash of what the applicant submitted (idempotency: same key + same payload = same answer; same key + different payload = conflict). */
export function payloadHashOf(v: ParsedLead): string {
  const { honeypot: _h, sourceEnv: _s, ...rest } = v;
  const canon = (x: unknown): unknown => Array.isArray(x) ? x.map(canon) : isObj(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, canon(x[k])])) : x;
  return createHash('sha256').update(JSON.stringify(canon(rest))).digest('hex');
}

/** Test-data tagging rule (configurable markers): a submission using a reserved test e-mail domain or a name prefix is tagged so it can be removed in one step. */
export function looksLikeTest(v: ParsedLead, cfg: LeadConfig): boolean {
  const domain = v.email?.split('@')[1]?.toLowerCase();
  if (domain && cfg.testMarkers.emailDomains.some((d) => domain === d || domain.endsWith(`.${d}`))) return true;
  return cfg.testMarkers.namePrefixes.some((p) => v.legalName.toLowerCase().startsWith(p.toLowerCase()));
}
