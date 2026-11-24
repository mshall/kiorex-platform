import { candidateSlug, SLUG_PATTERN, slugify, type SlugEntityType } from '../slugs/slug';
import { stripLatinHonorifics, transliterateArabic } from './arabic';

/**
 * Slug proposal for a Kiorex entity (ARCH 4.1 rule 2): the Kiorly `bookingSlug` when it is a valid slug, else the transliterated English name, else
 * the transliterated Arabic name, else `<type>-<short id>`. The result always satisfies SLUG_PATTERN. Uniqueness (-2, -3 ...) is the SlugService's job.
 */
export interface SlugNames { bookingSlug?: string | null; nameEn?: string | null; nameAr?: string | null }

const RESERVED = new Set(['new', 'search', 'all', 'admin', 'api', 'app', 'login', 'preferences', 'sitemap', 'robots', 'static', 'assets']);

export function proposeSlug(names: SlugNames, type: SlugEntityType, entityId: string): { slug: string; source: 'BOOKING_SLUG' | 'NAME_EN' | 'NAME_AR' | 'FALLBACK' } {
  const bs = (names.bookingSlug ?? '').trim().toLowerCase();
  if (bs && SLUG_PATTERN.test(bs) && !RESERVED.has(bs)) return { slug: bs, source: 'BOOKING_SLUG' };
  const en = names.nameEn ? slugify(stripLatinHonorifics(transliterateArabic(names.nameEn))) : '';
  if (SLUG_PATTERN.test(en) && !RESERVED.has(en)) return { slug: en, source: 'NAME_EN' };
  const ar = names.nameAr ? slugify(transliterateArabic(names.nameAr)) : '';
  if (SLUG_PATTERN.test(ar) && !RESERVED.has(ar)) return { slug: ar, source: 'NAME_AR' };
  return { slug: candidateSlug(null, type, entityId), source: 'FALLBACK' };
}
