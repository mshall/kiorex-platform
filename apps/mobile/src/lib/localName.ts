/**
 * Bilingual partner catalogue names (contracts 1.8.0): the pharmacy / lab sends `nameAr`, `formAr`, `preparationAr` only where it holds them.
 * Arabic UI shows the Arabic text when present; everything falls back to the English one, never a blank.
 */
const isAr = (lang: string | undefined) => (lang ?? "").toLowerCase().startsWith("ar");
export function localized(lang: string | undefined, en: string | null | undefined, ar: string | null | undefined): string {
  const a = ar?.trim();
  return isAr(lang) && a ? a : (en ?? a ?? "");
}
export const medName = (lang: string | undefined, m: { name: string; nameAr?: string | null }) => localized(lang, m.name, m.nameAr);
export const medForm = (lang: string | undefined, m: { form?: string | null; formAr?: string | null }) => localized(lang, m.form, m.formAr);
