/**
 * Arabic text rules shared by slugs, on-site search and slug resolution (GRW-P1-F). Pure, no framework imports.
 *
 * normalizeArabic: the SEARCH key. Folds the spelling variants that Egyptian users type interchangeably so "احمد", "أحمد" and "أَحْمَد" are one
 * key: diacritics (tashkeel) and tatweel removed, every alef form to bare alef, alef maqsura and Persian ya to ya, ta marbuta to ha, hamza carriers
 * to their base letter, Arabic-Indic and Persian digits to ASCII, Latin lower-cased, punctuation and runs of space collapsed.
 *
 * transliterateArabic: a URL TOKEN, not a translation (ARCH 4.1 rule 1). Known words and common given names map through a dictionary; everything
 * else uses a plain letter map, so every entity can get an ASCII slug. Operators can rename a slug (the old one 301s forever).
 */
const TASHKEEL = /[ً-ٰٟۖ-ۭـ]/g;
const ALEF = /[آأإٱ]/g;

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN = '۰۱۲۳۴۵۶۷۸۹';
const digits = (s: string): string => s.replace(/[٠-٩۰-۹]/g, (d) => String(Math.max(ARABIC_INDIC.indexOf(d), PERSIAN.indexOf(d))));

/** The shared fold: diacritics, alef, ya, kaf and hamza carriers. `taMarbuta` is only folded for search (names need it to end in "a"). */
function fold(input: string, taMarbuta: boolean): string {
  let s = digits(input.normalize('NFKC')).replace(TASHKEEL, '').replace(ALEF, 'ا').replace(/[ىی]/g, 'ي').replace(/ک/g, 'ك');
  s = s.replace(/ؤ/g, 'و').replace(/ئ/g, 'ي');
  if (taMarbuta) s = s.replace(/ة/g, 'ه').replace(/ء/g, '');
  return s;
}

