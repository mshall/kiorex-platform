import { looseRedirectTarget } from './loose-path';

describe('loose URL resolution (Arabic, case and underscore variants answer one 301)', () => {
  it('resolves Arabic specialty and place names to the canonical segments', () => {
    expect(looseRedirectTarget('/ar/eg/doctors/' + encodeURIComponent('القلب'))).toBe('/ar/eg/doctors/cardiology');
    expect(looseRedirectTarget('/ar/eg/doctors/' + encodeURIComponent('قلب') + '/' + encodeURIComponent('القاهرة'))).toBe('/ar/eg/doctors/cardiology/cairo');
    expect(looseRedirectTarget('/ar/eg/doctors/cardiology/cairo/' + encodeURIComponent('مدينة نصر'))).toBe('/ar/eg/doctors/cardiology/cairo/nasr-city');
    expect(looseRedirectTarget('/ar/eg/locations/' + encodeURIComponent('الجيزة'))).toBe('/ar/eg/locations/giza');
  });
  it('resolves an Arabic doctor name to the transliterated slug (the page then applies slug history)', () => {
    expect(looseRedirectTarget('/ar/eg/doctor/' + encodeURIComponent('سارة-حسن'))).toBe('/ar/eg/doctor/sara-hassan');
    expect(looseRedirectTarget('/ar/eg/doctor/' + encodeURIComponent('سارة حسن'))).toBe('/ar/eg/doctor/sara-hassan');
  });
  it('maps underscores and Latin spelling variants', () => {
    expect(looseRedirectTarget('/en/eg/doctors/Internal_Medicine')).toBe('/en/eg/doctors/internal-medicine');
    expect(looseRedirectTarget('/en/eg/doctors/internal_medicine')).toBe('/en/eg/doctors/internal-medicine');
  });
  it('leaves clean URLs, unknown shapes and non-public paths alone', () => {
    expect(looseRedirectTarget('/en/eg/doctors/cardiology')).toBeNull();
    expect(looseRedirectTarget('/en/eg/account')).toBeNull();
    expect(looseRedirectTarget('/en/eg/nope/x')).toBeNull();
    expect(looseRedirectTarget('/search')).toBeNull();
    expect(looseRedirectTarget('/ar/eg/doctors/%E0%A4%A')).toBeNull(); // malformed escape
    expect(looseRedirectTarget('/ar/eg/doctors/a/b/c/d/e')).toBeNull();
  });
  it('never redirects to a path that would itself not parse (no redirect to a 404 shape)', () => {
    expect(looseRedirectTarget('/ar/eg/doctors/' + encodeURIComponent('???'))).toBeNull();
  });
});
