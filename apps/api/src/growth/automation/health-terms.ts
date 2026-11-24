import { SPECIALTY_CODES, SPECIALTY_LABELS } from '../../safety/safety-public';

/**
 * Words that mean health, a provider or an order (GRW-P3-E). Used by the journey validator (a graph may not mention them) and by the recommendation denylist (a proposal may not
 * target by them). Derived from the specialty catalogue so a new specialty is covered without an edit, plus a fixed list of generic health words, EN and AR.
 */
const STOP = new Set(['medicine', 'general', 'family', 'sports', 'management', 'diseases', 'surgery', 'health']);
const enWords = new Set<string>();
for (const c of SPECIALTY_CODES) {
  for (const w of c.split('_')) if (w.length >= 4 && !STOP.has(w)) enWords.add(w);
  for (const w of SPECIALTY_LABELS[c].en.toLowerCase().split(/[^a-z]+/)) if (w.length >= 4 && !STOP.has(w)) enWords.add(w);
}
const AR_STOP = new Set(['الطب', 'طب', 'وال', 'جراحة']);
const strip = (w: string) => w.replace(/^(وال|بال|لل|ال|و)/, '');
const arWords = new Set<string>();
for (const c of SPECIALTY_CODES) for (const w of SPECIALTY_LABELS[c].ar.split(/[^\u0621-\u064A]+/)) { const t = strip(w); if (t.length >= 3 && !AR_STOP.has(t) && !AR_STOP.has(w)) arWords.add(t); }
const GENERIC_EN = ['specialt', 'doctor', 'clinician', 'physician', 'provider', 'diagnos', 'prescri', 'medicat', 'drug', 'pharmac', 'symptom', 'disease', 'treatment', 'insur', 'cancer', 'diabet', 'pregnan', 'hiv', 'covid', 'surgery', 'therap', 'patient list', 'nurse'];
/** Arabic is matched on whole words (after the definite article), so "حملة" (a campaign) is not "حمل" (pregnancy) and "مرضى" (patients) is not "مرض" (disease). */
for (const w of ['طبيب', 'دكتور', 'تخصص', 'مرض', 'علاج', 'دواء', 'أدوية', 'تحليل', 'حمل', 'سرطان', 'سكر', 'سكري', 'عيادة', 'صيدلية', 'أعراض', 'تشخيص', 'ممرض', 'ممرضة', 'روشتة']) arWords.add(w);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const HEALTH_WORD_RE = new RegExp(`(${[...enWords, ...GENERIC_EN].map(esc).join('|')}|\\blabs?\\b|\\border(s|ed)?\\b|\\bclinic\\b)`, 'i');

/** The first health or provider word in `text`, or null. */
export function healthWordIn(text: string): string | null {
  const m = HEALTH_WORD_RE.exec(text);
  if (m) return m[1]!;
  for (const w of text.split(/[^\u0621-\u064A]+/)) { if (w.length >= 3 && (arWords.has(w) || arWords.has(strip(w)))) return w; }
  return null;
}
