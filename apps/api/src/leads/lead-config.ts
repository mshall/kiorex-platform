/**
 * Join-flow configuration of the Kiorly site leads (picklists, required fields, switches). The DEFAULTS below are what a fresh database serves; the Ops console
 * (Join requests > Settings) stores a versioned override in `LeadSetting` ("config"). Nothing here is a price, a fee or legal wording.
 * Behavioural facts that code relies on (the six lifecycle statuses, the two modes, the per-type field map) are NOT configurable; labels and picklists are.
 */
export const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'ONBOARDING', 'WON', 'LOST'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const LEAD_MODES = ['STANDALONE', 'CONNECTED'] as const;
export type LeadMode = (typeof LEAD_MODES)[number];
export const LEAD_LOCALES = ['ar', 'en'] as const;

/** Allowed transitions (reopen paths included). Anything else is a 409 INVALID_TRANSITION. */
export const LEAD_TRANSITIONS: Record<LeadStatus, readonly LeadStatus[]> = {
  NEW: ['CONTACTED', 'QUALIFIED', 'LOST'],
  CONTACTED: ['NEW', 'QUALIFIED', 'LOST'],
  QUALIFIED: ['CONTACTED', 'ONBOARDING', 'LOST'],
  ONBOARDING: ['QUALIFIED', 'WON', 'LOST'],
  WON: ['ONBOARDING'],
  LOST: ['NEW'],
};

export interface PickItem { key: string; en: string; ar: string; active: boolean }
export interface MarketItem extends PickItem { dialCode: string; governorates: PickItem[] }
export interface LeadConfig {
  providerTypes: PickItem[]; specialties: PickItem[]; markets: MarketItem[]; modules: PickItem[]; goLive: PickItem[]; software: PickItem[];
  contactChannels: PickItem[]; contactTimes: PickItem[]; lostReasons: PickItem[];
  statusLabels: Record<LeadStatus, { en: string; ar: string }>;
  /** optional fields the team requires on top of the always-required ones */
  requiredFields: string[];
  /** a submission matching one of these is tagged as test data (so it can be removed in one step) */
  testMarkers: { emailDomains: string[]; namePrefixes: string[] };
  notifications: { applicantAck: boolean; teamAlert: boolean };
}

/** Optional fields the team may make mandatory. The always-required ones (type, mode, legal name, contact name, phone, market, consent) are not in this list. */
export const REQUIRABLE_FIELDS = [
  'tradeName', 'contactRole', 'email', 'governorate', 'city', 'branches', 'staffCount', 'specialties', 'services', 'currentSoftware', 'modules', 'goLive',
  'contactChannel', 'contactTime', 'note', 'facilityLicence', 'professionalLicence', 'commercialRegister', 'taxCard',
] as const;
export type RequirableField = (typeof REQUIRABLE_FIELDS)[number];
export const LICENCE_FIELDS = ['facilityLicence', 'professionalLicence', 'commercialRegister', 'taxCard'] as const;

