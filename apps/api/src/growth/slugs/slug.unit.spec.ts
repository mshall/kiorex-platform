import { candidateSlug, SLUG_PATTERN, slugify, withSuffix } from './slug';

describe('slug rules', () => {
  it('lowercase ASCII with hyphens, no diacritics, no punctuation', () => {
    expect(slugify('Dr. Omar El-Sayed, MD')).toBe('dr-omar-el-sayed-md');
    expect(slugify('Clinique Médecine Générale')).toBe('clinique-medecine-generale');
  });
  it('transliterates Arabic letters so an Arabic-only name still yields an ASCII slug', () => {
    expect(slugify('عيادة النور')).toMatch(/^[a-z-]+$/);
    expect(slugify('عيادة النور').length).toBeGreaterThan(3);
  });
  it('every candidate satisfies the pattern, even for empty, symbol-only, reserved or very long names', () => {
    for (const n of [null, '', '!!!', 'ab', 'search', 'x'.repeat(200), '٣٣٣', 'a-b']) expect(candidateSlug(n, 'DOCTOR', 'kx_dr_91ab23cd')).toMatch(SLUG_PATTERN);
    expect(candidateSlug('', 'CLINIC', 'cl_AB12cd34ef')).toBe('clinic-12cd34ef');
  });
  it('a numeric suffix stays within 60 characters', () => {
    const base = 'a'.repeat(60);
    expect(withSuffix(base, 12)).toHaveLength(60);
    expect(withSuffix('dr-omar', 2)).toBe('dr-omar-2');
    expect(slugify('x'.repeat(100))).toHaveLength(60);
  });
});
