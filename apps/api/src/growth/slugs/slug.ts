/**
 * Slug rules (ARCH section 4.1): lowercase ASCII `[a-z0-9-]{3,60}`, identical in Arabic and English pages. Pure helpers; the service adds uniqueness and history.
 * An Arabic-only name is transliterated with a plain letter map (it is a URL token, not a translation), so every entity can get a slug.
 */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/;
export const SLUG_ENTITY_TYPES = ['DOCTOR', 'CLINIC', 'PHARMACY', 'LAB', 'SPECIALTY', 'CITY', 'DISTRICT'] as const;
export type SlugEntityType = (typeof SLUG_ENTITY_TYPES)[number];
const RESERVED = new Set(['new', 'search', 'all', 'admin', 'api', 'app', 'login', 'preferences', 'sitemap', 'robots', 'static', 'assets']);

const AR: Record<string, string> = {
  ا: 'a', أ: 'a', إ: 'e', آ: 'a', ب: 'b', ت: 't', ث: 'th', ج: 'g', ح: 'h', خ: 'kh', د: 'd', ذ: 'z', ر: 'r', ز: 'z', س: 's', ش: 'sh', ص: 's', ض: 'd', ط: 't', ظ: 'z', ع: 'a', غ: 'gh',
  ف: 'f', ق: 'q', ك: 'k', ل: 'l', م: 'm', ن: 'n', ه: 'h', ة: 'a', و: 'w', ي: 'y', ى: 'a', ء: '', ئ: 'e', ؤ: 'o',
};

export function slugify(input: string): string {
  const mapped = [...input.normalize('NFKD').replace(/[ً-ٰٟـ]/g, '')].map((ch) => AR[ch] ?? ch).join('');
  let s = mapped.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
  if (s.length > 60) s = s.slice(0, 60).replace(/-+$/g, '');
  return s;
}

/** A slug candidate that always satisfies the pattern: a short, stable fallback from the entity id when the name yields too little. */
export function candidateSlug(name: string | null | undefined, type: SlugEntityType, entityId: string): string {
  const base = slugify(name ?? '');
  const ok = SLUG_PATTERN.test(base) && !RESERVED.has(base);
  if (ok) return base;
  const tail = entityId.toLowerCase().replace(/[^a-z0-9]/g, '').slice(-8) || 'x0000000';
  return `${type.toLowerCase()}-${tail}`.slice(0, 60);
}
export const withSuffix = (base: string, n: number) => { const suf = `-${n}`; return `${base.slice(0, 60 - suf.length).replace(/-+$/g, '')}${suf}`; };
