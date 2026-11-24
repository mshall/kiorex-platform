import type { Locale, PageMeta } from "../types";

/** Title and description shaping (GRW-P1-E hook; GRW-P1-F extends the copy). Pure and unit-tested. */
export const TITLE_MAX = 60;
export const DESCRIPTION_MAX = 155;

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

export function clamp(s: string, max: number): string {
  const v = collapse(s);
  if (v.length <= max) return v;
  const cut = v.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:|\-–—]+$/, "")}…`;
}

const SUFFIX: Record<Locale, string> = { ar: "كيوركس", en: "Kiorex" };

/** `Page title | Kiorex`, at most 60 characters: the brand suffix is dropped before the page title is cut. */
export function buildTitle(page: string, locale: Locale): string {
  const suffix = ` | ${SUFFIX[locale]}`;
  const p = collapse(page);
  return p.length + suffix.length <= TITLE_MAX ? `${p}${suffix}` : clamp(p, TITLE_MAX);
}

export function buildMeta(title: string, description: string, locale: Locale, ogImage?: string | null): PageMeta {
  return { title: buildTitle(title, locale), description: clamp(description, DESCRIPTION_MAX), ...(ogImage ? { ogImage } : {}) };
}
