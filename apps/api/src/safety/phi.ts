import { normalizeText } from './text';

export type PhiKind = 'PHONE' | 'EMAIL' | 'NATIONAL_ID' | 'URL' | 'NAME_CLAIM';

const RE: [PhiKind, RegExp][] = [
  ['EMAIL', /[\w.+-]+@[\w-]+\.[\w.-]+/g],
  ['URL', /\bhttps?:\/\/\S+/gi],
  ['NATIONAL_ID', /(?<!\d)[23]\d{13}(?!\d)/g], // Egyptian national ID: 14 digits starting 2/3
  ['PHONE', /(?<!\d)(?:\+?20|0)?1[0-25]\d{8}(?!\d)|(?<!\d)\+?\d[\d\s-]{8,13}\d(?!\d)/g],
  ['NAME_CLAIM', /\b(?:my name is|i am|i'm)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?|(?:اسمي|انا)\s+[؀-ۿ]{2,}(?:\s+[؀-ۿ]{2,})?/g],
];

function arabicDigitsToAscii(s: string) {
  return s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

/** Detect PHI/PII patterns in free text (reviews, AI prompts). Returns kinds only. */
export function detectPhi(text: string): PhiKind[] {
  const t = arabicDigitsToAscii(text);
  return RE.filter(([, re]) => { re.lastIndex = 0; return re.test(t); }).map(([k]) => k);
}

/** Redact before any provider call (KX-11 gateway: market redaction). */
export function redactPhi(text: string): { text: string; count: number } {
  let out = arabicDigitsToAscii(text);
  let count = 0;
  for (const [kind, re] of RE) {
    out = out.replace(re, () => { count++; return `[${kind}]`; });
  }
  return { text: out, count };
}

/** NEEDS_HUMAN: abuse lexicon is a seed list; Trust & Safety owner must extend (EN/AR). */
const ABUSE = ['idiot', 'stupid', 'scam', 'fraud', 'thief', 'kill you', 'shut up', 'غبي', 'حرامي', 'نصاب', 'نصب', 'اقتلك', 'حيوان', 'كلب'];
const NABUSE = ABUSE.map(normalizeText);
export function detectAbuse(text: string): boolean {
  const n = normalizeText(text);
  return NABUSE.some((w) => n.includes(w));
}
