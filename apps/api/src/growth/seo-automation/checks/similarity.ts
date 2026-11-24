import { containment, jaccard } from '../text';
import { parentKey, pageId, siblingKeys, type CheckContext, type CheckResult, type PageContent } from '../page-model';

/**
 * Near duplicates: unique-text shingle overlap with the parent hub and with siblings (same type, same parent). Jaccard catches two pages of one size, containment a page that is a copy of
 * (part of) a bigger one. Provider-set overlap with the parent stays in the thin-page guard (`maxParentSimilarityPercent`); this is the text side.
 */
export function similarity(p: PageContent, c: CheckContext): CheckResult[] {
  const mine = c.uniqueShingles(p);
  if (mine.size < 3) return [{ id: 'similarity', ok: true, severity: 'block' }];
  const limit = c.cfg.maxSimilarityPercent / 100;
  let worst = { pct: 0, other: '' };
  const consider = (key: string, withContainment: boolean) => {
    const o = c.pages.get(pageId(key, p.locale)); if (!o) return;
    const theirs = c.uniqueShingles(o);
    const s = Math.max(jaccard(mine, theirs), withContainment ? containment(mine, theirs) : 0);
    if (s > worst.pct) worst = { pct: s, other: key };
  };
  const pk = parentKey(p.pageKey); if (pk) consider(pk, true);
  for (const k of siblingKeys(p.pageKey, [...c.pages.keys()].filter((x) => x.endsWith(`|${p.locale}`)).map((x) => x.slice(0, -3)))) consider(k, false);
  return worst.pct > limit ? [{ id: 'similarity', ok: false, severity: 'block', detail: `${Math.round(worst.pct * 100)}% of unique text matches ${worst.other}` }] : [{ id: 'similarity', ok: true, severity: 'block' }];
}
