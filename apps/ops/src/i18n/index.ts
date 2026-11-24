import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import "./rtl.css";
import ar from "./locales/ar.json";
import en from "./locales/en.json";
import growthStubs from "./growth.stubs.json";
import growthCampaigns from "./growth.campaigns.json";

/** Deep merge: the namespaced per-package files (GRW-P2-X1: `growth.<pkg>.json`, shape {en,ar}) add keys and never reorder or overwrite the main catalogue. */
type Tree = { [key: string]: unknown };
const isTree = (v: unknown): v is Tree => !!v && typeof v === "object" && !Array.isArray(v);
export const merge = (base: Tree, ...extra: Tree[]): Tree => {
  const out: Tree = { ...base };
  for (const e of extra) for (const [k, v] of Object.entries(e)) {
    const cur = out[k];
    out[k] = isTree(v) && isTree(cur) ? merge(cur, v) : cur === undefined ? v : cur;
  }
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
