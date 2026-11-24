import type { CheckContext, CheckResult, PageContent } from '../page-model';

/** A page with no inbound internal link from another indexable page is invisible to a crawler that does not read the sitemap. The home page has no inbound by definition. A warning (the link builder fixes most). */
export function orphan(p: PageContent, c: CheckContext): CheckResult[] {
  if (p.templateKind === 'home') return [{ id: 'orphan', ok: true, severity: 'warn' }];
  return c.orphans.has(p.pageKey) ? [{ id: 'orphan', ok: false, severity: 'warn', detail: 'no inbound internal link' }] : [{ id: 'orphan', ok: true, severity: 'warn' }];
}
