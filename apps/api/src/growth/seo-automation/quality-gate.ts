import { createHash } from 'node:crypto';
import { CHECKS } from './checks';
import { completeProblems } from './checks/parity-ar-en';
import { pageId, type CheckContext, type CheckResult, type PageContent, type PageLocale } from './page-model';
import type { CheckId, SeoAutomationConfig } from './seo-automation-config';
import { shingles, tokens } from './text';

/** Content-quality gate (GRW-P3-F). Pure: a crawl of pages in, one report per page and locale out. No network, no database, deterministic. */
export interface GateInput {
  pages: PageContent[];
  cfg: SeoAutomationConfig;
  host: string;
  reviewMarkupEnabled: boolean;
  reviewMarkupMinCount: number;
  minAvailableProviders: number;
  /** page keys without an inbound internal link (from the link graph); empty when the graph was not built */
  orphans?: ReadonlySet<string>;
}

export interface PageReport {
  pageKey: string; templateKind: string; locale: PageLocale;
  score: number; failedChecks: CheckId[]; blockingFailed: CheckId[]; details: Partial<Record<CheckId, string>>; contentHash: string;
  /** the decision the gate WOULD take; it is applied only when `autoNoindex` is on */
  wouldNoindex: boolean;
  /** locales whose hreflang alternate this page should omit (the other locale is incomplete or noindex) */
  omitAlternates: PageLocale[];
}

const BOILERPLATE_SHARE = 0.6;
const BOILERPLATE_MIN_PAGES = 5;

/** Shingles that appear in at least 60 percent of the pages of one template and locale (needs five pages): the template's own words, not the page's content. */
export function boilerplateOf(pages: readonly PageContent[], n: number): Set<string> {
  const out = new Set<string>();
  if (pages.length < BOILERPLATE_MIN_PAGES) return out;
  const df = new Map<string, number>();
  for (const p of pages) for (const s of shingles(tokens(p.text), n)) df.set(s, (df.get(s) ?? 0) + 1);
  for (const [s, c] of df) if (c / pages.length >= BOILERPLATE_SHARE) out.add(s);
  return out;
}

export const contentHashOf = (p: PageContent): string => createHash('sha256').update(JSON.stringify([p.title, p.description, p.h1, p.text, p.jsonLd, p.canonical, p.alternates, p.robots])).digest('hex').slice(0, 32);

export function runGate(input: GateInput): { reports: PageReport[]; context: CheckContext } {
  const { cfg } = input;
  const pages = new Map(input.pages.map((p) => [pageId(p.pageKey, p.locale), p]));
  const groups = new Map<string, PageContent[]>();
  for (const p of input.pages) { const g = `${p.templateKind}|${p.locale}`; groups.set(g, [...(groups.get(g) ?? []), p]); }
  const boiler = new Map([...groups].map(([g, ps]) => [g, boilerplateOf(ps, 3)]));
  const uniqueTokens = new Map<string, string[]>();
  const uniq = (p: PageContent): string[] => {
    const id = pageId(p.pageKey, p.locale); const hit = uniqueTokens.get(id); if (hit) return hit;
    const toks = tokens(p.text); const b = boiler.get(`${p.templateKind}|${p.locale}`)!;
    let out = toks;
    if (b.size) {
      const covered = new Array<boolean>(toks.length).fill(false);
      for (let i = 0; i + 3 <= toks.length; i++) if (b.has(toks.slice(i, i + 3).join(' '))) { covered[i] = covered[i + 1] = covered[i + 2] = true; }
      out = toks.filter((_, i) => !covered[i]);
    }
    uniqueTokens.set(id, out); return out;
  };
  const sh = new Map<string, Set<string>>();
  const owners = (field: 'title' | 'description', locale: PageLocale): Map<string, string[]> => {
    const m = new Map<string, string[]>();
    for (const p of input.pages) if (p.locale === locale && p[field]) m.set(p[field], [...(m.get(p[field]) ?? []), p.pageKey]);
    return m;
  };
  const titles = { ar: owners('title', 'ar'), en: owners('title', 'en') }; const descs = { ar: owners('description', 'ar'), en: owners('description', 'en') };
  // ctx.titleOwners is per page locale: a Proxy-free approach is one context per locale
  const ctxFor = (locale: PageLocale): CheckContext => ({
    cfg, host: input.host, reviewMarkupEnabled: input.reviewMarkupEnabled, reviewMarkupMinCount: input.reviewMarkupMinCount, minAvailableProviders: input.minAvailableProviders, pages,
    uniqueShingles: (p) => { const id = pageId(p.pageKey, p.locale); let s = sh.get(id); if (!s) { s = shingles(uniq(p), cfg.shingleSize); sh.set(id, s); } return s; },
    uniqueWordCount: (p) => uniq(p).length, titleOwners: titles[locale], descriptionOwners: descs[locale], orphans: input.orphans ?? new Set(),
  });
  const ctx = { ar: ctxFor('ar'), en: ctxFor('en') };

  const reports: PageReport[] = [];
  for (const p of input.pages) {
    const results: CheckResult[] = CHECKS.flatMap((f) => { try { return f(p, ctx[p.locale]); } catch (e) { return [{ id: 'empty-page' as CheckId, ok: false, severity: 'warn' as const, detail: `check crashed: ${(e as Error).message.slice(0, 60)}` }]; } });
    const failed = results.filter((r) => !r.ok);
    const blockingFailed = failed.filter((r) => cfg.blocking.includes(r.id)).map((r) => r.id);
    const score = Math.max(0, 100 - failed.reduce((s, r) => s + (cfg.blocking.includes(r.id) ? 20 : 5), 0));
    const other = pages.get(pageId(p.pageKey, p.locale === 'ar' ? 'en' : 'ar'));
    const selfIncomplete = completeProblems(p).length > 0; const otherIncomplete = !other || completeProblems(other).length > 0;
    const parityFailed = failed.some((r) => r.id === 'parity-ar-en');
    // parity: only the incomplete locale is noindex; the complete one stays indexable and omits the alternate that would point to an incomplete page
    const wouldNoindex = blockingFailed.some((id) => id !== 'parity-ar-en' && id !== 'hreflang') || (parityFailed && selfIncomplete) || (blockingFailed.includes('hreflang') && !parityFailed);
    reports.push({
      pageKey: p.pageKey, templateKind: p.templateKind, locale: p.locale, score, failedChecks: failed.map((r) => r.id), blockingFailed,
      details: Object.fromEntries(failed.filter((r) => r.detail).map((r) => [r.id, r.detail!])) as Partial<Record<CheckId, string>>, contentHash: contentHashOf(p), wouldNoindex,
      omitAlternates: parityFailed && otherIncomplete ? [p.locale === 'ar' ? 'en' : 'ar'] : [],
    });
  }
  return { reports, context: ctx.ar };
}

/** Summary by template for the ops tab. */
export function summarise(reports: readonly PageReport[]) {
  const by = new Map<string, { template: string; pages: number; failed: number; avgScore: number; checks: Record<string, number> }>();
  for (const r of reports) {
    const s = by.get(r.templateKind) ?? { template: r.templateKind, pages: 0, failed: 0, avgScore: 0, checks: {} };
    s.pages++; s.avgScore += r.score; if (r.failedChecks.length) s.failed++;
    for (const c of r.failedChecks) s.checks[c] = (s.checks[c] ?? 0) + 1;
    by.set(r.templateKind, s);
  }
  return [...by.values()].map((s) => ({ ...s, avgScore: Math.round(s.avgScore / s.pages) })).sort((a, b) => (a.template < b.template ? -1 : 1));
}
