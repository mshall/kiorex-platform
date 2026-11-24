/**
 * GRW-P3-G: the `MARKET_PROFILE` growth configuration kind and its pure helpers. A market is configuration plus data: the profile carries every fact the code used to
 * read from a hard-coded map (currency, phone code, names, time zone, locales, quiet hours, regulation switches, data-cell binding). PURE: no imports, no I/O, so
 * the leaf `market-core-public.ts` can be used from any module without an import cycle.
 *
 * Founder rules (kept): legal texts, counsel positions, fees and prices are never stored here (only booleans and ids; texts stay NEEDS_HUMAN); no secret values
 * (only reference names); no tax-authority field exists.
 */
export const LOCALES = ['ar', 'en'] as const;
export type MarketLocale = (typeof LOCALES)[number];

export interface MarketRegulation {
  marketingLicenceRequired: boolean;
  /** Counsel confirmed the licence position. Never set by code; the wizard only records what a human entered (growth.marketing_messaging stays launch-locked regardless). */
  marketingLicenceHeld: boolean;
  /** Analytics consent regime id (a reference, the legal text is human-owned). */
  consentRegimeId: string;
  minimumAge: number;
  healthAdvertisingRestricted: boolean;
  reviewMarkupAllowed: boolean;
  /** Reference id of the data-export rule set (the rules themselves are human-owned). */
  dataExportRuleId: string;
}

export interface MarketProfile {
  cc: string;
  name: { ar: string; en: string };
  currency: string;
  minorUnits: number;
  phoneCode: string;
  /** ISO 3166 region for phone number parsing (usually equal to cc). */
  phoneRegion: string;
  timezone: string;
  locales: MarketLocale[];
  defaultLocale: MarketLocale;
  /** Lowercase URL segment of the public site (`/eg/...`). */
  canonicalSegment: string;
  quietHours: { start: string; end: string };
  /** Days of the week that are working days, 0 = Sunday. */
  workingWeek: number[];
  geographyRef: string | null;
  specialtiesRef: string | null;
  /** Data-residency cell from `platform/data-cells.json`; null until the data-cell step is done. */
  dataCellId: string | null;
  /** Version id or label of the CONSENT_DEFAULTS config chosen for the market (texts human). */
  consentDefaultsRef: string | null;
  /** Onboarding import batch id used for the market (two-person import). */
  providerImportBatchId: string | null;
  regulation: MarketRegulation;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const REF = /^[A-Za-z0-9._:/-]{1,120}$/;
const REFLC = /^[a-z0-9/_.-]{1,120}$/; // keys ending in Ref are lower-case names (the configuration guard refuses anything that looks like a value)
const ID = /^[a-z0-9_-]{2,32}$/; // regime and rule ids: same shape as the CONSENT_DEFAULTS schema so a profile and its consent bundle always agree
const KEYS = ['cc', 'name', 'currency', 'minorUnits', 'phoneCode', 'phoneRegion', 'timezone', 'locales', 'defaultLocale', 'canonicalSegment', 'quietHours', 'workingWeek', 'geographyRef', 'specialtiesRef', 'dataCellId', 'consentDefaultsRef', 'providerImportBatchId', 'regulation'];
const REG_KEYS = ['marketingLicenceRequired', 'marketingLicenceHeld', 'consentRegimeId', 'minimumAge', 'healthAdvertisingRestricted', 'reviewMarkupAllowed', 'dataExportRuleId'];
const BIDI = /[‎‏‪-‮⁦-⁩]/; // direction overrides never belong in a display name
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function isValidTimezone(zone: unknown): boolean {
  if (typeof zone !== 'string' || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(zone)) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: zone }); return true; } catch { return false; }
}

