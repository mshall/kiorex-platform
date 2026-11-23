/**
 * Bilingual partner catalogue names (contracts 1.8.0). The pharmacy / lab sends `nameAr` / `formAr` / `preparationAr` / `sampleTypeAr` only where it
 * holds them; the app shows the Arabic text in Arabic and always falls back to the English one, never a blank.
 */
const isAr = (lang: string | undefined) => (lang ?? "").toLowerCase().startsWith("ar");
export function localized(lang: string | undefined, en: string | null | undefined, ar: string | null | undefined): string {
  const a = ar?.trim();
  return isAr(lang) && a ? a : (en ?? a ?? "");
}
type Named = { name: string; nameAr?: string | null };
export const medName = (lang: string | undefined, m: Named) => localized(lang, m.name, m.nameAr);
export const medForm = (lang: string | undefined, m: { form?: string | null; formAr?: string | null }) => localized(lang, m.form, m.formAr);
