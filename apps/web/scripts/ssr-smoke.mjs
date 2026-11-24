// GRW-P1-E: smoke and Core Web Vitals hygiene check of a RUNNING public site (default the local API on :4000, which serves the role `all`).
//   node scripts/ssr-smoke.mjs [--base http://localhost:4000] [--paths /ar/eg,/en/eg/doctors/cardiology] [--lighthouse]
// Static checks (always): status, head tags, JSON-LD parse, canonical/hreflang, security headers, caching headers, no render-blocking CSS or sync script,
// every <img> has width and height (no layout shift), fonts self-hosted and preloaded, HTML weight, server timing.
// Lighthouse (only with --lighthouse and when the `lighthouse` CLI is installed locally; this repo does not vendor it): lighthouserc.json holds the budgets used by CI.
import { spawnSync } from "node:child_process";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const base = (arg("--base", "http://localhost:4000")).replace(/\/$/, "");
const paths = (arg("--paths", "/ar/eg,/en/eg")).split(",");
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failed++; };

for (const p of paths) {
  const t0 = performance.now();
  const res = await fetch(base + p, { redirect: "manual" });
  const ttfb = performance.now() - t0;
  const html = await res.text();
  console.log(`\n${p}  ->  ${res.status}  ${(html.length / 1024).toFixed(1)} KB  ttfb ${ttfb.toFixed(0)} ms  ${res.headers.get("server-timing") ?? ""}  cache=${res.headers.get("x-site-cache") ?? "-"}`);
  if (res.status !== 200) { check(res.status === 404 || res.status === 301 || res.status === 410, `expected status ${res.status} is a designed outcome`); continue; }
  const m = (re) => re.exec(html)?.[1];
  check(!!m(/<title>([^<]+)<\/title>/), "title");
  check(!!m(/<meta name="description" content="([^"]+)"/), "meta description");
  check(!!m(/<link rel="canonical" href="(https?:\/\/[^"]+)"/), "absolute canonical");
  check(/hreflang="x-default"/.test(html) && /hreflang="ar"/.test(html) && /hreflang="en"/.test(html), "hreflang ar, en and x-default");
  check(/<h1[ >]/.test(html), "H1 in the HTML (no JS needed)");
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([^<]*)<\/script>/g)];
  check(ld.length > 0 && ld.every((x) => { try { JSON.parse(x[1].replace(/\\u003c/g, "<").replace(/\\u003e/g, ">").replace(/\\u0026/g, "&")); return true; } catch { return false; } }), `JSON-LD parses (${ld.length} block(s))`);
  check(res.headers.get("x-frame-options") === "DENY" && /frame-ancestors 'none'/.test(res.headers.get("content-security-policy") ?? ""), "never framed (ADR-038)");
  check(/s-maxage=\d+/.test(res.headers.get("cache-control") ?? "") && !!res.headers.get("etag"), "CDN cache headers and ETag");
  check(!/<link[^>]+rel="stylesheet"/.test(html), "no render-blocking stylesheet (critical CSS inlined)");
  check(!/<script(?![^>]*type="(module|application\/(ld\+json|json))")[^>]*src=/.test(html), "no synchronous script");
  check(!/fonts\.googleapis|fonts\.gstatic/.test(html), "no third-party font origin");
  check(/rel="preload" as="font"/.test(html), "primary font preloaded");
  const imgs = [...html.matchAll(/<img\b[^>]*>/g)].map((x) => x[0]);
  check(imgs.every((i) => /\swidth=/.test(i) && /\sheight=/.test(i)), `all ${imgs.length} <img> have width and height (no layout shift)`);
  check(html.length < 150 * 1024, "HTML under 150 KB");
}

if (process.argv.includes("--lighthouse")) {
  const probe = spawnSync("npx", ["--no-install", "lighthouse", "--version"], { encoding: "utf8" });
  if (probe.status !== 0) console.log("\nlighthouse CLI is not installed here (not vendored): run Lighthouse CI in the pipeline with apps/web/lighthouserc.json, or `npm i -g lighthouse` and re-run with --lighthouse");
  else for (const p of paths) {
    const r = spawnSync("npx", ["--no-install", "lighthouse", base + p, "--only-categories=performance", "--output=json", "--quiet", "--chrome-flags=--headless=new --no-sandbox", "--preset=perf", "--form-factor=mobile"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) { check(false, `lighthouse ${p}`); continue; }
    const j = JSON.parse(r.stdout);
    const perf = j.categories.performance.score * 100, lcp = j.audits["largest-contentful-paint"].numericValue, cls = j.audits["cumulative-layout-shift"].numericValue;
    check(perf >= 90, `${p} performance ${perf.toFixed(0)} (>= 90)`); check(lcp <= 2500, `${p} LCP ${lcp.toFixed(0)} ms (<= 2500)`); check(cls <= 0.1, `${p} CLS ${cls.toFixed(3)} (<= 0.1)`);
  }
}
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
