/** Text tools of the SEO checks: tokenising (Arabic and English), shingles, Jaccard similarity. Pure. */
const AR_DIACRITICS = /[ً-ٰٟـ]/g;
const TAGS = /<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi;

/** Visible text of an HTML fragment: scripts, styles and tags removed, entities decoded, whitespace collapsed. */
export function visibleText(html: string): string {
  return html.replace(TAGS, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}

/** Lower-case word tokens (letters and digits of any script); Arabic diacritics and tatweel are removed and the common letter variants folded. */
export function tokens(text: string): string[] {
  const t = text.toLowerCase().replace(AR_DIACRITICS, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
  return t.match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function shingles(toks: readonly string[], n: number): Set<string> {
  const out = new Set<string>();
  if (toks.length < n) { if (toks.length) out.add(toks.join(' ')); return out; }
  for (let i = 0; i + n <= toks.length; i++) out.add(toks.slice(i, i + n).join(' '));
  return out;
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (!a.size && !b.size) return 0;
  let inter = 0; const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) if (large.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
/** Share of `a` that is also in `b` (containment): a short page copied inside a long one scores 1 here and low in Jaccard. */
export function containment(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (!a.size) return 0;
  let inter = 0; for (const x of a) if (b.has(x)) inter++;
  return inter / a.size;
}

export const wordCount = (text: string): number => tokens(text).length;
