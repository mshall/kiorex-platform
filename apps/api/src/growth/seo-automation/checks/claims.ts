import type { CheckContext, CheckResult, PageContent } from '../page-model';
import { tokens } from '../text';

/**
 * No medical claims and no unverifiable superlatives in titles, descriptions, headings or text (a health marketplace lists doctors; it does not promise outcomes).
 * Phrases come from the config list and are matched on normalised tokens, so spacing, case and Arabic diacritics do not hide a phrase. A hit is blocking.
 */
export function claims(p: PageContent, c: CheckContext): CheckResult[] {
  const hay = ` ${tokens(`${p.title} ${p.description} ${p.h1.join(' ')} ${p.text}`).join(' ')} `;
  const phrases = [...c.cfg.forbiddenClaims.en, ...c.cfg.forbiddenClaims.ar];
  const hit = phrases.find((ph) => { const t = tokens(ph).join(' '); return t.length > 0 && hay.includes(` ${t} `); });
  return hit ? [{ id: 'claims', ok: false, severity: 'block', detail: `claim phrase: ${hit}` }] : [{ id: 'claims', ok: true, severity: 'block' }];
}
