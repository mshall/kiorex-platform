import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import ar from "@/i18n/locales/ar.json";
import en from "@/i18n/locales/en.json";
import referralAr from "@/i18n/referral.ar.json";
import referralEn from "@/i18n/referral.en.json";
import corporateAr from "@/i18n/corporate.ar.json";
import corporateEn from "@/i18n/corporate.en.json";
import loyaltyAr from "@/i18n/loyalty.ar.json";
import loyaltyEn from "@/i18n/loyalty.en.json";
import lpAr from "@/i18n/lp.ar.json";
import lpEn from "@/i18n/lp.en.json";
import obAr from "@/i18n/ob.ar.json";
import obEn from "@/i18n/ob.en.json";
import sponsoredAr from "@/i18n/sponsored.ar.json";
import sponsoredEn from "@/i18n/sponsored.en.json";
import continuityAr from "@/i18n/continuity.ar.json";
import continuityEn from "@/i18n/continuity.en.json";

const flat = (o: Record<string, unknown>, p = ""): string[] => Object.entries(o).flatMap(([k, v]) => (typeof v === "object" && v ? flat(v as Record<string, unknown>, `${p}${k}.`) : [`${p}${k}`]));
const base = (k: string) => k.replace(/_(zero|one|two|few|many|other)$/, "");
const src = path.resolve(__dirname, "..");
const files = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? (f === "__tests__" || f === "mocks" || f === "test" ? [] : files(p)) : /\.(tsx?)$/.test(f) ? [p] : []; });

describe("i18n", () => {
  const A = new Set(flat({ ...ar, referral: referralAr, sponsored: sponsoredAr, continuity: continuityAr, corporate: corporateAr, loyalty: loyaltyAr, lp: lpAr, entry: obAr.entry, welcome: obAr.welcome, home: { ...ar.home, ...obAr.home } }).map(base)); const E = new Set(flat({ ...en, referral: referralEn, sponsored: sponsoredEn, continuity: continuityEn, corporate: corporateEn, loyalty: loyaltyEn, lp: lpEn, entry: obEn.entry, welcome: obEn.welcome, home: { ...en.home, ...obEn.home } }).map(base)); // GRW-P2-B3: namespace referral.* lives in its own files
  it("ar and en have the same keys (plural suffixes aside)", () => {
    expect([...E].filter((k) => !A.has(k))).toEqual([]); expect([...A].filter((k) => !E.has(k))).toEqual([]);
  });
  it("every static t('key') used in source exists in both locales (the public site has its own catalogue and test)", () => {
    const used = new Set<string>();
    for (const f of files(src).filter((x) => !/[\\/]src[\\/]public[\\/]/.test(x))) for (const m of readFileSync(f, "utf8").matchAll(/\bt\(\s*["']([a-zA-Z0-9_.]+)["']/g)) used.add(m[1]);
    expect([...used].filter((k) => !E.has(k) || !A.has(k))).toEqual([]);
  });
  it("Arabic has the full plural set for counted strings", () => {
    const keys = flat(ar); for (const c of ["zero", "one", "two", "few", "many", "other"]) expect(keys).toContain(`results.count_${c}`);
  });
});
