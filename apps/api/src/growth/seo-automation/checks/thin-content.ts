import type { CheckContext, CheckResult, PageContent } from '../page-model';

const PLACEHOLDER = /coming soon|lorem ipsum|\bTBD\b|under construction|page not found|undefined|\[object Object\]|{{|}}|قريبا|قريباً|قريبًا|سيتم الإضافة|تحت الإنشاء|لا توجد نتائج/i;

/** Minimum unique text per template, and no empty, placeholder or "coming soon" pages. */
export function thinContent(p: PageContent, c: CheckContext): CheckResult[] {
  const out: CheckResult[] = [];
  const min = c.cfg.minUniqueWords[p.templateKind];
  const unique = c.uniqueWordCount(p);
  out.push(unique >= min ? { id: 'thin-content', ok: true, severity: 'block' } : { id: 'thin-content', ok: false, severity: 'block', detail: `${unique} unique words, ${min} needed` });
  const placeholder = PLACEHOLDER.exec(`${p.title} ${p.description} ${p.text}`)?.[0];
  const empty = p.h1.length === 0 || !p.text.trim() || (p.liveProviders !== undefined && p.liveProviders === 0 && ['hub', 'city', 'district', 'care-district', 'city-hub', 'district-hub', 'same-day', 'telemedicine'].includes(p.templateKind));
  out.push(placeholder || empty ? { id: 'empty-page', ok: false, severity: 'block', detail: placeholder ? `placeholder text: ${placeholder}` : 'no heading, no text or no provider' } : { id: 'empty-page', ok: true, severity: 'block' });
  // availability hubs and specialty plus district pages need real availability behind them
  if (p.availableProviders !== undefined && ['same-day', 'telemedicine'].includes(p.templateKind)) {
    out.push(p.availableProviders >= c.minAvailableProviders ? { id: 'available-providers', ok: true, severity: 'block' } : { id: 'available-providers', ok: false, severity: 'block', detail: `${p.availableProviders} available, ${c.minAvailableProviders} needed` });
  }
  return out;
}
