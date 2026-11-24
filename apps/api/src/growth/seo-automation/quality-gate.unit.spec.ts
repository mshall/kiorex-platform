import { SEO_AUTOMATION_DEFAULTS, mergeSeoAutomation, validateSeoAutomation } from './seo-automation-config';
import { boilerplateOf, runGate, summarise } from './quality-gate';
import { jaccard, shingles, tokens, visibleText, containment } from './text';
import { requiredProps } from './checks/structured-data';
import { HOST, bothLocales, page } from './fixtures.testutil';
import type { PageContent } from './page-model';

const cfg = SEO_AUTOMATION_DEFAULTS();
const gate = (pages: PageContent[], o: Partial<Parameters<typeof runGate>[0]> = {}) => runGate({ pages, cfg, host: HOST, reviewMarkupEnabled: false, reviewMarkupMinCount: 5, minAvailableProviders: 2, ...o });
const failed = (pages: PageContent[], key: string, locale = 'en', o = {}) => gate(pages, o).reports.find((r) => r.pageKey === key && r.locale === locale)!;

describe('text tools', () => {
  it('visibleText drops scripts, styles and tags; tokens fold Arabic variants and ignore diacritics', () => {
    expect(visibleText('<p>Hi&nbsp;<b>there</b></p><script>x=1</script><style>a{}</style>')).toBe('Hi there');
    expect(tokens('أَحْمَد إبراهيم')).toEqual(tokens('احمد ابراهيم'));
    expect(tokens('Dr. Sara-Hassan 300')).toEqual(['dr', 'sara', 'hassan', '300']);
  });
  it('jaccard and containment', () => {
    const a = shingles(tokens('a b c d e f'), 2); const b = shingles(tokens('a b c d'), 2);
    expect(jaccard(a, a)).toBe(1); expect(jaccard(a, b)).toBeCloseTo(0.6, 5); expect(containment(b, a)).toBe(1); expect(jaccard(new Set(), new Set())).toBe(0);
  });
});

describe('quality gate: a good page passes every check', () => {
  it('both locales of a complete doctor page have no failed check and a score of 100', () => {
    const r = gate(bothLocales()).reports;
    for (const x of r) expect({ k: x.pageKey, l: x.locale, f: x.failedChecks, s: x.score, n: x.wouldNoindex }).toEqual({ k: x.pageKey, l: x.locale, f: [], s: 100, n: false });
  });
});

