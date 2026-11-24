// Lighthouse audit of the public SSR pages (GRW-P1-E / KX-33). Local lab measurement against a RUNNING site (default the API on :4000, role `all`).
//   node scripts/lighthouse-audit.mjs [--base http://localhost:4000] [--runs 1] [--only mobile|desktop] [--locales ar,en] [--out .lighthouseci] [--throttling simulate|devtools]
// `--throttling devtools` really slows the browser (applied throttling) instead of modelling it: slower to run, closer to what a phone does, and a cross-check of the default simulated numbers.
// Budgets come from lighthouserc.json (ci.assert.assertions: categories:* minScore, audits maxNumericValue). Exit 1 when a budget is missed.
// Lab scores are NOT field data: they use simulated throttling on one machine and a warm local cache. Real-user (CrUX / RUM) p75 for mobile Egypt
// is the target that counts after launch (LCP 2.5 s, INP 200 ms, CLS 0.1).
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { launch } from "chrome-launcher";
import lighthouse, { desktopConfig } from "lighthouse";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const base = arg("--base", "http://localhost:4000").replace(/\/$/, "");
const runs = Number(arg("--runs", "1"));
const only = arg("--only", "");
const locales = arg("--locales", "ar,en").split(",");
const outDir = arg("--out", ".lighthouseci");
const throttlingMethod = arg("--throttling", "simulate");
const rc = JSON.parse(readFileSync(new URL("../lighthouserc.json", import.meta.url), "utf8")).ci;
const slugs = rc.pages ?? { doctor: "mona-fahmy", clinic: "pyramids-heart-care-center-dokki", specialty: "paediatrics", city: "cairo" };
// the configured slugs are the local demo catalogue; on any other data set a missing page is replaced by the first sitemap entry of that type
const okPage = async (path) => { try { const r = await fetch(base + path, { redirect: "manual" }); await r.arrayBuffer(); return r.status === 200; } catch { return false; } };
const fromSitemap = async (shard, fallback) => {
  try {
    const idx = await (await fetch(`${base}/sitemap.xml`)).text();
    const loc = [...idx.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).find((u) => u.includes(`/${shard}-`));
    if (!loc) return fallback;
    const urls = [...(await (await fetch(base + new URL(loc).pathname)).text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    return urls[0] ? new URL(urls[0]).pathname.split("/").pop() : fallback;
  } catch { return fallback; }
};
if (!(await okPage(`/ar/eg/doctor/${slugs.doctor}`))) slugs.doctor = await fromSitemap("doctor-eg-ar", slugs.doctor);
if (!(await okPage(`/ar/eg/clinic/${slugs.clinic}`))) slugs.clinic = await fromSitemap("clinic-eg-ar", slugs.clinic);
const pages = (l) => ({
  home: `/${l}/eg`,
  "specialty-hub": `/${l}/eg/doctors/${slugs.specialty}`,
  "city-hub": `/${l}/eg/locations/${slugs.city}`,
  doctor: `/${l}/eg/doctor/${slugs.doctor}`,
  clinic: `/${l}/eg/clinic/${slugs.clinic}`,
});
const budgets = rc.assert.assertions;
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
mkdirSync(outDir, { recursive: true });
const chrome = await launch({ chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"] });
const rows = []; let failed = 0;
try {
  for (const factor of ["mobile", "desktop"].filter((f) => !only || f === only)) for (const l of locales) for (const [name, path] of Object.entries(pages(l))) {
    const samples = [];
    for (let i = 0; i < runs; i++) {
      const r = await lighthouse(base + path, { port: chrome.port, output: "json", logLevel: "error", onlyCategories: ["performance", "accessibility", "best-practices", "seo"], throttlingMethod }, factor === "desktop" ? desktopConfig : undefined);
      samples.push(r.lhr);
    }
    const score = (c) => Math.round(median(samples.map((s) => s.categories[c].score * 100)));
    const audit = (id) => median(samples.map((s) => s.audits[id].numericValue ?? 0));
    const row = { factor, locale: l, page: name, perf: score("performance"), a11y: score("accessibility"), bp: score("best-practices"), seo: score("seo"), lcp: Math.round(audit("largest-contentful-paint")), cls: +audit("cumulative-layout-shift").toFixed(3), tbt: Math.round(audit("total-blocking-time")), fcp: Math.round(audit("first-contentful-paint")), ttfb: Math.round(audit("server-response-time")) };
    const problems = [];
    for (const [k, v] of Object.entries(budgets)) {
      const [level, opt] = Array.isArray(v) ? v : [v, {}];
      if (level !== "error") continue;
      if (k.startsWith("categories:")) { const c = { performance: row.perf, accessibility: row.a11y, "best-practices": row.bp, seo: row.seo }[k.slice(11)]; if (c / 100 < opt.minScore) problems.push(`${k} ${c} < ${opt.minScore * 100}`); }
      else if (opt.maxNumericValue !== undefined) { const val = median(samples.map((s) => s.audits[k]?.numericValue ?? 0)); if (val > opt.maxNumericValue) problems.push(`${k} ${Math.round(val)} > ${opt.maxNumericValue}`); }
    }
    row.problems = problems; if (problems.length) failed++;
    rows.push(row);
    writeFileSync(`${outDir}/${factor}-${l}-${name}.json`, JSON.stringify(samples[0], null, 1));
    console.log(`${problems.length ? "FAIL" : "ok  "} ${factor.padEnd(7)} ${l} ${name.padEnd(13)} perf ${row.perf} a11y ${row.a11y} bp ${row.bp} seo ${row.seo} | LCP ${row.lcp} ms CLS ${row.cls} TBT ${row.tbt} ms FCP ${row.fcp} ms${problems.length ? "  <- " + problems.join("; ") : ""}`);
  }
} finally { await chrome.kill(); }
writeFileSync(`${outDir}/summary.json`, JSON.stringify(rows, null, 1));
console.log(failed ? `\n${failed} page/factor combination(s) missed a budget` : "\nall budgets met");
process.exit(failed ? 1 : 0);