export type AnswerSpec = { kind: 'bool' } | { kind: 'int'; min: number; max: number } | { kind: 'enum'; values: string[] } | { kind: 'text'; max: number };
/** Core optional fields that apply to a provider type (the form shows only these) and the type-specific answers (stored in `extra`). Unknown types (added by the team) behave like OTHER. */
export const TYPE_FIELDS: Record<string, { fields: RequirableField[]; answers: Record<string, AnswerSpec>; minBranches?: number }> = {
  CLINIC: { fields: ['tradeName', 'branches', 'staffCount', 'specialties', 'services', 'currentSoftware', 'facilityLicence', 'commercialRegister', 'taxCard'], answers: { rooms: { kind: 'int', min: 1, max: 500 } } },
  INDEPENDENT_DOCTOR: { fields: ['tradeName', 'specialties', 'services', 'currentSoftware', 'professionalLicence', 'taxCard'], answers: { practiceSetting: { kind: 'enum', values: ['OWN_CLINIC', 'SHARED_CLINIC', 'MULTIPLE_PLACES'] } } },
  CHAIN: { fields: ['tradeName', 'branches', 'staffCount', 'specialties', 'services', 'currentSoftware', 'facilityLicence', 'commercialRegister', 'taxCard'], answers: { centralBilling: { kind: 'bool' }, citiesCount: { kind: 'int', min: 1, max: 200 } }, minBranches: 2 },
  HOSPITAL: { fields: ['tradeName', 'branches', 'staffCount', 'specialties', 'services', 'currentSoftware', 'facilityLicence', 'commercialRegister', 'taxCard'], answers: { beds: { kind: 'int', min: 1, max: 5000 }, departments: { kind: 'int', min: 1, max: 200 }, currentHis: { kind: 'bool' } } },
  NURSE: { fields: ['tradeName', 'specialties', 'services', 'currentSoftware', 'professionalLicence', 'taxCard'], answers: { homeVisits: { kind: 'bool' }, practiceModel: { kind: 'enum', values: ['SOLO', 'AGENCY'] } } },
  PHYSICIAN: { fields: ['tradeName', 'specialties', 'services', 'currentSoftware', 'professionalLicence', 'taxCard'], answers: { practiceSetting: { kind: 'enum', values: ['OWN_CLINIC', 'SHARED_CLINIC', 'MULTIPLE_PLACES'] } } },
  LAB: { fields: ['tradeName', 'branches', 'staffCount', 'services', 'currentSoftware', 'facilityLicence', 'commercialRegister', 'taxCard'], answers: { homeSampling: { kind: 'bool' }, collectionPoints: { kind: 'int', min: 0, max: 500 } } },
  PHARMACY: { fields: ['tradeName', 'branches', 'staffCount', 'services', 'currentSoftware', 'facilityLicence', 'commercialRegister', 'taxCard'], answers: { delivery: { kind: 'bool' }, open24h: { kind: 'bool' } } },
  OTHER: { fields: ['tradeName', 'branches', 'staffCount', 'specialties', 'services', 'currentSoftware', 'facilityLicence', 'professionalLicence', 'commercialRegister', 'taxCard'], answers: { otherDescription: { kind: 'text', max: 200 } } },
};
export const typeSpec = (type: string) => TYPE_FIELDS[type] ?? TYPE_FIELDS.OTHER!;

const p = (key: string, en: string, ar: string, active = true): PickItem => ({ key, en, ar, active });
const GOVERNORATES: PickItem[] = [
  p('CAIRO', 'Cairo', 'القاهرة'), p('GIZA', 'Giza', 'الجيزة'), p('ALEXANDRIA', 'Alexandria', 'الإسكندرية'), p('QALYUBIA', 'Qalyubia', 'القليوبية'), p('PORT_SAID', 'Port Said', 'بورسعيد'),
  p('SUEZ', 'Suez', 'السويس'), p('DAKAHLIA', 'Dakahlia', 'الدقهلية'), p('SHARQIA', 'Sharqia', 'الشرقية'), p('GHARBIA', 'Gharbia', 'الغربية'), p('MONUFIA', 'Monufia', 'المنوفية'),
  p('BEHEIRA', 'Beheira', 'البحيرة'), p('KAFR_EL_SHEIKH', 'Kafr El Sheikh', 'كفر الشيخ'), p('DAMIETTA', 'Damietta', 'دمياط'), p('ISMAILIA', 'Ismailia', 'الإسماعيلية'),
  p('NORTH_SINAI', 'North Sinai', 'شمال سيناء'), p('SOUTH_SINAI', 'South Sinai', 'جنوب سيناء'), p('FAYOUM', 'Fayoum', 'الفيوم'), p('BENI_SUEF', 'Beni Suef', 'بني سويف'),
  p('MINYA', 'Minya', 'المنيا'), p('ASSIUT', 'Assiut', 'أسيوط'), p('SOHAG', 'Sohag', 'سوهاج'), p('QENA', 'Qena', 'قنا'), p('LUXOR', 'Luxor', 'الأقصر'), p('ASWAN', 'Aswan', 'أسوان'),
  p('RED_SEA', 'Red Sea', 'البحر الأحمر'), p('NEW_VALLEY', 'New Valley', 'الوادي الجديد'), p('MATROUH', 'Matrouh', 'مطروح'),
];

