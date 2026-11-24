import { addDays, analyse, detectDialect, detectLang, LEXICON_PHRASE_COUNT, lexiconIntents, marketDate, namedSpecialties, partOfHour } from './assistant.lexicon';
import lexicon from './model/fixtures/lexicon-eg.json';

describe('GRW-P2-D lexicon (MSA, Egyptian colloquial, English)', () => {
  it('has at least 60 colloquial Arabic intent phrases and every intent key the mock model reads', () => {
    const ar = Object.values(lexicon.intents).flat().filter((p) => /[؀-ۿ]/.test(p));
    expect(ar.length).toBeGreaterThanOrEqual(60); expect(LEXICON_PHRASE_COUNT).toBeGreaterThanOrEqual(100);
    for (const k of ['BOOK', 'CANCEL', 'RESCHEDULE', 'MY_BOOKINGS', 'HANDOFF', 'CHEAPEST', 'TODAY', 'TOMORROW', 'AFTER_TOMORROW', 'MORNING', 'AFTERNOON', 'EVENING', 'NEAREST', 'WAITLIST']) expect(lexiconIntents()).toContain(k);
  });
  it('every Arabic phrase of an intent is recognised as that intent (dialect spelling variants included)', () => {
    for (const [intent, phrases] of Object.entries(lexicon.intents)) for (const p of phrases as string[]) expect({ p, ok: analyse(p).intents.has(intent as never) }).toEqual({ p, ok: true });
  });
  it('the examples of the package: colloquial booking, same day, cheapest, near an area, cancel, human', () => {
    expect(analyse('عايز أحجز عند دكتور جلدية').specialties).toEqual(['dermatology']); expect(analyse('عايز أحجز عند دكتور جلدية').intents.has('BOOK')).toBe(true);
    expect(analyse('النهارده').day).toBe('today'); expect(analyse('أرخص').cheapest).toBe(true);
    expect(analyse('قريب من مدينة نصر').area).toBe('nasr city'); expect(analyse('الغي الحجز').intents.has('CANCEL')).toBe(true); expect(analyse('كلموني حد').intents.has('HANDOFF')).toBe(true);
  });
  it('time phrases: بكرة، بعد بكرة، الصبح، العصر، بالليل', () => {
    expect(analyse('بكرة').day).toBe('tomorrow'); expect(analyse('بعد بكرة').day).toBe('after_tomorrow'); expect(analyse('الصبح').part).toBe('morning'); expect(analyse('العصر').part).toBe('afternoon'); expect(analyse('بالليل').part).toBe('evening');
    expect(analyse('tomorrow morning').day).toBe('tomorrow'); expect(analyse('today').day).toBe('today');
  });
  it('Arabic-Indic numerals, picks and price limits', () => {
    expect(analyse('٣').pick).toBe(3); expect(analyse('رقم ٢').pick).toBe(2); expect(analyse('التاني').pick).toBe(2); expect(analyse('second').pick).toBe(2);
    expect(analyse('تحت ٣٠٠ جنيه').maxPriceMinor).toBe(30000); expect(analyse('under 250 EGP').maxPriceMinor).toBe(25000); expect(analyse('دكتور جلدية').maxPriceMinor).toBeUndefined();
  });
  it('specialty aliases and the prefix "ال"', () => { expect(analyse('عايز دكتور القلب').specialties).toContain('cardiology'); expect(analyse('طبيب اطفال').specialties).toContain('paediatrics'); expect(analyse('dermatology').specialties).toEqual(['dermatology']); expect(analyse('hello').specialties).toEqual([]); });
  it('a specialty is "named" only by the patient\'s words or a number picked from the list shown', () => {
    expect(namedSpecialties('جلدية')).toEqual(['dermatology']); expect(namedSpecialties('2', ['dermatology', 'paediatrics'])).toEqual(['paediatrics']); expect(namedSpecialties('2')).toEqual([]); expect(namedSpecialties('I have a rash')).toEqual([]);
  });
  it('language and dialect per turn; digits and buttons never switch the language', () => {
    expect(detectLang('hello', 'ar')).toBe('en'); expect(detectLang('مرحبا', 'en')).toBe('ar'); expect(detectLang('2', 'ar')).toBe('ar'); expect(detectLang('2', 'en')).toBe('en');
    expect(detectDialect('عايز احجز النهارده', 'ar')).toBe('eg'); expect(detectDialect('أريد حجز موعد من فضلك', 'ar')).toBe('msa'); expect(detectDialect('hello', 'en')).toBe('en'); expect(detectDialect('٢', 'ar', 'msa')).toBe('msa');
  });
  it('market calendar helpers (Cairo, DST-safe)', () => {
    expect(marketDate(new Date('2026-06-30T22:30:00Z'))).toBe('2026-07-01'); // UTC+3 in summer
    expect(marketDate(new Date('2026-01-30T22:30:00Z'))).toBe('2026-01-31'); expect(addDays('2026-12-30', 3)).toBe('2027-01-02'); expect([5, 12, 17, 23].map(partOfHour)).toEqual(['morning', 'afternoon', 'evening', 'evening']);
  });
});
