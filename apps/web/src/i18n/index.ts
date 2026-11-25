import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import "./rtl.css";
import ar from "./locales/ar.json";
import en from "./locales/en.json";
import referralAr from "./referral.ar.json";
import corporateAr from "./corporate.ar.json";
import corporateEn from "./corporate.en.json";
import loyaltyAr from "./loyalty.ar.json";
import loyaltyEn from "./loyalty.en.json";
import referralEn from "./referral.en.json";
import continuityAr from "./continuity.ar.json";
import continuityEn from "./continuity.en.json";
import sponsoredAr from "./sponsored.ar.json";
import sponsoredEn from "./sponsored.en.json";

export const SUPPORTED = ["ar", "en"] as const;
export type Lang = (typeof SUPPORTED)[number];

export const isRTL = (language: string) => language.startsWith("ar");

export const setDocumentDirection = (language: string) => {
  if (typeof document === "undefined") return;
  document.documentElement.dir = isRTL(language) ? "rtl" : "ltr";
  document.documentElement.lang = language.startsWith("ar") ? "ar" : "en";
};

// Arabic is the default (KX-19). Detection only honours an explicit user choice.
void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { ar: { translation: { ...ar, referral: referralAr, sponsored: sponsoredAr, continuity: continuityAr, corporate: corporateAr, loyalty: loyaltyAr } }, en: { translation: { ...en, referral: referralEn, sponsored: sponsoredEn, continuity: continuityEn, corporate: corporateEn, loyalty: loyaltyEn } } }, // GRW-P2-B3: namespace referral.* in its own files
    fallbackLng: "ar",
    supportedLngs: SUPPORTED as unknown as string[],
    interpolation: { escapeValue: false },
    detection: { order: ["localStorage"], lookupLocalStorage: "kx-lang", caches: ["localStorage"] },
    returnNull: false,
  });

i18n.on("languageChanged", setDocumentDirection);
setDocumentDirection(i18n.language ?? "ar");

export default i18n;
