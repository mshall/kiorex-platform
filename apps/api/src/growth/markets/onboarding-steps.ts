import { SPECIALTY_CODES } from '../../safety/safety-public';
import { isValidTimezone, LOCALES } from '../../market/market-core-public';
import { loadDataCells } from './data-cells';

/**
 * The wizard's eight steps (GRW-P3-G). Each answer is references, ids and booleans: legal texts, counsel positions, prices and fees are never typed here (NEEDS_HUMAN). PURE validators:
 * they return the error list for one step payload, so the API and the console show the same messages.
 */
export const STEPS = ['identity', 'geography', 'specialties', 'regulation', 'providers', 'consent', 'residency', 'integrations'] as const;
export type StepId = (typeof STEPS)[number];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ID = /^[a-z0-9_-]{2,32}$/;
const REF = /^[A-Za-z0-9._:/-]{1,120}$/;
const BIDI = /[‎‏‪-‮⁦-⁩]/;
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const only = (p: Record<string, unknown>, keys: string[], e: string[]) => { for (const k of Object.keys(p)) if (!keys.includes(k)) e.push(`/${k} is not a known key`); };

export function validateStep(step: StepId, payload: unknown): string[] {
  const e: string[] = []; if (!obj(payload)) return ['/ must be an object']; const p = payload;
  switch (step) {
    case 'identity': {
      only(p, ['name', 'currency', 'minorUnits', 'phoneCode', 'phoneRegion', 'timezone', 'locales', 'defaultLocale', 'quietHours', 'workingWeek'], e);
      const n = p.name; if (!obj(n) || typeof n.ar !== 'string' || typeof n.en !== 'string' || !n.ar.trim() || !n.en.trim() || n.ar.length > 80 || n.en.length > 80 || BIDI.test(n.ar) || BIDI.test(n.en)) e.push('/name needs ar and en names of at most 80 characters without direction overrides');
      if (typeof p.currency !== 'string' || !/^[A-Z]{3}$/.test(p.currency)) e.push('/currency must be an ISO 4217 code');
      if (!Number.isInteger(p.minorUnits) || (p.minorUnits as number) < 0 || (p.minorUnits as number) > 4) e.push('/minorUnits must be an integer 0 to 4');
      if (typeof p.phoneCode !== 'string' || !/^\+[0-9]{1,4}$/.test(p.phoneCode)) e.push('/phoneCode must look like +962');
      if (p.phoneRegion !== undefined && (typeof p.phoneRegion !== 'string' || !/^[A-Z]{2}$/.test(p.phoneRegion))) e.push('/phoneRegion must be two capital letters');
      if (!isValidTimezone(p.timezone)) e.push('/timezone must be a valid IANA zone');
      if (!Array.isArray(p.locales) || !p.locales.length || !p.locales.every((l) => (LOCALES as readonly unknown[]).includes(l)) || new Set(p.locales).size !== p.locales.length) e.push('/locales must be a non-empty unique list of ar, en');
      if (!(LOCALES as readonly unknown[]).includes(p.defaultLocale) || (Array.isArray(p.locales) && !p.locales.includes(p.defaultLocale))) e.push('/defaultLocale must be one of /locales');
      const q = p.quietHours; if (!obj(q) || typeof q.start !== 'string' || typeof q.end !== 'string' || !HHMM.test(q.start) || !HHMM.test(q.end) || q.start === q.end) e.push('/quietHours needs distinct HH:MM start and end');
      if (!Array.isArray(p.workingWeek) || !p.workingWeek.length || new Set(p.workingWeek).size !== p.workingWeek.length || !p.workingWeek.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) e.push('/workingWeek must be a non-empty unique list of weekdays 0 to 6');
      return e;
    }
    case 'geography': e.push('The geography step is written only by the CSV import'); return e;
    case 'specialties': {
      only(p, ['enabled'], e); const l = p.enabled;
      if (!Array.isArray(l) || !l.length || l.length > 60) { e.push('/enabled must list 1 to 60 specialties'); return e; }
      const seen = new Set<string>();
      l.forEach((s, i) => {
        if (!obj(s) || typeof s.code !== 'string' || !(SPECIALTY_CODES as readonly string[]).includes(s.code)) { e.push(`/enabled/${i}/code must be a specialty of the global catalogue`); return; }
        if (seen.has(s.code)) e.push(`/enabled/${i}/code ${s.code} is listed twice`); seen.add(s.code);
        for (const k of ['nameAr', 'nameEn'] as const) { const v = s[k]; if (typeof v !== 'string' || !v.trim() || v.length > 80 || BIDI.test(v)) e.push(`/enabled/${i}/${k} is required (at most 80 characters)`); }
        only(s, ['code', 'nameAr', 'nameEn'], e);
      });
      return e;
    }
    case 'regulation': {
      only(p, ['marketingLicenceRequired', 'marketingLicenceHeld', 'consentRegimeId', 'minimumAge', 'healthAdvertisingRestricted', 'reviewMarkupAllowed', 'dataExportRuleId'], e);
      for (const k of ['marketingLicenceRequired', 'marketingLicenceHeld', 'healthAdvertisingRestricted', 'reviewMarkupAllowed']) if (typeof p[k] !== 'boolean') e.push(`/${k} must be a boolean`);
      for (const k of ['consentRegimeId', 'dataExportRuleId']) if (typeof p[k] !== 'string' || !ID.test(p[k] as string)) e.push(`/${k} must be a lower-case id (a-z, 0-9, hyphen, underscore, 2 to 32)`);
      if (!Number.isInteger(p.minimumAge) || (p.minimumAge as number) < 0 || (p.minimumAge as number) > 25) e.push('/minimumAge must be an integer 0 to 25');
      if (p.marketingLicenceHeld === true && p.marketingLicenceRequired !== true) e.push('/marketingLicenceHeld needs marketingLicenceRequired');
      return e;
    }
    case 'providers': only(p, ['importBatchId'], e); if (typeof p.importBatchId !== 'string' || !REF.test(p.importBatchId)) e.push('/importBatchId must be the id of an onboarding import batch'); return e;
    case 'consent': {
      only(p, ['textVersionIds', 'maxMarketingPerDay', 'maxMarketingPerWeek'], e); const t = p.textVersionIds;
      if (!obj(t) || typeof t.analytics !== 'string' || typeof t.marketing !== 'string' || !t.analytics || !t.marketing || t.analytics.length > 64 || t.marketing.length > 64) e.push('/textVersionIds needs analytics and marketing text version ids (the wording itself is human-owned)'); else only(t, ['analytics', 'marketing'], e);
      for (const k of ['maxMarketingPerDay', 'maxMarketingPerWeek']) if (!Number.isInteger(p[k]) || (p[k] as number) < 0 || (p[k] as number) > 20) e.push(`/${k} must be an integer 0 to 20`);
      if (Number.isInteger(p.maxMarketingPerDay) && Number.isInteger(p.maxMarketingPerWeek) && (p.maxMarketingPerDay as number) > (p.maxMarketingPerWeek as number)) e.push('/maxMarketingPerDay cannot exceed /maxMarketingPerWeek');
      return e;
    }
    case 'residency': {
      only(p, ['dataCellId'], e); const cells = loadDataCells().cells;
      if (typeof p.dataCellId !== 'string' || !cells.includes(p.dataCellId)) e.push(`/dataCellId must be one of the known cells (${cells.join(', ')}); an unknown cell is refused`);
      return e;
    }
    case 'integrations': only(p, ['whatsappPhoneNumberIdRef'], e); if (p.whatsappPhoneNumberIdRef !== null && p.whatsappPhoneNumberIdRef !== undefined && (typeof p.whatsappPhoneNumberIdRef !== 'string' || !REF.test(p.whatsappPhoneNumberIdRef))) e.push('/whatsappPhoneNumberIdRef must be a reference name or null (never the value)'); return e;
  }
}
export const isStep = (s: string): s is StepId => (STEPS as readonly string[]).includes(s);
