import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { matchPublicPath, PRIVATE_SPA_ROUTES, PUBLIC_ROUTES, publicPath, SPA_PASSTHROUGH_PAGES } from "../routes";
import { buildPath, parsePublicPath, ROUTES, SPA_PASSTHROUGH_PAGES as API_PASSTHROUGH } from "../../../../api/src/public-site/url-policy";

const ROOT = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

describe("public route table", () => {
  const samples: Record<string, Record<string, string>> = {
    home: {}, hub: { specialty: "cardiology" }, city: { specialty: "cardiology", city: "cairo" }, district: { specialty: "cardiology", city: "cairo", district: "maadi" },
    "care-district": { care: "home-nursing", city: "cairo", district: "maadi" }, doctor: { slug: "sara-hassan" }, clinic: { slug: "nile-clinic" }, nurse: { slug: "mona-adel" }, pharmacy: { slug: "x-pharm" }, lab: { slug: "x-lab" },
  };
  it("matches and builds every public type", () => {
    for (const r of PUBLIC_ROUTES) {
      const path = publicPath("en", "eg", r.type, samples[r.type]);
      expect(matchPublicPath(path)).toMatchObject({ type: r.type, params: samples[r.type], enabled: r.enabled });
    }
    expect(matchPublicPath("/en/eg/account")).toBeNull();
    expect(matchPublicPath("/search")).toBeNull();
  });
  it("is identical to the API url-policy (parity: same types, patterns, enabled flags, same parse and build results)", () => {
    const api = ROUTES.filter((r) => r.type !== "static");
    expect(PUBLIC_ROUTES.map((r) => [r.type, r.pattern, r.enabled])).toEqual(api.map((r) => [r.type, r.pattern, r.enabled]));
    for (const r of PUBLIC_ROUTES) {
      const web = publicPath("ar", "EG", r.type, samples[r.type]);
      expect(web).toBe(buildPath("ar", "EG", r.type, samples[r.type]));
      const parsed = parsePublicPath(web);
      expect(parsed.kind === "match" && parsed.value.type).toBe(matchPublicPath(web)!.type);
    }
    for (const p of ["/ar/eg/doctors/x", "/ar/eg/doctors/x/y/z/w", "/ar/eg/doctor", "/ar/eg/home-nursing/a/b", "/ar/eg/nope"]) {
      expect(matchPublicPath(p)?.type ?? null).toBe((() => { const r = parsePublicPath(p); return r.kind === "match" ? r.value.type : null; })());
    }
  });
});

describe("route snapshot: every App.tsx route is public-table or noindex", () => {
  const app = read("src/App.tsx");
  const routes = [...app.matchAll(/<Route[^>]*\spath="([^"]+)"/g)].map((m) => `/${m[1]!.replace(/^\//, "")}`).filter((p) => p !== "/*").sort();
  it("lists the SPA routes exactly (a new route must be classified here on purpose)", () => {
    expect(routes).toEqual([...PRIVATE_SPA_ROUTES].sort());
  });
  it("an SPA route inside the public namespace must be a declared pass-through (the API serves the SPA shell, noindex), identical on both sides", () => {
    expect([...SPA_PASSTHROUGH_PAGES]).toEqual([...API_PASSTHROUGH]);
    for (const r of routes) {
      expect(r).not.toMatch(/^\/(ar|en)(\/|$)/);
      const m = /^\/:locale\/:cc\/(.+)$/.exec(r);
      if (m) expect(SPA_PASSTHROUGH_PAGES as readonly string[]).toContain(m[1]);
    }
    for (const p of SPA_PASSTHROUGH_PAGES) { expect(matchPublicPath(`/en/eg/${p}`)).toBeNull(); const r = parsePublicPath(`/en/eg/${p}`); expect(r.kind).toBe("spa"); }
  });
  it("the SPA shell is noindex (every SPA route), and the public namespace is not part of it", () => {
    const html = read("index.html");
    expect(html).toMatch(/<meta name="robots" content="noindex, nofollow"\s*\/?>/);
  });
});

describe("no private data can reach the public tree", () => {
  const walk = (dir: string): string[] => {
    return readdirSync(dir).flatMap((f: string) => { const p = resolve(dir, f); return statSync(p).isDirectory() ? (f === "__tests__" ? [] : walk(p)) : /\.(ts|tsx)$/.test(f) ? [p] : []; });
  };
  const files = [...walk(resolve(ROOT, "src/public")), resolve(ROOT, "src/entry-server.tsx"), resolve(ROOT, "src/entry-client.tsx")];
  it("never imports auth, patient, API-client or storage code and never touches cookies or storage", () => {
    expect(files.length).toBeGreaterThan(10);
    const bad = /from\s+["']@\/(auth|hooks\/usePatient|api|components\/AppLayout)|localStorage|sessionStorage|document\.cookie|oidc-client|Authorization/;
    for (const f of files) expect({ f, hit: bad.exec(readFileSync(f, "utf8"))?.[0] ?? null }).toEqual({ f, hit: null });
  });
});
