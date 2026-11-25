import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import "./rtl.css";
import ar from "./locales/ar.json";
import en from "./locales/en.json";
import growthStubs from "./growth.stubs.json";
import growthCampaigns from "./growth.campaigns.json";
import growthIntegrations from "./growth.integrations.json";
import growthReferrals from "./growth.referrals.json";
import growthLifecycle from "./growth.lifecycle.json";
import growthWhatsapp from "./growth.whatsapp.json";
import growthAttributionModels from "./growth.attributionModels.json";
import growthSponsored from "./growth.sponsoredPromotions.json";
import growthExperiments from "./growth.experiments.json";
import growthFraudV2 from "./growth.fraudV2.json";
import growthSeoAutomation from "./growth.seoAutomation.json";
import growthAutomation from "./growth.automation.json";
import growthRecommendations from "./growth.recommendations.json";
import growthCohorts from "./growth.cohorts.json";
import growthMarketWizard from "./growth.marketWizard.json";
import growthCrossProduct from "./growth.crossProduct.json";
import growthCorporate from "./growth.corporate.json";
import growthLoyalty from "./growth.loyalty.json";
import integrationsCenter from "./integrationsCenter.json";
import payReady from "./pay.ready.json";
import messagingChannels from "./messaging.channels.json";

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
    resources: { ar: { translation: merge(ar, growthStubs.ar, growthCampaigns.ar, growthIntegrations.ar, growthReferrals.ar, growthLifecycle.ar, growthWhatsapp.ar, growthAttributionModels.ar, growthSponsored.ar, growthExperiments.ar, growthFraudV2.ar, growthSeoAutomation.ar, growthAutomation.ar, growthRecommendations.ar, growthCohorts.ar, growthMarketWizard.ar, growthCrossProduct.ar, growthCorporate.ar, growthLoyalty.ar, integrationsCenter.ar, payReady.ar, messagingChannels.ar) }, en: { translation: merge(en, growthStubs.en, growthCampaigns.en, growthIntegrations.en, growthReferrals.en, growthLifecycle.en, growthWhatsapp.en, growthAttributionModels.en, growthSponsored.en, growthExperiments.en, growthFraudV2.en, growthSeoAutomation.en, growthAutomation.en, growthRecommendations.en, growthCohorts.en, growthMarketWizard.en, growthCrossProduct.en, growthCorporate.en, growthLoyalty.en, integrationsCenter.en, payReady.en, messagingChannels.en) } },
    fallbackLng: "en",
    supportedLngs: SUPPORTED as unknown as string[],
    interpolation: { escapeValue: false },
    detection: { order: ["localStorage"], lookupLocalStorage: "kx-lang", caches: ["localStorage"] },
    returnNull: false,
  });

i18n.on("languageChanged", setDocumentDirection);
setDocumentDirection(i18n.language ?? "en");

export default i18n;
