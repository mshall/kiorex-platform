import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import ar from "@/i18n/locales/ar.json";
import en from "@/i18n/locales/en.json";
import campaignsNs from "@/i18n/growth.campaigns.json";
import stubsNs from "@/i18n/growth.stubs.json";

const flat = (o: Record<string, unknown>, p = ""): string[] => Object.entries(o).flatMap(([k, v]) => (typeof v === "object" && v ? flat(v as Record<string, unknown>, `${p}${k}.`) : [`${p}${k}`]));
const base = (k: string) => k.replace(/_(zero|one|two|few|many|other)$/, "");
const src = path.resolve(__dirname, "..");
const files = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? (f === "__tests__" || f === "mocks" ? [] : files(p)) : /\.(tsx?)$/.test(f) ? [p] : []; });

describe("i18n", () => {
  // the per-package namespaced files (GRW-P2-X1: growth.<pkg>.json, shape {en, ar}) are merged into the catalogue at start-up
  const A = new Set([...flat(ar), ...flat(campaignsNs.ar), ...flat(stubsNs.ar)].map(base)); const E = new Set([...flat(en), ...flat(campaignsNs.en), ...flat(stubsNs.en)].map(base));
  it("ar and en have the same keys (plural suffixes aside)", () => {
    expect([...E].filter((k) => !A.has(k))).toEqual([]); expect([...A].filter((k) => !E.has(k))).toEqual([]);
  });
  it("every static t('key') used in source exists in both locales", () => {
    const used = new Set<string>();
    for (const f of files(src)) for (const m of readFileSync(f, "utf8").matchAll(/\bt\(\s*["']([a-zA-Z0-9_.]+)["']/g)) used.add(m[1]);
    expect([...used].filter((k) => !E.has(k) || !A.has(k))).toEqual([]);
  });
});
