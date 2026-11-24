import { pageId, type CheckContext, type CheckResult, type PageContent } from '../page-model';

/** hreflang: self-reference, the other locale, x-default, absolute URLs, and RECIPROCITY (the page the alternate points to points back). */
export function hreflang(p: PageContent, c: CheckContext): CheckResult[] {
  const issues: string[] = [];
  const by = new Map(p.alternates.map((a) => [a.hreflang.toLowerCase(), a.href]));
  if (!by.size) issues.push('no hreflang');
  else {
    if (by.get(p.locale) !== p.expectedCanonical) issues.push(`no self reference for ${p.locale}`);
    const otherLoc = p.locale === 'ar' ? 'en' : 'ar';
    if (!by.has(otherLoc)) issues.push(`no ${otherLoc} alternate`);
    if (!by.has('x-default')) issues.push('no x-default');
    for (const [l, h] of by) if (!/^https?:\/\//.test(h)) issues.push(`hreflang ${l} is not absolute`);
    const other = c.pages.get(pageId(p.pageKey, otherLoc));
    if (other && by.has(otherLoc)) {
      const back = new Map(other.alternates.map((a) => [a.hreflang.toLowerCase(), a.href]));
      if (back.get(p.locale) !== p.expectedCanonical) issues.push(`${otherLoc} page does not point back`);
      if (by.get(otherLoc) !== other.expectedCanonical) issues.push(`${otherLoc} alternate is not that page's canonical`);
    }
  }
  return issues.length ? [{ id: 'hreflang', ok: false, severity: 'block', detail: issues.join('; ') }] : [{ id: 'hreflang', ok: true, severity: 'block' }];
}