/** Search and slug-resolution key. Idempotent. */
export function normalizeArabic(input: string | null | undefined): string {
  if (!input) return '';
  return fold(input, true).toLowerCase().replace(/[،؛؟.,;:!?()[\]{}"'`~@#$%^&*_+=|\\/<>-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Does `haystack` contain every token of `query` after normalisation? Used by on-site search helpers and tests. */
export function searchMatches(haystack: string | null | undefined, query: string | null | undefined): boolean {
  const q = normalizeArabic(query).split(' ').filter(Boolean);
  if (!q.length) return false;
  const h = normalizeArabic(haystack);
  return q.every((t) => h.includes(t));
}

// ── transliteration ──────────────────────────────────────────────────────────────────────────────────────────

/** Honorifics and titles dropped from slugs (the page shows the full name; the URL stays short). Keys are normalised. */
const HONORIFICS_AR = new Set(['د', 'دكتور', 'دكتوره', 'الدكتور', 'الدكتوره', 'استاذ', 'استاذه', 'استاذ دكتور', 'استشاري', 'اخصائي', 'ممرض', 'ممرضه']);
const HONORIFICS_EN = new Set(['dr', 'doctor', 'prof', 'professor', 'consultant', 'mr', 'mrs', 'ms', 'eng', 'nurse']);

/** Words whose Egyptian Latin spelling is conventional. Keys use `normalizeArabic` spelling. */
const WORDS: Record<string, string> = {
  // given names
  'محمد': 'mohamed', 'احمد': 'ahmed', 'محمود': 'mahmoud', 'مصطفي': 'mostafa', 'ابراهيم': 'ibrahim', 'اسماعيل': 'ismail', 'حسن': 'hassan', 'حسين': 'hussein', 'علي': 'ali', 'عمر': 'omar',
  'عثمان': 'osman', 'يوسف': 'youssef', 'خالد': 'khaled', 'طارق': 'tarek', 'كريم': 'karim', 'ياسر': 'yasser', 'هشام': 'hesham', 'سامي': 'sami', 'سمير': 'samir', 'نبيل': 'nabil', 'عادل': 'adel',
  'ايمن': 'ayman', 'اسامه': 'osama', 'وائل': 'wael', 'ماجد': 'maged', 'مجدي': 'magdy', 'رامي': 'ramy', 'شريف': 'sherif', 'تامر': 'tamer', 'عمرو': 'amr', 'حازم': 'hazem', 'هاني': 'hany', 'ماهر': 'maher',
  'سارة': 'sara', 'ساره': 'sara', 'منيه': 'mona', 'مني': 'mona', 'هاله': 'hala', 'فاطمه': 'fatma', 'مريم': 'mariam', 'نهي': 'noha', 'هدي': 'hoda', 'سلمي': 'salma', 'ندي': 'nada',
  'دينا': 'dina', 'رنا': 'rana', 'امل': 'amal', 'اميره': 'amira', 'ايمان': 'eman', 'هبه': 'heba', 'ريهام': 'reham', 'شيماء': 'shaimaa', 'شيما': 'shaimaa', 'نورا': 'noura', 'لمياء': 'lamia', 'لميا': 'lamia',
  'عبد': 'abdel', 'عبدالله': 'abdallah', 'عبدالرحمن': 'abdelrahman', 'عبدالعزيز': 'abdelaziz', 'عبدالفتاح': 'abdelfattah', 'عبدالرحيم': 'abdelrahim', 'الله': 'allah', 'الرحمن': 'rahman', 'الرحيم': 'rahim', 'العزيز': 'aziz', 'الفتاح': 'fattah', 'ابو': 'abou', 'بن': 'ben', 'ابن': 'ibn',
  // family and places seen in listings
  'الشافعي': 'el-shafei', 'السيد': 'el-sayed', 'النيل': 'nile', 'القاهره': 'cairo', 'الجيزه': 'giza', 'الاسكندريه': 'alexandria', 'المعادي': 'maadi', 'الزمالك': 'zamalek', 'الدقي': 'dokki',
  'المهندسين': 'mohandessin', 'التجمع': 'tagamoa', 'الرحاب': 'rehab', 'الشروق': 'shorouk', 'العبور': 'obour', 'مدينه': 'city', 'نصر': 'nasr', 'جديده': 'new', 'الجديده': 'new', 'مصر': 'masr', 'الامل': 'amal',
  // facility words
  'عياده': 'clinic', 'عيادات': 'clinics', 'مركز': 'center', 'مراكز': 'centers', 'صيدليه': 'pharmacy', 'صيدليات': 'pharmacies', 'معمل': 'lab', 'مختبر': 'lab', 'مختبرات': 'labs', 'معامل': 'labs',
  'مستشفي': 'hospital', 'مستشفيات': 'hospitals', 'تحاليل': 'labs', 'طبي': 'medical', 'الطبي': 'medical', 'الطبيه': 'medical', 'للتحاليل': 'labs', 'تمريض': 'nursing', 'للتمريض': 'nursing',
  'علاج': 'therapy', 'طبيعي': 'physio', 'الطبيعي': 'physio', 'اسنان': 'dental', 'الاسنان': 'dental',
};

const LETTERS: Record<string, string> = {
  'ا': 'a', 'ب': 'b', 'ت': 't', 'ث': 'th', 'ج': 'g', 'ح': 'h', 'خ': 'kh', 'د': 'd', 'ذ': 'z', 'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 'sh',
  'ص': 's', 'ض': 'd', 'ط': 't', 'ظ': 'z', 'ع': 'a', 'غ': 'gh', 'ف': 'f', 'ق': 'q', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ه': 'h',
  'و': 'w', 'ي': 'y', 'ة': 'a', 'ء': '', 'ؤ': 'o', 'ئ': 'e',
};
const DICT_KEYS = new Set(Object.keys(WORDS));

function letterMap(word: string): string {
  const w = fold(word, false);
  let out = '';
  for (let i = 0; i < w.length; i++) {
    const ch = w[i]!;
    // article "al" at the start of a word (not part of the dictionary): el-
    if (i === 0 && w.startsWith('ال') && w.length > 3) { out += 'el-'; i += 1; continue; }
    out += LETTERS[ch] ?? ch;
  }
  return out;
}

/** One Arabic word: dictionary (also without the article ال), else letter map. */
function word(w: string): string {
  const key = normalizeArabic(w);
  if (DICT_KEYS.has(key)) return WORDS[key]!;
  if (key.startsWith('ال') && DICT_KEYS.has(key.slice(2))) return WORDS[key.slice(2)]!;
  return letterMap(w);
}

/** Multi-word names whose Latin form is not the word-by-word reading (keys normalised). */
const PHRASES: Record<string, string> = {
  'مدينه نصر': 'nasr city', 'القاهره الجديده': 'new cairo', 'مصر الجديده': 'heliopolis', 'الشيخ زايد': 'sheikh zayed', 'السادس من اكتوبر': '6th of october', 'مدينه السادس من اكتوبر': '6th of october',
  'التجمع الخامس': 'fifth settlement', 'وسط البلد': 'downtown', 'مدينه الرحاب': 'rehab city', 'شرم الشيخ': 'sharm el sheikh', 'جنوب سيناء': 'south sinai', 'بور سعيد': 'port said',
};
const PUNCT = /[\u060C\u061B\u061F.,;:!?()[\]{}"'`~@#$%^&*_+=|\\/<>]+/g;

/** Arabic (or mixed) name to a lowercase ASCII token string, honorifics dropped. Latin words pass through. */
export function transliterateArabic(input: string | null | undefined): string {
  if (!input) return '';
  const raw = fold(input, false).replace(PUNCT, ' ').split(/\s+/).filter(Boolean);
  // phrase pass: 3, then 2 consecutive tokens that form a known multi-word name
  const tokens: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    let hit: string | null = null; let take = 1;
    for (const n of [3, 2]) {
      if (raw.length - i < n) continue;
      const key = raw.slice(i, i + n).map((x) => normalizeArabic(x)).join(' ');
      if (PHRASES[key]) { hit = PHRASES[key]!; take = n; break; }
    }
    if (hit) { tokens.push(`\u0000${hit}`); i += take - 1; } else tokens.push(raw[i]!);
  }
  const out: string[] = [];
  for (const t of tokens) {
    if (t.startsWith('\u0000')) { out.push(t.slice(1)); continue; }
    if (/^[؀-ۿ]+$/.test(t)) {
      if (HONORIFICS_AR.has(normalizeArabic(t))) continue;
      out.push(word(t));
    } else if (!HONORIFICS_EN.has(t.toLowerCase())) out.push(t);
  }
  return out.join(' ');
}

/** Latin honorifics ("Dr Sara Hassan") are dropped before slugifying; the Arabic title is handled in transliterateArabic. */
export function stripLatinHonorifics(name: string): string {
  const parts = name.trim().split(/\s+/);
  while (parts.length > 1 && HONORIFICS_EN.has(parts[0]!.toLowerCase().replace(/\.+$/, ''))) parts.shift();
  return parts.join(' ');
}
