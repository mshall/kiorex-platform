import { pageId, type CheckContext, type CheckResult, type PageContent } from '../page-model';
import { wordCount } from '../text';

const ARABIC = /[؀-ۿ]/;
const LATIN = /[A-Za-z]/;
const share = (s: string, re: RegExp): number => { const letters = s.match(/\p{L}/gu) ?? []; return letters.length ? letters.filter((l) => re.test(l)).length / letters.length : 0; };

/**
 * Both locales complete: an indexable page needs a title, description, heading and real text in BOTH Arabic and English, each in the right script. When one is not,
 * the page FAILS parity for BOTH locales (the gate then sets the incomplete locale noindex and drops its hreflang; the complete locale stays indexable without an alternate).
 */
export function completeProblems(x: PageContent): string[] {
    const m: string[] = [];
    if (!x.title.trim()) m.push(`${x.locale} title empty`);
    if (!x.description.trim()) m.push(`${x.locale} description empty`);
    if (!x.h1.length) m.push(`${x.locale} heading missing`);
    if (wordCount(x.text) < 10) m.push(`${x.locale} text too short`);
    // an Arabic page that is mostly Latin letters (or the reverse) is an untranslated page; brand and provider names in the other script are expected, so the bar is a majority
    const mine = x.locale === 'ar' ? share(x.text, ARABIC) : share(x.text, LATIN);
    if (x.text.trim() && mine < 0.5) m.push(`${x.locale} text is not mostly ${x.locale === 'ar' ? 'Arabic' : 'English'}`);
    return m;
}

export function parity(p: PageContent, c: CheckContext): CheckResult[] {
  const other = c.pages.get(pageId(p.pageKey, p.locale === 'ar' ? 'en' : 'ar'));
  const problems: string[] = [];
  const complete = completeProblems;
  problems.push(...complete(p));
  if (!other) problems.push(`${p.locale === 'ar' ? 'en' : 'ar'} page missing`); else problems.push(...complete(other).filter((m) => !problems.includes(m)));
  return problems.length ? [{ id: 'parity-ar-en', ok: false, severity: 'block', detail: problems.slice(0, 4).join('; ') }] : [{ id: 'parity-ar-en', ok: true, severity: 'block' }];
}