describe('quality gate: each check fails on its bad fixture', () => {
  it('thin content: too few unique words, and a placeholder page', () => {
    const thin = bothLocales({ text: 'Dr Sara Hassan cardiologist Cairo.' }).map((p) => (p.locale === 'ar' ? { ...p, text: 'د سارة حسن قلب القاهرة' } : p));
    expect(failed(thin, 'doctor:sara-hassan').failedChecks).toContain('thin-content');
    const soon = bothLocales({ text: `${page({}).text} Coming soon.` });
    expect(failed(soon, 'doctor:sara-hassan').failedChecks).toContain('empty-page');
    expect(failed(soon, 'doctor:sara-hassan').blockingFailed).toContain('empty-page');
  });
  it('the template boilerplate does not count as unique text (five pages, shared sentences)', () => {
    const chrome = 'Book a visit online pay the deposit securely and receive a reminder before your appointment. Kiorex shows fees languages ratings and the next available appointment for every listed doctor in Egypt.';
    const names = ['alpha one', 'beta two', 'gamma three', 'delta four', 'epsilon five', 'zeta six'];
    const pages = names.flatMap((n) => bothLocales({ name: `Dr ${n}`, key: `doctor:${n.replace(' ', '-')}` }).map((p) => (p.locale === 'en' ? { ...p, text: `Dr ${n}. ${chrome}` } : p)));
    const en = pages.filter((p) => p.locale === 'en');
    expect(boilerplateOf(en, 3).size).toBeGreaterThan(10);
    const r = gate(pages).reports.find((x) => x.pageKey === 'doctor:alpha-one' && x.locale === 'en')!;
    expect(r.failedChecks).toContain('thin-content'); expect(r.details['thin-content']).toMatch(/unique words/);
  });
  it('similarity: a page copied from its parent hub is a near duplicate; a distinct sibling is not', () => {
    const hubText = 'Cardiologists in Cairo with real fees and languages. '.repeat(1) + 'Dr Sara Hassan Maadi 300 EGP Arabic English tomorrow afternoon 4.6 stars 38 visits. Dr Mona Adel Maadi 350 EGP English later this week 4.8 stars 51 visits. Dr Omar Nabil Dokki 280 EGP Arabic today 4.2 stars 12 visits and more doctors in the area with verified profiles listed on the platform for booking online.';
    const hub = bothLocales({ type: 'city', key: 'city:cardiology/cairo', name: 'Cardiology in Cairo' }).map((p) => (p.locale === 'en' ? { ...p, text: hubText } : p));
    const copy = bothLocales({ type: 'district', key: 'district:cardiology/cairo/maadi', name: 'Cardiology in Maadi' }).map((p) => (p.locale === 'en' ? { ...p, text: hubText } : p));
    expect(failed([...hub, ...copy], 'district:cardiology/cairo/maadi').failedChecks).toContain('similarity');
    const different = copy.map((p) => (p.locale === 'en' ? { ...p, text: 'Maadi is a leafy district south of central Cairo. Three cardiologists practise here, two of them speak English, fees run from 300 to 450 EGP and one has a slot today. Patients praise short waiting times and clear explanations at the two clinics on Road 9.' } : p));
    expect(failed([...hub, ...different], 'district:cardiology/cairo/maadi').failedChecks).not.toContain('similarity');
  });
  it('parity: an Arabic page that is English text, or a missing locale, fails; the complete locale omits the alternate and stays indexable', () => {
    const en = page({ locale: 'en' }); const arEnglish = page({ locale: 'ar', text: page({ locale: 'en' }).text });
    const rAr = gate([en, arEnglish]).reports.find((r) => r.locale === 'ar')!; const rEn = gate([en, arEnglish]).reports.find((r) => r.locale === 'en')!;
    expect(rAr.failedChecks).toContain('parity-ar-en'); expect(rAr.wouldNoindex).toBe(true);
    expect(rEn.failedChecks).toContain('parity-ar-en'); expect(rEn.wouldNoindex).toBe(false); expect(rEn.omitAlternates).toEqual(['ar']);
    expect(failed([en], 'doctor:sara-hassan').failedChecks).toContain('parity-ar-en'); // no ar page at all
  });
  it('title and description: too short, leaked placeholder, duplicate', () => {
    const a = bothLocales({ key: 'doctor:a-one', name: 'Dr A One' }); const b = bothLocales({ key: 'doctor:b-two', name: 'Dr B Two' });
    expect(failed(a.map((p) => ({ ...p, title: 'Short' })), 'doctor:a-one').details['title-meta']).toMatch(/title 5 characters/);
    expect(failed(a.map((p) => ({ ...p, title: 'Dr {name} cardiologist | Kiorex' })), 'doctor:a-one').details['title-meta']).toMatch(/placeholder/);
    const dup = [...a, ...b].map((p) => ({ ...p, title: 'Cardiologist in Maadi Cairo | Kiorex', description: `${p.description} Same.` }));
    expect(failed(dup, 'doctor:a-one').details['title-meta']).toMatch(/duplicate title/);
    expect(failed(a, 'doctor:a-one').failedChecks).not.toContain('title-meta');
  });
  it('structured data: forbidden contact keys, unknown types, missing required properties, review markup', () => {
    const bad = (jsonLd: unknown[], o: Partial<PageContent> = {}) => bothLocales({ jsonLd, ...o });
    expect(failed(bad([{ '@context': 'https://schema.org', '@type': 'Physician', name: 'X', telephone: '+20100' }]), 'doctor:sara-hassan').failedChecks).toContain('structured-data');
    expect(failed(bad([{ '@context': 'https://schema.org', '@type': 'Product', name: 'X' }]), 'doctor:sara-hassan').failedChecks).toContain('structured-data');
    expect(failed(bad([{ '@context': 'https://schema.org', '@type': 'Physician' }]), 'doctor:sara-hassan').details['structured-data']).toMatch(/needs name/);
    expect(failed(bad([]), 'doctor:sara-hassan').details['structured-data']).toMatch(/no JSON-LD/);
    const rated = bothLocales({ jsonLd: [{ '@context': 'https://schema.org', '@type': 'Physician', name: 'X', aggregateRating: { '@type': 'AggregateRating', ratingValue: 4.5, reviewCount: 9 } }], visibleReviews: 9 });
    expect(failed(rated, 'doctor:sara-hassan').failedChecks).toContain('review-markup'); // markup switched off
    expect(failed(rated, 'doctor:sara-hassan', 'en', { reviewMarkupEnabled: true }).failedChecks).not.toContain('review-markup');
    expect(failed(bothLocales({ jsonLd: rated[0]!.jsonLd, visibleReviews: 2 }), 'doctor:sara-hassan', 'en', { reviewMarkupEnabled: true }).details['review-markup']).toMatch(/2 visible reviews/);
    expect(requiredProps({ '@type': 'BreadcrumbList', itemListElement: [] })).toHaveLength(1);
  });
  it('canonical: wrong host, query, trailing slash, noindex candidate', () => {
    for (const [c, re] of [[`${HOST}/en/eg/doctor/sara-hassan?utm=x`, /differs|query/], [`${HOST}/en/eg/doctor/sara-hassan/`, /trailing|differs/], ['', /no canonical/], ['https://evil.test/en/eg/doctor/sara-hassan', /differs/]] as const) {
      expect(failed(bothLocales({ canonical: c }), 'doctor:sara-hassan').details.canonical).toMatch(re);
    }
    expect(failed(bothLocales({ robots: 'noindex,follow' }), 'doctor:sara-hassan').details.canonical).toMatch(/noindex/);
  });
  it('hreflang: missing, no x-default, relative, and a one-way pair', () => {
    expect(failed(bothLocales({ alternates: [] }), 'doctor:sara-hassan').details.hreflang).toMatch(/no hreflang/);
    const noDefault = bothLocales(); noDefault.forEach((p) => { p.alternates = p.alternates.filter((a) => a.hreflang !== 'x-default'); });
    expect(failed(noDefault, 'doctor:sara-hassan').details.hreflang).toMatch(/x-default/);
    const oneWay = [page({ locale: 'en' }), page({ locale: 'ar', alternates: [{ hreflang: 'ar', href: `${HOST}/ar/eg/doctor/sara-hassan` }, { hreflang: 'x-default', href: `${HOST}/ar/eg/doctor/sara-hassan` }] })];
    expect(failed(oneWay, 'doctor:sara-hassan', 'en').details.hreflang).toMatch(/does not point back|alternate/);
    expect(failed(bothLocales({ alternates: [{ hreflang: 'en', href: '/en/eg/doctor/sara-hassan' }, { hreflang: 'ar', href: '/ar/x' }] }), 'doctor:sara-hassan').details.hreflang).toMatch(/not absolute/);
  });
  it('orphan: a page with no inbound link is a warning, the home page is exempt', () => {
    const r = gate(bothLocales(), { orphans: new Set(['doctor:sara-hassan']) }).reports[0]!;
    expect(r.failedChecks).toEqual(['orphan']); expect(r.blockingFailed).toEqual([]); expect(r.score).toBe(95); expect(r.wouldNoindex).toBe(false);
    expect(gate(bothLocales({ type: 'home', key: 'home:' }), { orphans: new Set(['home:']) }).reports[0]!.failedChecks).toEqual([]);
  });
  it('medical claims and superlatives in English and Arabic, with spacing and diacritics not hiding them', () => {
    expect(failed(bothLocales({ description: `${page({}).description} Guaranteed cure for every patient.` }), 'doctor:sara-hassan').details.claims).toMatch(/guaranteed cure/);
    expect(failed(bothLocales({ text: `${page({ locale: 'ar' }).text} علاجٌ  مضمون لكل مريض.` }).map((p) => p), 'doctor:sara-hassan', 'ar').details.claims).toMatch(/علاج مضمون/);
    expect(failed(bothLocales({ h1: ['The BEST   doctor in Cairo'] }), 'doctor:sara-hassan').failedChecks).toContain('claims');
    expect(failed(bothLocales(), 'doctor:sara-hassan').failedChecks).not.toContain('claims');
  });
  it('availability hubs need enough available providers', () => {
    const p = bothLocales({ type: 'same-day', key: 'same-day:cardiology', name: 'Same-day cardiology', availableProviders: 1, liveProviders: 3 });
    expect(failed(p, 'same-day:cardiology').details['available-providers']).toMatch(/1 available, 2 needed/);
    expect(failed(bothLocales({ type: 'same-day', key: 'same-day:cardiology', name: 'Same-day cardiology', availableProviders: 3, liveProviders: 3 }), 'same-day:cardiology').failedChecks).not.toContain('available-providers');
  });
  it('a listing with no provider is an empty page', () => {
    expect(failed(bothLocales({ type: 'district', key: 'district:cardiology/giza/dokki', name: 'Cardiology in Dokki', liveProviders: 0 }), 'district:cardiology/giza/dokki').failedChecks).toContain('empty-page');
  });
});

