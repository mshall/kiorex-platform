import { isSpecialtyCode, normalizeText, SPECIALTY_CODES, SPECIALTY_LABELS, type SpecialtyCode } from '../../safety/safety-public';
import { marketZone } from '../../common/market-time';
import lexicon from './model/fixtures/lexicon-eg.json';
import type { Dialect, Lang } from './assistant.types';

/**
 * Deterministic feature extraction shared by the mock model AND the orchestrator (which uses it to know which specialty the PATIENT named: a tool argument `specialty` is only accepted
 * when the patient's own words, a number they picked from the specialty list or an earlier choice in this session name it). No model, no network.
 */
type IntentKey = keyof typeof lexicon.intents;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PREFIX = '(?:ال|لل|ب|ل|و|ف)?';
const compile = (phrase: string) => new RegExp(`(?:^| )${PREFIX}${esc(normalizeText(phrase))}(?= |$)`);

const INTENTS = Object.fromEntries(Object.entries(lexicon.intents).map(([k, v]) => [k, (v as string[]).map(compile)])) as Record<IntentKey, RegExp[]>;
const ORDINALS = Object.entries(lexicon.ordinals).map(([n, v]) => [Number(n), (v as string[]).map(compile)] as const);
const DISTRICTS = Object.entries(lexicon.districts).map(([k, v]) => [compile(k), v as string] as const);
const SPECIALTY_ALIASES: [SpecialtyCode, RegExp[]][] = Object.entries(lexicon.specialtyAliases).map(([code, v]) => [code as SpecialtyCode, [...(v as string[]), code.replace(/_/g, ' '), SPECIALTY_LABELS[code as SpecialtyCode]?.en ?? '', SPECIALTY_LABELS[code as SpecialtyCode]?.ar ?? ''].filter(Boolean).map(compile)]);
for (const code of SPECIALTY_CODES) if (!SPECIALTY_ALIASES.some(([c]) => c === code)) SPECIALTY_ALIASES.push([code, [code.replace(/_/g, ' '), SPECIALTY_LABELS[code].en, SPECIALTY_LABELS[code].ar].map(compile)]);

export const LEXICON_PHRASE_COUNT = Object.values(lexicon.intents).reduce((n, v) => n + (v as string[]).length, 0);
export const lexiconIntents = () => Object.keys(lexicon.intents);

const EG_MARKERS = ['عايز', 'عاوز', 'عايزه', 'ازاي', 'النهارده', 'انهارده', 'بكره', 'دلوقتي', 'ايه', 'مش', 'فين', 'كده', 'ده', 'دي', 'احجزلي', 'كنسل', 'ارخص', 'محتاجه', 'عاوزه', 'شوف', 'كلموني', 'ممكن احجز', 'اتكلم'].map(normalizeText);
const MSA_MARKERS = ['اريد', 'ارغب', 'هل ', 'غدا', 'الان', 'من فضلك', 'لو سمحت', 'اود ', 'يرجي', 'ارجو', 'اطلب', 'بامكاني', 'لدي'].map(normalizeText);

export const isArabic = (s: string) => /[؀-ۿ]/.test(s);
export function detectLang(text: string, fallback: Lang): Lang {
  const letters = text.replace(/[^A-Za-z؀-ۿ]/g, '');
  if (!letters) return fallback; // digits and buttons never switch the language
  const ar = (text.match(/[؀-ۿ]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  return ar >= latin ? 'ar' : 'en';
}
export function detectDialect(text: string, lang: Lang, previous?: Dialect): Dialect {
  if (lang === 'en') return 'en';
  const n = ` ${normalizeText(text)} `;
  const eg = EG_MARKERS.filter((m) => n.includes(` ${m} `) || n.includes(m)).length;
  const msa = MSA_MARKERS.filter((m) => n.includes(m)).length;
  if (msa > eg) return 'msa';
  if (eg > msa) return 'eg';
  return previous && previous !== 'en' ? previous : 'eg';
}

/** yyyy-mm-dd of an instant in the market time zone (Cairo, DST aware). */
export function marketDate(d: Date = new Date(), zone = marketZone()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export function addDays(iso: string, days: number): string { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
export function marketHour(iso: string, zone = marketZone()): number { return Number(new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', hour12: false }).format(new Date(iso))) % 24; }
export type DayPart = 'morning' | 'afternoon' | 'evening';
export const partOfHour = (h: number): DayPart => (h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening');

export interface Features {
  intents: Set<IntentKey>;
  specialties: SpecialtyCode[];
  area?: string;
  day?: 'today' | 'tomorrow' | 'after_tomorrow';
  part?: DayPart;
  cheapest: boolean;
  nearest: boolean;
  maxPriceMinor?: number;
  pick?: number;
  lang: Lang;
  dialect: Dialect;
  normalised: string;
}

export function analyse(text: string, ctx: { lang?: Lang; dialect?: Dialect } = {}): Features {
  const n = normalizeText(text.replace(/[.,!?؟،:;]/g, ' ')).replace(/\s+/g, ' ');
  const intents = new Set<IntentKey>();
  for (const [k, res] of Object.entries(INTENTS) as [IntentKey, RegExp[]][]) if (res.some((r) => r.test(n))) intents.add(k);
  const specialties: SpecialtyCode[] = [];
  for (const [code, res] of SPECIALTY_ALIASES) if (res.some((r) => r.test(n))) specialties.push(code);
  let area: string | undefined;
  for (const [re, a] of DISTRICTS) if (re.test(n)) { area = a; break; }
  const day = intents.has('AFTER_TOMORROW') ? 'after_tomorrow' : intents.has('TOMORROW') ? 'tomorrow' : intents.has('TODAY') ? 'today' : undefined;
  const part = intents.has('MORNING') ? 'morning' : intents.has('AFTERNOON') ? 'afternoon' : intents.has('EVENING') ? 'evening' : undefined;
  let maxPriceMinor: number | undefined;
  const pm = /(?:تحت|اقل من|لحد|حتي|under|below|less than|max|up to|في حدود|بحد اقصي)\s*(\d{2,5})|(\d{2,5})\s*(?:جنيه|جنيها|egp|pounds|le)\b/.exec(n);
  if (pm) maxPriceMinor = Number(pm[1] ?? pm[2]) * 100;
  let pick: number | undefined;
  const bare = /^(?:رقم |number |no |# )?(\d{1,2})$/.exec(n.trim());
  if (bare) pick = Number(bare[1]);
  else for (const [num, res] of ORDINALS) if (res.some((r) => r.test(n)) && n.split(' ').length <= 4) { pick = num; break; }
  const lang = detectLang(text, ctx.lang ?? 'ar');
  return { intents, specialties, area, day, part, cheapest: intents.has('CHEAPEST'), nearest: intents.has('NEAREST'), maxPriceMinor, pick, lang, dialect: detectDialect(text, lang, ctx.dialect), normalised: n };
}

/** The specialties the patient named this turn (alias match) or picked by number from the list we showed. Used to authorise a `specialty` tool argument. */
export function namedSpecialties(text: string, shownSpecialties: readonly string[] = []): SpecialtyCode[] {
  const f = analyse(text);
  const out = new Set<SpecialtyCode>(f.specialties);
  if (f.pick && shownSpecialties[f.pick - 1] && isSpecialtyCode(shownSpecialties[f.pick - 1])) out.add(shownSpecialties[f.pick - 1] as SpecialtyCode);
  return [...out];
}
