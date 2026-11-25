import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { ConsentIsland } from "../components/ConsentIsland";
import { PublicApp } from "../PublicApp";
import { createPublicI18n, makeCtx } from "../i18n";
import { SAMPLES } from "./fixtures";
import { CONSENT_STORAGE_KEY } from "@/lib/consent";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const ctxFor = (locale: "ar" | "en") => makeCtx(createPublicI18n(locale), { locale, cc: "eg", path: `/${locale}/eg`, canonicalHost: "kiorex.test", reviewMarkup: false, templates: {}, imageCdn: null, query: {} as never });

/** G-20 SSR consent banner island. */
describe("public consent island", () => {
  let host: HTMLDivElement; let calls: { url: string; init?: RequestInit }[];
  const mockFetch = (available: boolean, textVersion = "TODO_NEEDS_HUMAN_v0") => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.includes("consent/versions")) return new Response(JSON.stringify({ analytics: textVersion, marketing: textVersion, available }), { status: 200 });
      return new Response(JSON.stringify({ consentId: "kxc_test" }), { status: 201 });
    }));
  };
  beforeEach(() => { localStorage.clear(); calls = []; host = document.createElement("div"); document.body.appendChild(host); });
  afterEach(() => { vi.unstubAllGlobals(); host.remove(); });
  const mount = async (locale: "ar" | "en" = "en") => { const root = createRoot(host); await act(async () => { root.render(createElement(ConsentIsland, { ctx: ctxFor(locale) })); }); await act(async () => { await Promise.resolve(); }); return root; };

  it("renders nothing on the server (the cached HTML is the same for every visitor)", () => {
    for (const l of ["ar", "en"] as const) for (const s of SAMPLES(l)) expect(renderToString(createElement(PublicApp, { state: s }))).not.toContain("public-consent");
  });
  it("stays hidden while the flag is locked OFF (available=false) and sends no choice request", async () => {
    mockFetch(false); await mount();
    expect(host.querySelector("[data-testid=public-consent]")).toBeNull();
    expect(calls.map((c) => c.url)).toEqual(["/api/v1/growth/v1/consent/versions"]);
    expect((calls[0]!.init!.headers as Record<string, string>)["X-Kiorex-Market"]).toBe("EG");
  });
  it("shows with equal-weight Accept and Reject, nothing pre-ticked, a draft chip and a link to the preference centre (English and Arabic)", async () => {
    for (const l of ["en", "ar"] as const) {
      host.innerHTML = ""; mockFetch(true); const root = await mount(l);
      const accept = host.querySelector("[data-testid=public-consent-accept]")!; const reject = host.querySelector("[data-testid=public-consent-reject]")!;
      expect(accept.className).toBe(reject.className); expect(accept.tagName).toBe(reject.tagName);
      expect(host.querySelector("input[type=checkbox]")).toBeNull();
      expect(host.querySelector("[data-testid=public-consent-draft]")).not.toBeNull();
      expect(host.querySelector("a")!.getAttribute("href")).toBe(`/${l}/eg/preferences`);
      expect(host.textContent).toContain(l === "ar" ? "رفض" : "Reject");
      await act(async () => { root.unmount(); });
    }
  });
  it("Reject stores analytics=false with the wording version, records the audit row, hides the banner, and it does not come back", async () => {
    mockFetch(true, "TODO_NEEDS_HUMAN_v0"); const root = await mount();
    await act(async () => { (host.querySelector("[data-testid=public-consent-reject]") as HTMLElement).click(); await Promise.resolve(); });
    const stored = JSON.parse(localStorage.getItem(CONSENT_STORAGE_KEY)!);
    expect(stored).toMatchObject({ analytics: false, marketing: false, textVersion: "TODO_NEEDS_HUMAN_v0" });
    expect(host.querySelector("[data-testid=public-consent]")).toBeNull();
    const post = calls.find((c) => c.init?.method === "POST")!; expect(JSON.parse(post.init!.body as string)).toMatchObject({ analytics: false, evidence: "reject" });
    await act(async () => { root.unmount(); }); host.innerHTML = ""; await mount();
    expect(host.querySelector("[data-testid=public-consent]")).toBeNull();
  });
  it("Accept stores analytics=true; a changed wording version asks again", async () => {
    mockFetch(true, "v1"); let root = await mount();
    await act(async () => { (host.querySelector("[data-testid=public-consent-accept]") as HTMLElement).click(); await Promise.resolve(); });
    expect(JSON.parse(localStorage.getItem(CONSENT_STORAGE_KEY)!)).toMatchObject({ analytics: true, marketing: false, textVersion: "v1" });
    await act(async () => { root.unmount(); }); host.innerHTML = ""; mockFetch(true, "v2"); root = await mount();
    expect(host.querySelector("[data-testid=public-consent]")).not.toBeNull();
    expect(host.querySelector("[data-testid=public-consent-draft]")).toBeNull();
  });
  it("an unreachable API keeps the banner hidden (no choice is offered that cannot be recorded)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); })); await mount();
    expect(host.querySelector("[data-testid=public-consent]")).toBeNull();
  });
});
