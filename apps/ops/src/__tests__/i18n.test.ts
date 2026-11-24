import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import ar from "@/i18n/locales/ar.json";
import en from "@/i18n/locales/en.json";
import campaignsNs from "@/i18n/growth.campaigns.json";
import stubsNs from "@/i18n/growth.stubs.json";
import integrationsNs from "@/i18n/growth.integrations.json";
import referralsNs from "@/i18n/growth.referrals.json";
import lifecycleNs from "@/i18n/growth.lifecycle.json";
import whatsappNs from "@/i18n/growth.whatsapp.json";
import experimentsNs from "@/i18n/growth.experiments.json";
import attributionModelsNs from "@/i18n/growth.attributionModels.json";
import sponsoredNs from "@/i18n/growth.sponsoredPromotions.json";
import fraudV2Ns from "@/i18n/growth.fraudV2.json";
import seoAutomationNs from "@/i18n/growth.seoAutomation.json";
import automationNs from "@/i18n/growth.automation.json";
import recommendationsNs from "@/i18n/growth.recommendations.json";
import cohortsNs from "@/i18n/growth.cohorts.json";
import marketWizardNs from "@/i18n/growth.marketWizard.json";

const flat = (o: Record<string, unknown>, p = ""): string[] => Object.entries(o).flatMap(([k, v]) => (typeof v === "object" && v ? flat(v as Record<string, unknown>, `${p}${k}.`) : [`${p}${k}`]));
const base = (k: string) => k.replace(/_(zero|one|two|few|many|other)$/, "");
const src = path.resolve(__dirname, "..");
const files = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? (f === "__tests__" || f === "mocks" ? [] : files(p)) : /\.(tsx?)$/.test(f) ? [p] : []; });

describe("i18n", () => {
  // the per-package namespaced files (GRW-P2-X1: growth.<pkg>.json, shape {en, ar}) are merged into the catalogue at start-up
  const A = new Set([...flat(ar), ...flat(campaignsNs.ar), ...flat(stubsNs.ar), ...flat(integrationsNs.ar), ...flat(referralsNs.ar), ...flat(lifecycleNs.ar), ...flat(whatsappNs.ar), ...flat(experimentsNs.ar), ...flat(attributionModelsNs.ar), ...flat(sponsoredNs.ar), ...flat(fraudV2Ns.ar), ...flat(seoAutomationNs.ar), ...flat(automationNs.ar), ...flat(recommendationsNs.ar), ...flat(cohortsNs.ar), ...flat(marketWizardNs.ar)].map(base)); const E = new Set([...flat(en), ...flat(campaignsNs.en), ...flat(stubsNs.en), ...flat(integrationsNs.en), ...flat(referralsNs.en), ...flat(lifecycleNs.en), ...flat(whatsappNs.en), ...flat(experimentsNs.en), ...flat(attributionModelsNs.en), ...flat(sponsoredNs.en), ...flat(fraudV2Ns.en), ...flat(seoAutomationNs.en), ...flat(automationNs.en), ...flat(recommendationsNs.en), ...flat(cohortsNs.en), ...flat(marketWizardNs.en)].map(base));
  it("ar and en have the same keys (plural suffixes aside)", () => {
    expect([...E].filter((k) => !A.has(k))).toEqual([]); expect([...A].filter((k) => !E.has(k))).toEqual([]);
  });
  it("every static t('key') used in source exists in both locales", () => {
    const used = new Set<string>();
    for (const f of files(src)) for (const m of readFileSync(f, "utf8").matchAll(/\bt\(\s*["']([a-zA-Z0-9_.]+)["']/g)) used.add(m[1]);
    expect([...used].filter((k) => !E.has(k) || !A.has(k))).toEqual([]);
  });
});

describe("i18n merge of namespaced catalogues", () => {
  it("adds keys, deep-merges objects, never overwrites or reorders the main catalogue", async () => {
    const { merge } = await import("@/i18n");
    const main = { a: "main", nested: { x: "1", y: "2" }, list: ["m"] };
    const out = merge(main, { a: "other", b: "new", nested: { y: "no", z: "3" }, list: ["o"] }, { c: "c" });
    expect(out).toEqual({ a: "main", nested: { x: "1", y: "2", z: "3" }, list: ["m"], b: "new", c: "c" });
    expect(Object.keys(out).slice(0, 3)).toEqual(["a", "nested", "list"]);
    expect(main).toEqual({ a: "main", nested: { x: "1", y: "2" }, list: ["m"] });
  });
});