export const DEFAULT_LEAD_CONFIG: LeadConfig = {
  providerTypes: [
    p('CLINIC', 'Clinic', 'عيادة'), p('INDEPENDENT_DOCTOR', 'Independent doctor', 'طبيب مستقل'), p('CHAIN', 'Chain of clinics', 'سلسلة عيادات'), p('HOSPITAL', 'Hospital', 'مستشفى'),
    p('NURSE', 'Nurse', 'ممرض أو ممرضة'), p('PHYSICIAN', 'Physician or allied health professional', 'طبيب أو أخصائي رعاية صحية'), p('LAB', 'Laboratory', 'معمل'), p('PHARMACY', 'Pharmacy', 'صيدلية'), p('OTHER', 'Other', 'أخرى'),
  ],
  specialties: [
    p('GENERAL_PRACTICE', 'General practice', 'طب عام'), p('INTERNAL_MEDICINE', 'Internal medicine', 'باطنة'), p('PEDIATRICS', 'Paediatrics', 'أطفال'), p('OBGYN', 'Obstetrics and gynaecology', 'نساء وتوليد'),
    p('DERMATOLOGY', 'Dermatology', 'جلدية'), p('DENTISTRY', 'Dentistry', 'أسنان'), p('OPHTHALMOLOGY', 'Ophthalmology', 'عيون'), p('ENT', 'Ear, nose and throat', 'أنف وأذن وحنجرة'),
    p('ORTHOPEDICS', 'Orthopaedics', 'عظام'), p('CARDIOLOGY', 'Cardiology', 'قلب'), p('NEUROLOGY', 'Neurology', 'مخ وأعصاب'), p('PSYCHIATRY', 'Psychiatry', 'نفسية'), p('UROLOGY', 'Urology', 'مسالك بولية'),
    p('PHYSIOTHERAPY', 'Physiotherapy', 'علاج طبيعي'), p('NUTRITION', 'Nutrition', 'تغذية'), p('RADIOLOGY', 'Radiology', 'أشعة'), p('LAB_MEDICINE', 'Laboratory medicine', 'تحاليل طبية'),
    p('HOME_NURSING', 'Nursing and home care', 'تمريض ورعاية منزلية'), p('OTHER', 'Other', 'أخرى'),
  ],
  markets: [{ key: 'EG', en: 'Egypt', ar: 'مصر', active: true, dialCode: '+20', governorates: GOVERNORATES }],
  modules: [
    p('CLINIC', 'Kiorly Clinic', 'كيورلي كلينيك'), p('PHARMACY', 'Kiorly Pharmacy', 'كيورلي فارماسي'), p('LAB', 'Kiorly Lab', 'كيورلي لاب'), p('NURSE', 'Kiorly Nurse', 'كيورلي للتمريض'),
    p('STAFF_APP', 'Kiorly staff app', 'تطبيق كيورلي للفريق'), p('ENTERPRISE', 'Hospitals and chains', 'المستشفيات والسلاسل'),
  ],
  goLive: [p('ASAP', 'As soon as possible', 'في أقرب وقت'), p('WITHIN_1_MONTH', 'Within a month', 'خلال شهر'), p('ONE_TO_THREE_MONTHS', 'In one to three months', 'خلال شهر إلى ثلاثة'), p('THREE_TO_SIX_MONTHS', 'In three to six months', 'خلال ثلاثة إلى ستة أشهر'), p('EXPLORING', 'Just exploring', 'أستكشف فقط')],
  software: [p('NONE', 'None, we use paper or spreadsheets', 'لا شيء، نستخدم الورق أو جداول البيانات'), p('OTHER_SOFTWARE', 'Another software', 'برنامج آخر')],
  contactChannels: [p('PHONE', 'Phone call', 'مكالمة هاتفية'), p('WHATSAPP', 'WhatsApp', 'واتساب'), p('EMAIL', 'Email', 'بريد إلكتروني')],
  contactTimes: [p('MORNING', 'Morning', 'صباحا'), p('AFTERNOON', 'Afternoon', 'بعد الظهر'), p('EVENING', 'Evening', 'مساء'), p('ANYTIME', 'Any time', 'في أي وقت')],
  lostReasons: [p('NO_RESPONSE', 'No response', 'لا يوجد رد'), p('NOT_A_FIT', 'Not a fit', 'غير مناسب'), p('CHOSE_OTHER', 'Chose another solution', 'اختار حلا آخر'), p('LATER', 'Not now, maybe later', 'ليس الآن'), p('DUPLICATE', 'Duplicate', 'مكرر'), p('SPAM', 'Spam or test', 'رسالة غير مرغوبة أو تجريبية')],
  statusLabels: {
    NEW: { en: 'New', ar: 'جديد' }, CONTACTED: { en: 'Contacted', ar: 'تم التواصل' }, QUALIFIED: { en: 'Qualified', ar: 'مؤهل' }, ONBOARDING: { en: 'Onboarding', ar: 'قيد الانضمام' }, WON: { en: 'Won', ar: 'تم الانضمام' }, LOST: { en: 'Lost', ar: 'مغلق' },
  },
  requiredFields: ['modules'],
  testMarkers: { emailDomains: ['example.test', 'example.invalid', 'kiorly-e2e.invalid'], namePrefixes: ['[TEST]'] },
  notifications: { applicantAck: true, teamAlert: true },
};

