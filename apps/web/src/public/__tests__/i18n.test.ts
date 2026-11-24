import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import ar from "../locales/ar.json";
import en from "../locales/en.json";

/** The public site has its own catalogue (src/public/locales, namespace `public`): same keys in AR and EN, and every key used in its source exists. */
describe("public catalogue", () => {
  const A = Object.keys(ar); const E = Object.keys(en);
  it("ar and en have identical keys and no empty value", () => {
    expect(A.sort()).toEqual(E.sort());
    for (const [k, v] of [...Object.entries(ar), ...Object.entries(en)]) expect({ k, ok: typeof v === "string" && v.trim().length > 0 }).toEqual({ k, ok: true });
  });
  it("every static t('key') in src/public exists in both languages", () => {
    const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = resolve(d, f); return statSync(p).isDirectory() ? (f === "__tests__" ? [] : walk(p)) : /\.tsx?$/.test(f) ? [p] : []; });
    const used = new Set<string>();
    for (const f of walk(resolve(__dirname, ".."))) for (const m of readFileSync(f, "utf8").matchAll(/\bt\(\s*["']([a-zA-Z0-9_.]+)["']/g)) used.add(m[1]!);
    expect(used.size).toBeGreaterThan(30);
    expect([...used].filter((k) => !(k in en) || !(k in ar))).toEqual([]);
  });
  it("interpolation variables match between languages", () => {
    const vars = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
    for (const k of A) expect({ k, v: vars((ar as Record<string, string>)[k]!) }).toEqual({ k, v: vars((en as Record<string, string>)[k]!) });
  });
});