/** Strict validation of a MARKET_PROFILE payload; unknown keys are rejected (a typo must not silently do nothing). Returns the error list (empty = valid). */
export function validateMarketProfile(payload: unknown): string[] {
  const e: string[] = [];
  if (!isObj(payload)) return ['/ must be an object'];
  for (const k of Object.keys(payload)) if (!KEYS.includes(k)) e.push(`/${k} is not a known key`);
  const p = payload;
  if (typeof p.cc !== 'string' || !/^[A-Z]{2}$/.test(p.cc)) e.push('/cc must be two capital letters (ISO 3166-1 alpha-2)');
  if (!isObj(p.name) || typeof p.name.ar !== 'string' || typeof p.name.en !== 'string' || !p.name.ar.trim() || !p.name.en.trim() || p.name.ar.length > 80 || p.name.en.length > 80) e.push('/name needs non-empty ar and en names of at most 80 characters');
  else if (BIDI.test(p.name.ar) || BIDI.test(p.name.en)) e.push('/name must not contain direction override characters');
  if (typeof p.currency !== 'string' || !/^[A-Z]{3}$/.test(p.currency)) e.push('/currency must be an ISO 4217 code');
  if (!Number.isInteger(p.minorUnits) || (p.minorUnits as number) < 0 || (p.minorUnits as number) > 4) e.push('/minorUnits must be an integer 0 to 4');
  if (typeof p.phoneCode !== 'string' || !/^\+[0-9]{1,4}$/.test(p.phoneCode)) e.push('/phoneCode must look like +20');
  if (p.phoneRegion !== undefined && (typeof p.phoneRegion !== 'string' || !/^[A-Z]{2}$/.test(p.phoneRegion))) e.push('/phoneRegion must be two capital letters');
  if (!isValidTimezone(p.timezone)) e.push('/timezone must be a valid IANA zone');
  if (!Array.isArray(p.locales) || !p.locales.length || new Set(p.locales).size !== p.locales.length || !p.locales.every((l) => (LOCALES as readonly unknown[]).includes(l))) e.push('/locales must be a non-empty unique list of ar, en');
  if (!(LOCALES as readonly unknown[]).includes(p.defaultLocale) || (Array.isArray(p.locales) && !p.locales.includes(p.defaultLocale))) e.push('/defaultLocale must be one of /locales');
  if (typeof p.canonicalSegment !== 'string' || !/^[a-z]{2}$/.test(p.canonicalSegment) || (typeof p.cc === 'string' && p.canonicalSegment !== p.cc.toLowerCase())) e.push('/canonicalSegment must be the lowercase market code');
  if (!isObj(p.quietHours) || typeof p.quietHours.start !== 'string' || typeof p.quietHours.end !== 'string' || !HHMM.test(p.quietHours.start) || !HHMM.test(p.quietHours.end) || p.quietHours.start === p.quietHours.end) e.push('/quietHours needs distinct HH:MM start and end');
  if (!Array.isArray(p.workingWeek) || !p.workingWeek.length || new Set(p.workingWeek).size !== p.workingWeek.length || !p.workingWeek.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) e.push('/workingWeek must be a non-empty unique list of weekdays 0 to 6');
  for (const k of ['geographyRef', 'specialtiesRef', 'dataCellId', 'consentDefaultsRef', 'providerImportBatchId'] as const) {
    const v = p[k]; if (v !== null && v !== undefined && (typeof v !== 'string' || !(k === 'providerImportBatchId' ? REF : REFLC).test(v))) e.push(`/${k} must be a lower-case reference name or null`);
  }
  if (!isObj(p.regulation)) e.push('/regulation must be an object');
  else {
    const r = p.regulation;
    for (const k of Object.keys(r)) if (!REG_KEYS.includes(k)) e.push(`/regulation/${k} is not a known key`);
    for (const k of ['marketingLicenceRequired', 'marketingLicenceHeld', 'healthAdvertisingRestricted', 'reviewMarkupAllowed']) if (typeof r[k] !== 'boolean') e.push(`/regulation/${k} must be a boolean`);
    if (typeof r.consentRegimeId !== 'string' || !ID.test(r.consentRegimeId)) e.push('/regulation/consentRegimeId must be a lower-case id (a-z, 0-9, hyphen, underscore, 2 to 32)');
    if (typeof r.dataExportRuleId !== 'string' || !ID.test(r.dataExportRuleId)) e.push('/regulation/dataExportRuleId must be a reference id');
    if (!Number.isInteger(r.minimumAge) || (r.minimumAge as number) < 0 || (r.minimumAge as number) > 25) e.push('/regulation/minimumAge must be an integer 0 to 25');
    if (r.marketingLicenceHeld === true && r.marketingLicenceRequired !== true) e.push('/regulation/marketingLicenceHeld needs marketingLicenceRequired');
  }
  return e;
}

/** Normalises a validated payload (defaults for the optional keys). */
export function normalizeMarketProfile(p: Record<string, unknown>): MarketProfile {
  const x = p as unknown as MarketProfile;
  return { ...x, phoneRegion: x.phoneRegion ?? x.cc, geographyRef: x.geographyRef ?? null, specialtiesRef: x.specialtiesRef ?? null, dataCellId: x.dataCellId ?? null, consentDefaultsRef: x.consentDefaultsRef ?? null, providerImportBatchId: x.providerImportBatchId ?? null };
}

/** Minor units of the currencies the code map knows; a profile states its own `minorUnits`. */
export const formatMoneyMinor = (minor: number, profile: Pick<MarketProfile, 'currency' | 'minorUnits'>): string => {
  const u = profile.minorUnits; const v = (u === 0 ? minor : minor / 10 ** u);
  return `${u === 0 ? String(Math.round(v)) : v.toFixed(u)} ${profile.currency}`;
};
