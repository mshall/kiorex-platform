import i18next, { type i18n } from "i18next";
import ar from "./locales/ar.json";
import en from "./locales/en.json";
import type { Bilingual, Locale, TemplateCtx } from "./types";

/**
 * Per-request i18n for the public tree. Unlike the SPA singleton (`@/i18n`, browser-storage language detection) the locale here comes ONLY from the URL
 * path, so server and client always render the same language and no browser API is touched during render.
 */
export function createPublicI18n(locale: Locale): i18n {
  const inst = i18next.createInstance();
  void inst.init({
    lng: locale, fallbackLng: "en", initAsync: false, interpolation: { escapeValue: false }, returnNull: false,
    resources: { ar: { translation: ar }, en: { translation: en } },
  });
  return inst;
}

export function makeCtx(i: i18n, base: Omit<TemplateCtx, "t" | "pick">): TemplateCtx {
  const locale = base.locale;
  return { ...base, t: (key, vars) => (vars ? (i.t(key, vars) as string) : (i.t(key) as string)), pick: (b: Bilingual) => (locale === "ar" ? b.ar || b.en : b.en || b.ar) };
}
