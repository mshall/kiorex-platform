import { normalizeText } from './text';

/** Launch specialty codes (KX-16 §02 specialty advisory board list). */
export const SPECIALTY_CODES = ['dermatology', 'paediatrics', 'obgyn', 'orthopaedics', 'ent', 'internal_medicine', 'cardiology', 'psychiatry', 'ophthalmology', 'urology', 'dentistry'] as const;
export type SpecialtyCode = (typeof SPECIALTY_CODES)[number];

export const SPECIALTY_LABELS: Record<SpecialtyCode, { en: string; ar: string }> = {
  dermatology: { en: 'Dermatology', ar: 'الجلدية' },
  paediatrics: { en: 'Paediatrics', ar: 'الأطفال' },
  obgyn: { en: 'Obstetrics & Gynaecology', ar: 'النساء والتوليد' },
  orthopaedics: { en: 'Orthopaedics', ar: 'العظام' },
  ent: { en: 'ENT', ar: 'الأنف والأذن والحنجرة' },
  internal_medicine: { en: 'Internal medicine', ar: 'الباطنة' },
  cardiology: { en: 'Cardiology', ar: 'القلب' },
  psychiatry: { en: 'Psychiatry', ar: 'الطب النفسي' },
  ophthalmology: { en: 'Ophthalmology', ar: 'العيون' },
  urology: { en: 'Urology', ar: 'المسالك البولية' },
  dentistry: { en: 'Dentistry', ar: 'الأسنان' },
};

/** Keyword → specialty (KXM-DS-01 fallback; also the rules path when kiorex.ai_navigation is not effective). NEEDS_HUMAN: CMO review of the map. */
const MAP: Record<SpecialtyCode, string[]> = {
  dermatology: ['rash', 'acne', 'eczema', 'skin', 'itch', 'hair loss', 'جلد', 'حبوب', 'طفح', 'حكه', 'تساقط الشعر', 'اكزيما'],
  paediatrics: ['child', 'baby', 'infant', 'toddler', 'kid fever', 'طفل', 'رضيع', 'اطفال', 'بيبي'],
  obgyn: ['pregnan', 'period', 'menstrua', 'gynae', 'gynec', 'حمل', 'دوره', 'نساء', 'ولاده', 'توليد'],
  orthopaedics: ['knee', 'back pain', 'bone', 'fracture', 'joint', 'shoulder', 'عظام', 'ركبه', 'ظهر', 'كسر', 'مفاصل', 'كتف'],
  ent: ['ear', 'throat', 'sinus', 'tonsil', 'nose', 'hearing', 'اذن', 'حلق', 'جيوب انفيه', 'لوز', 'انف', 'سمع'],
  internal_medicine: ['stomach', 'diabetes', 'blood pressure', 'fatigue', 'thyroid', 'معده', 'سكر', 'ضغط', 'تعب', 'غده', 'هضم'],
  cardiology: ['heart', 'palpitation', 'cardio', 'قلب', 'خفقان'],
  psychiatry: ['anxiety', 'depress', 'panic', 'insomnia', 'stress', 'قلق', 'اكتئاب', 'نفسي', 'ارق'],
  ophthalmology: ['eye', 'vision', 'blurry', 'cataract', 'عين', 'نظر', 'عيون', 'مياه بيضاء'],
  urology: ['urine', 'urinary', 'kidney stone', 'prostate', 'بول', 'مسالك', 'حصوات', 'بروستاتا'],
  dentistry: ['tooth', 'teeth', 'dental', 'gum', 'cavity', 'سن', 'اسنان', 'ضرس', 'لثه'],
};
const NMAP = (Object.entries(MAP) as [SpecialtyCode, string[]][]).map(([c, l]) => [c, l.map(normalizeText)] as const);

export function isSpecialtyCode(s: string): s is SpecialtyCode {
  return (SPECIALTY_CODES as readonly string[]).includes(s);
}

/** Keyword→specialty codes ranked by hit count. Matches the specialty name itself too. Returns codes only (no free text). */
export function mapSymptomToSpecialties(text: string): SpecialtyCode[] {
  const n = normalizeText(text);
  const hits: [SpecialtyCode, number][] = [];
  for (const [code, list] of NMAP) {
    let score = 0;
    for (const kw of list) if (kw.length >= 2 && n.includes(kw)) score += kw.length > 3 ? 2 : 1;
    const label = SPECIALTY_LABELS[code];
    if (n.includes(code.replace('_', ' ')) || n.includes(normalizeText(label.en)) || n.includes(normalizeText(label.ar))) score += 3;
    if (score) hits.push([code, score]);
  }
  return hits.sort((a, b) => b[1] - a[1]).map(([c]) => c);
}