describe('quality gate: scoring, determinism, summary', () => {
  it('blocking failures cost 20 points, warnings 5; the same crawl gives the same reports in any page order', () => {
    const pages = [...bothLocales({ key: 'doctor:a-one', name: 'Dr A One' }), ...bothLocales({ key: 'doctor:b-two', name: 'Dr B Two', canonical: '' })];
    const a = gate(pages).reports; const b = gate([...pages].reverse()).reports;
    const norm = (r: typeof a) => r.map((x) => `${x.pageKey}|${x.locale}|${x.score}|${x.failedChecks.join(',')}|${x.contentHash}`).sort();
    expect(norm(a)).toEqual(norm(b));
    const x = a.find((r) => r.pageKey === 'doctor:b-two' && r.locale === 'en')!;
    expect(x.failedChecks).toContain('canonical'); expect(x.score).toBe(100 - 20 * x.blockingFailed.length - 5 * (x.failedChecks.length - x.blockingFailed.length));
  });
  it('the config decides which checks block; summary groups by template', () => {
    const lenient = { ...cfg, blocking: [] as typeof cfg.blocking };
    const r = runGate({ pages: bothLocales({ canonical: '' }), cfg: lenient, host: HOST, reviewMarkupEnabled: false, reviewMarkupMinCount: 5, minAvailableProviders: 2 }).reports[0]!;
    expect(r.blockingFailed).toEqual([]); expect(r.wouldNoindex).toBe(false);
    expect(summarise(gate(bothLocales()).reports)).toEqual([{ template: 'doctor', pages: 2, failed: 0, avgScore: 100, checks: {} }]);
  });
});