// ───────────────────────── validation of a configuration (admin save) ─────────────────────────
const KEY = /^[A-Z0-9][A-Z0-9_]{0,39}$/;
const MARKET_KEY = /^[A-Z]{2}$/;
const DIAL = /^\+[1-9]\d{0,3}$/;
const LABEL_MAX = 80;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, path: string, errs: string[]): string => { if (typeof v !== 'string' || !v.trim() || v.trim().length > LABEL_MAX || /[\u0000-\u001f<>]/.test(v)) { errs.push(`${path}: 1 to ${LABEL_MAX} characters, no markup`); return ''; } return v.trim(); };

function pick(list: unknown, path: string, errs: string[], opts: { min?: number; keyRe?: RegExp; max?: number } = {}): PickItem[] {
  if (!Array.isArray(list)) { errs.push(`${path}: must be a list`); return []; }
  if (list.length > (opts.max ?? 200)) errs.push(`${path}: at most ${opts.max ?? 200} items`);
  const seen = new Set<string>(); const out: PickItem[] = [];
  list.forEach((raw, i) => {
    if (!isObj(raw)) { errs.push(`${path}[${i}]: must be an object`); return; }
    const key = typeof raw.key === 'string' ? raw.key.trim() : '';
    if (!(opts.keyRe ?? KEY).test(key)) errs.push(`${path}[${i}].key: A-Z, 0-9 and _ only`);
    if (seen.has(key)) errs.push(`${path}[${i}].key: duplicate "${key}"`); seen.add(key);
    out.push({ key, en: text(raw.en, `${path}[${i}].en`, errs), ar: text(raw.ar, `${path}[${i}].ar`, errs), active: raw.active !== false });
  });
  if (opts.min && out.filter((x) => x.active).length < opts.min) errs.push(`${path}: at least ${opts.min} active item(s)`);
  return out;
}

