import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import "./rtl.css";
import ar from "./locales/ar.json";
import en from "./locales/en.json";
import growthStubs from "./growth.stubs.json";
import growthCampaigns from "./growth.campaigns.json";

/** Deep merge: the namespaced per-package files (GRW-P2-X1: `growth.<pkg>.json`, shape {en,ar}) add keys and never reorder or overwrite the main catalogue. */
const merge = (base: Record<string, any>, ...extra: Array<Record<string, any>>): Record<string, any> => {
  const out: Record<string, any> = { ...base };
  for (const e of extra) for (const [k, v] of Object.entries(e)) out[k] = v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" ? merge(out[k], v) : out[k] === undefined ? v : out[k];
  return out;
};

export const SUPPORTED = ["ar", "en"] as const;
export type Lang = (typeof SUPPORTED)[number];

export const isRTL = (language: string) => language.startsWith("ar");

export const setDocumentDirection = (language: string) => {
  if (typeof document === "undefined") return;
  document.documentElement.dir = isRTL(language) ? "rtl" : "ltr";
  document.documentElement.lang = language.startsWith("ar") ? "ar" : "en";
};

// Ops console is EN by default; AR available (explicit choice only).
void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { ar: { translation: merge(ar, growthStubs.ar, growthCampaigns.ar) }, en: { translation: merge(en, growthStubs.en, growthCampaigns.en) } },
    fallbackLng: "en",
    supportedLngs: SUPPORTED as unknown as string[],
    interpolation: { escapeValue: false },
    detection: { order: ["localStorage"], lookupLocalStorage: "kx-lang", caches: ["localStorage"] },
    returnNull: false,
  });

i18n.on("languageChanged", setDocumentDirection);
setDocumentDirection(i18n.language ?? "en");

export default i18n;
