import { mergeSeoExtensions, SEO_EXTENSION_DEFAULTS, validateSeoExtensions, validateTemplates } from './seo-extensions';
import { mergeSeoConfig } from '../../public-site/seo-config.service';
import { GROWTH_DEFAULT_PAYLOADS } from '../growth-public';

describe('SEO template validation (the hook package K calls before it stores a config version)', () => {
  it('accepts known page types, locales and placeholders', () => {
    const v = validateTemplates({ en: { city: { title: '{specialty} in {city}', description: '{count} doctors. {fees}Book on {brand}.' } }, ar: { doctor: { title: '{name}' } } });
    expect(v).toMatchObject({ valid: true, errors: [] });
    expect(v.cleaned.en!.city!.title).toBe('{specialty} in {city}');
  });
  it('rejects unknown placeholders, markup, unknown pages, wrong types and over-long text, and drops the whole entry', () => {
    const v = validateTemplates({ en: { city: { title: '{nme} in {city}' }, hub: { title: '<b>x</b>' }, nope: { title: 'x' }, doctor: { title: 5 }, clinic: { description: 'x'.repeat(400) } }, fr: {} });
    expect(v.valid).toBe(false);
    expect(v.errors.join('|')).toMatch(/unknown placeholders: nme/);
    expect(v.errors.join('|')).toMatch(/markup/);
    expect(v.errors.join('|')).toMatch(/unknown page type en.nope/);
    expect(v.errors.join('|')).toMatch(/unknown locale fr/);
    expect(v.errors.join('|')).toMatch(/longer than/);
    expect(v.cleaned).toEqual({});
  });
  it('unbalanced braces are rejected', () => { expect(validateTemplates({ en: { hub: { title: 'a { b' } } }).valid).toBe(false); });
});

describe('SEO extension merge (rides inside the versioned SEO payload)', () => {
  it('defaults: paginated pages not indexable, review markup needs 5 reviews, same-day window 24 h', () => {
    expect(SEO_EXTENSION_DEFAULTS()).toMatchObject({ paginatedIndexable: false, reviewMarkupMinCount: 5, sameDayWindowHours: 24, minAvailableProviders: 2, maxParentSimilarityPercent: 100, templates: {} });
  });
  it('applies valid values, ignores invalid ones and keeps the contract keys intact', () => {
    const base = mergeSeoConfig({ ...(GROWTH_DEFAULT_PAYLOADS.SEO as unknown as Record<string, unknown>), ...SEO_EXTENSION_DEFAULTS() } as never, {});
    const m = mergeSeoConfig(base, { minLiveProviders: 5, paginatedIndexable: true, reviewMarkupMinCount: 0, sameDayWindowHours: 12, maxParentSimilarityPercent: 20, templates: { en: { hub: { title: 'Heart {specialty}' } } } });
    expect(m.minLiveProviders).toBe(5);
    expect(m.paginatedIndexable).toBe(true);
    expect(m.reviewMarkupMinCount).toBe(5); // 0 is out of range: ignored
    expect(m.sameDayWindowHours).toBe(12);
    expect(m.maxParentSimilarityPercent).toBe(100); // below 50: ignored
    expect(m.templates.en!.hub!.title).toBe('Heart {specialty}');
    expect(m.canonicalHost).toBe(base.canonicalHost);
  });
  it('a hostile payload never throws and never poisons the config', () => {
    for (const p of [null, 5, 'x', [], { templates: 'x' }, { templates: { en: null } }, { paginatedIndexable: 'yes' }]) expect(() => mergeSeoExtensions(SEO_EXTENSION_DEFAULTS(), p)).not.toThrow();
    expect(mergeSeoExtensions(SEO_EXTENSION_DEFAULTS(), { paginatedIndexable: 'yes' }).paginatedIndexable).toBe(false);
  });
  it('validateSeoExtensions reports every problem for the maker-checker path', () => {
    expect(validateSeoExtensions({ paginatedIndexable: true, templates: {} })).toEqual({ valid: true, errors: [] });
    const v = validateSeoExtensions({ paginatedIndexable: 'x', reviewMarkupMinCount: 0, sameDayWindowHours: 500, templates: { en: { hub: { title: '{x}' } } } });
    expect(v.valid).toBe(false);
    expect(v.errors).toHaveLength(4);
    expect(validateSeoExtensions('x').valid).toBe(false);
  });
});