describe('SEO_AUTOMATION config', () => {
  it('defaults are valid and autoNoindex is off', () => { expect(cfg.autoNoindex).toBe(false); expect(validateSeoAutomation(cfg)).toEqual({ valid: true, errors: [] }); });
  it('rejects bad pieces; merge ignores them one by one', () => {
    const v = validateSeoAutomation({ autoNoindex: 'yes', minUniqueWords: { nope: 1, doctor: -1 }, blocking: ['x'], title: { min: 80, max: 20 }, links: { maxPerPage: 0, relatedSpecialties: { cardiology: ['Bad Slug'] } }, vitals: { cls: 3 }, forbiddenClaims: { en: ['<b>'] } });
    expect(v.valid).toBe(false); expect(v.errors.length).toBeGreaterThanOrEqual(7);
    const m = mergeSeoAutomation(cfg, { autoNoindex: true, maxSimilarityPercent: 70, title: { min: 80, max: 20 }, vitals: { cls: 9, lcpMs: 3000 }, links: { maxPerPage: 30 } });
    expect(m.autoNoindex).toBe(true); expect(m.maxSimilarityPercent).toBe(70); expect(m.title).toEqual(cfg.title); expect(m.vitals).toMatchObject({ cls: 0.1, lcpMs: 3000 }); expect(m.links.maxPerPage).toBe(30); expect(m.links.maxPerAnchorKind).toBe(3);
  });
});