/** Strict validation of a full configuration document. Returns the cleaned config or the list of problems (never throws). */
export function validateLeadConfig(raw: unknown): { ok: true; config: LeadConfig } | { ok: false; errors: string[] } {
  const errs: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ['config must be an object'] };
  const c = raw as Record<string, unknown>;
  const providerTypes = pick(c.providerTypes, 'providerTypes', errs, { min: 1 });
  const specialties = pick(c.specialties, 'specialties', errs);
  const modules = pick(c.modules, 'modules', errs, { min: 1 });
  const goLive = pick(c.goLive, 'goLive', errs);
  const software = pick(c.software, 'software', errs);
  const contactChannels = pick(c.contactChannels, 'contactChannels', errs, { min: 1 });
  const contactTimes = pick(c.contactTimes, 'contactTimes', errs);
  const lostReasons = pick(c.lostReasons, 'lostReasons', errs);
  const markets: MarketItem[] = [];
  if (!Array.isArray(c.markets)) errs.push('markets: must be a list');
  else {
    const seen = new Set<string>();
    (c.markets as unknown[]).forEach((m, i) => {
      if (!isObj(m)) { errs.push(`markets[${i}]: must be an object`); return; }
      const [base] = pick([{ key: m.key, en: m.en, ar: m.ar, active: m.active }], `markets[${i}]`, errs, { keyRe: MARKET_KEY });
      if (!base) return;
      if (seen.has(base.key)) errs.push(`markets[${i}].key: duplicate "${base.key}"`); seen.add(base.key);
      const dial = typeof m.dialCode === 'string' ? m.dialCode.trim() : '';
      if (!DIAL.test(dial)) errs.push(`markets[${i}].dialCode: like +20`);
      markets.push({ ...base, dialCode: dial, governorates: pick(m.governorates ?? [], `markets[${i}].governorates`, errs) });
    });
    if (!markets.some((m) => m.active)) errs.push('markets: at least 1 active market');
  }
  const statusLabels = {} as LeadConfig['statusLabels'];
  if (!isObj(c.statusLabels)) errs.push('statusLabels: must be an object');
  else for (const s of LEAD_STATUSES) { const v = (c.statusLabels as Record<string, unknown>)[s]; statusLabels[s] = isObj(v) ? { en: text(v.en, `statusLabels.${s}.en`, errs), ar: text(v.ar, `statusLabels.${s}.ar`, errs) } : (errs.push(`statusLabels.${s}: required`), { en: '', ar: '' }); }
  const required = Array.isArray(c.requiredFields) ? (c.requiredFields as unknown[]) : (errs.push('requiredFields: must be a list'), []);
  for (const f of required) if (!(REQUIRABLE_FIELDS as readonly unknown[]).includes(f)) errs.push(`requiredFields: "${String(f)}" cannot be made required`);
  const tm = isObj(c.testMarkers) ? c.testMarkers : (errs.push('testMarkers: must be an object'), {} as Record<string, unknown>);
  const list = (v: unknown, p2: string, re: RegExp) => { const a = Array.isArray(v) ? (v as unknown[]) : (errs.push(`${p2}: must be a list`), []); const o = a.map((x) => (typeof x === 'string' ? x.trim().toLowerCase() : '')); o.forEach((x, i) => { if (!re.test(x)) errs.push(`${p2}[${i}]: invalid`); }); if (o.length > 20) errs.push(`${p2}: at most 20`); return o; };
  const emailDomains = list(tm.emailDomains, 'testMarkers.emailDomains', /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/);
  const namePrefixes = (Array.isArray(tm.namePrefixes) ? (tm.namePrefixes as unknown[]) : (errs.push('testMarkers.namePrefixes: must be a list'), [])).map((x, i) => { const s = typeof x === 'string' ? x.trim() : ''; if (s.length < 3 || s.length > 30 || /[\u0000-\u001f<>]/.test(s)) errs.push(`testMarkers.namePrefixes[${i}]: 3 to 30 characters`); return s; });
  const n = isObj(c.notifications) ? c.notifications : (errs.push('notifications: must be an object'), {} as Record<string, unknown>);
  if (typeof n.applicantAck !== 'boolean' || typeof n.teamAlert !== 'boolean') errs.push('notifications: applicantAck and teamAlert must be true or false');
  if (errs.length) return { ok: false, errors: errs.slice(0, 40) };
  return { ok: true, config: { providerTypes, specialties, markets, modules, goLive, software, contactChannels, contactTimes, lostReasons, statusLabels, requiredFields: [...new Set(required as string[])], testMarkers: { emailDomains, namePrefixes }, notifications: { applicantAck: n.applicantAck as boolean, teamAlert: n.teamAlert as boolean } } };
}
