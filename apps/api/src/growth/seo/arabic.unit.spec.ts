import { normalizeArabic, searchMatches, stripLatinHonorifics, transliterateArabic } from './arabic';
import { proposeSlug } from './slug-names';
import { SLUG_PATTERN } from '../slugs/slug';
import { normalizeText } from '../../safety/safety-public';

describe('Arabic normalisation (search key and slug resolution)', () => {
  it('folds alef, ya, ta marbuta, hamza carriers, diacritics and tatweel to one key', () => {
    const keys = ['أحمد', 'احمد', 'إحمد', 'آحمد', 'أَحْمَد', 'أحـــمد'].map(normalizeArabic);
    expect(new Set(keys)).toEqual(new Set(['احمد']));
    expect(normalizeArabic('مصطفى')).toBe(normalizeArabic('مصطفي'));
    expect(normalizeArabic('مصطفى')).toBe(normalizeArabic('مصطفی')); // Persian ya
    expect(normalizeArabic('سارة')).toBe(normalizeArabic('ساره'));
    expect(normalizeArabic('مؤمن')).toBe(normalizeArabic('مومن'));
    expect(normalizeArabic('رئيس')).toBe(normalizeArabic('رىيس'.replace('ى', 'ي')));
    expect(normalizeArabic('كريم')).toBe(normalizeArabic('کریم'));
  });
  it('maps Arabic-Indic and Persian digits, lower-cases Latin and collapses punctuation and spaces', () => {
    expect(normalizeArabic('  عيادة  ١٢٣،  ۴۵۶  ')).toBe('عياده 123 456');
    expect(normalizeArabic('Dr.  SARA-Hassan')).toBe('dr sara hassan');
    expect(normalizeArabic(null)).toBe('');
    expect(normalizeArabic(normalizeArabic('أَحْمَد'))).toBe(normalizeArabic('أَحْمَد')); // idempotent
  });
  it('is a superset of the catalogue search normalisation (alef, ya, ta marbuta, diacritics, digits)', () => {
    for (const s of ['أحمد الشافعي', 'مصطفى', 'سارة', 'عيادة النيل ٢٤', 'إسماعيل']) expect(normalizeArabic(s)).toBe(normalizeText(s));
  });
  it('searchMatches needs every token, in any spelling', () => {
    expect(searchMatches('د. أحمد الشافعي، القلب', 'احمد قلب')).toBe(true);
    expect(searchMatches('د. أحمد الشافعي', 'احمد عظام')).toBe(false);
    expect(searchMatches('anything', '')).toBe(false);
  });
});

describe('Arabic transliteration into slug tokens', () => {
  it('uses conventional spellings for common names, drops honorifics and the article', () => {
    expect(transliterateArabic('د. محمد أحمد')).toBe('mohamed ahmed');
    expect(transliterateArabic('دكتورة سارة حسن')).toBe('sara hassan');
    expect(transliterateArabic('أ. د. عبد الله الشافعي')).toContain('abdel allah');
    expect(transliterateArabic('عيادة النيل')).toBe('clinic nile');
    expect(transliterateArabic('مدينة نصر')).toBe('nasr city');
    expect(transliterateArabic('القاهرة الجديدة')).toBe('new cairo');
  });
  it('falls back to a plain letter map for unknown words so every name gets an ASCII token', () => {
    const t = transliterateArabic('زكريا');
    expect(t).toMatch(/^[a-z-]+$/);
    expect(t.length).toBeGreaterThan(2);
  });
  it('strips Latin honorifics', () => {
    expect(stripLatinHonorifics('Dr. Sara Hassan')).toBe('Sara Hassan');
    expect(stripLatinHonorifics('Prof Dr Omar Nabil')).toBe('Omar Nabil');
    expect(stripLatinHonorifics('Dr')).toBe('Dr');
  });
});

describe('slug proposal', () => {
  it('prefers a valid Kiorly booking slug, then the English name, then the Arabic name, then a short id', () => {
    expect(proposeSlug({ bookingSlug: 'dr-sara', nameEn: 'Dr Sara Hassan' }, 'DOCTOR', 'lst_1')).toEqual({ slug: 'dr-sara', source: 'BOOKING_SLUG' });
    expect(proposeSlug({ bookingSlug: 'New', nameEn: 'Dr Sara Hassan' }, 'DOCTOR', 'lst_1')).toEqual({ slug: 'sara-hassan', source: 'NAME_EN' }); // reserved word refused
    expect(proposeSlug({ bookingSlug: '../x', nameEn: null, nameAr: 'د. سارة حسن' }, 'DOCTOR', 'lst_1')).toEqual({ slug: 'sara-hassan', source: 'NAME_AR' });
    const f = proposeSlug({ nameEn: '', nameAr: '???' }, 'DOCTOR', 'lst_Ab12Cd34Ef');
    expect(f.source).toBe('FALLBACK');
    expect(f.slug).toMatch(/^doctor-/);
  });
  it('every proposal satisfies the slug pattern (property over names in both scripts)', () => {
    const names = ['Dr Sara Hassan', 'د. سارة حسن', 'عيادة النيل للأسنان', 'Nile Clinic!!', '٣٣٣', 'A', 'x'.repeat(200), 'ab', '   ', 'Dr.', 'دكتور', "O'Brien & Sons", 'Café Müller Praxis', 'صيدلية الأمل 24 ساعة'];
    const bad: string[] = [];
    for (const type of ['DOCTOR', 'CLINIC', 'PHARMACY', 'LAB'] as const) for (const nameEn of names) for (const nameAr of [null, ...names]) {
      const { slug } = proposeSlug({ nameEn, nameAr }, type, 'lst_zz99');
      if (!SLUG_PATTERN.test(slug)) bad.push(`${type} ${nameEn} / ${nameAr} -> ${slug}`);
    }
    expect(bad).toEqual([]);
  });
});
