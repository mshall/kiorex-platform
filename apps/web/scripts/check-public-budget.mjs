// GRW-P1-E: asset budget of the public site build (ARCH section 5: public route JS <= 120 KB gzip, critical CSS inlined and small, fonts self-hosted).
// Usage: npm run build:public && npm run check:public-budget
import { readFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

const dir = new URL("../dist-public/client/", import.meta.url).pathname;
const manifestFile = join(dir, ".vite/manifest.json");
if (!existsSync(manifestFile)) { console.error("dist-public/client missing: run `npm run build:public` first"); process.exit(2); }
const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
const entries = Object.values(manifest);
const entry = entries.find((e) => e.isEntry);
const budget = { jsGzipKb: 120, cssRawKb: 15, preloadedFonts: 2 };

const seen = new Set();
const walk = (e) => { if (!e || seen.has(e.file)) return; seen.add(e.file); (e.imports ?? []).forEach((k) => walk(manifest[k])); };
walk(entry);
const js = [...seen].filter((f) => f.endsWith(".js")).map((f) => ({ f, gz: gzipSync(readFileSync(join(dir, f))).length }));
const jsKb = js.reduce((s, x) => s + x.gz, 0) / 1024;
const css = entries.filter((e) => e.file.endsWith(".css")).map((e) => ({ f: e.file, raw: readFileSync(join(dir, e.file)).length }));
const cssKb = css.reduce((s, x) => s + x.raw, 0) / 1024;
const fonts = entries.filter((e) => e.file.endsWith(".woff2"));

const rows = [
  ["public JS (gzip KB)", jsKb.toFixed(1), `<= ${budget.jsGzipKb}`, jsKb <= budget.jsGzipKb],
  ["critical CSS inlined (raw KB)", cssKb.toFixed(1), `<= ${budget.cssRawKb}`, cssKb <= budget.cssRawKb],
  ["self-hosted font files", String(fonts.length), ">= 1", fonts.length >= 1],
  ["third-party font/style origins in CSS", String(css.filter((c) => /fonts\.g(oogleapis|static)/.test(readFileSync(join(dir, c.f), "utf8"))).length), "0", true],
];
for (const r of rows) console.log(`${r[3] ? "ok  " : "FAIL"} ${r[0].padEnd(40)} ${r[1].padStart(8)}  (budget ${r[2]})`);
const bad = rows.filter((r) => !r[3]).length || css.some((c) => /fonts\.g(oogleapis|static)/.test(readFileSync(join(dir, c.f), "utf8")));
process.exit(bad ? 1 : 0);
