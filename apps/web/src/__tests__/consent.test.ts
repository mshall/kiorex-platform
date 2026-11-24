import { describe, expect, it, vi } from "vitest";
import { CONSENT_STORAGE_KEY, CONSENT_TEXT_PLACEHOLDER, consentHeaders, fetchTextVersions, landingKindFor, needsDecision, readConsent, saveConsent, sendTouch, touchBodyFrom, type StoredConsent } from "@/lib/consent";

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0, raw: m } as unknown as Storage & { raw: Map<string, string> }; };
const stored = (o: Partial<StoredConsent> = {}): StoredConsent => ({ v: 1, textVersion: "v1", analytics: true, marketing: false, consentId: "kxc_1", at: "2026-11-24T00:00:00Z", ...o });

describe("consent storage", () => {
  it("nothing stored means nothing chosen: the banner must show, and no analytics header exists", () => {
    expect(readConsent(mem())).toBeNull();
    expect(needsDecision(null, "v1")).toBe(true);
    expect(consentHeaders(null)).toEqual({});
  });
  it("a stored choice is asked again when the wording version changes", () => {
    expect(needsDecision(stored(), "v1")).toBe(false);
    expect(needsDecision(stored(), "v2")).toBe(true);
  });
  it("ignores corrupt or foreign storage values", () => {
    for (const raw of ["", "nope", "{}", JSON.stringify({ v: 2 }), JSON.stringify({ v: 1, analytics: "yes", marketing: false, textVersion: "v" })]) { const s = mem(); s.setItem(CONSENT_STORAGE_KEY, raw); expect(readConsent(s)).toBeNull(); }
  });
  it("the analytics header is present only for an accepted analytics choice", () => {
    expect(consentHeaders(stored({ analytics: true }))).toEqual({ "X-KX-Consent": "analytics" });
    expect(consentHeaders(stored({ analytics: false, marketing: true }))).toEqual({});
  });
});

describe("saveConsent", () => {
  it("applies the choice locally first, then records the audit decision and keeps the consent id", async () => {
    const storage = mem();
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ consentId: "kxc_abc" }), { status: 201 })) as unknown as typeof fetch;
    const r = await saveConsent({ analytics: true, marketing: false }, "v7", { evidence: "accept", fetchFn, storage });
    expect(r).toMatchObject({ analytics: true, marketing: false, textVersion: "v7", consentId: "kxc_abc" });
    expect(readConsent(storage)).toMatchObject({ consentId: "kxc_abc", textVersion: "v7" });
    const call = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe("/api/v1/growth/v1/consent");
    expect(JSON.parse(call[1].body as string)).toEqual({ analytics: true, marketing: false, textVersion: "v7", source: "web", evidence: "accept" });
  });
  it("a failing network never keeps a rejected visitor tracked: the local reject stands", async () => {
    const storage = mem();
    const r = await saveConsent({ analytics: false, marketing: false }, "v1", { evidence: "reject", fetchFn: (async () => { throw new Error("offline"); }) as unknown as typeof fetch, storage });
    expect(r.analytics).toBe(false); expect(readConsent(storage)?.analytics).toBe(false);
  });
  it("text versions fall back to the placeholder when the server is unreachable", async () => {
    expect(await fetchTextVersions((async () => { throw new Error("x"); }) as unknown as typeof fetch)).toEqual({ analytics: CONSENT_TEXT_PLACEHOLDER, marketing: CONSENT_TEXT_PLACEHOLDER });
    expect(await fetchTextVersions((async () => new Response(JSON.stringify({ analytics: "a1", marketing: "m1" }))) as unknown as typeof fetch)).toEqual({ analytics: "a1", marketing: "m1" });
  });
});

describe("touches", () => {
  it("without analytics consent no request is made at all", async () => {
    const f = vi.fn();
    expect(await sendTouch({ landingKind: "HOME" }, f as unknown as typeof fetch, null)).toBe(false);
    expect(await sendTouch({ landingKind: "HOME" }, f as unknown as typeof fetch, stored({ analytics: false }))).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
  it("with consent the touch carries the analytics header and only the sanitised body", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 202 }));
    expect(await sendTouch({ landingKind: "HOME" }, f as unknown as typeof fetch, stored())).toBe(true);
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["X-KX-Consent"]).toBe("analytics");
  });
  it("the touch body keeps only known utm keys with safe values, a valid ref and lt; PII-looking values never leave", () => {
    const b = touchBodyFrom("?utm_source=google&utm_medium=cpc&utm_campaign=jane@example.com&utm_term=two%20words&ref=7K2M9X4Q&lt=kxl1.a.b&q=chest+pain&email=a@b.co", "/doctors/lst_1", 1800);
    expect(b).toEqual({ landingKind: "PROVIDER_LINK", utm: { source: "google", medium: "cpc" }, ref: "7K2M9X4Q", lt: "kxl1.a.b", dwellMs: 1800 });
    expect(touchBodyFrom("?q=heart", "/search")).toEqual({ landingKind: "HOME" });
    expect(landingKindFor("/doctors/x")).toBe("DOCTOR");
    expect(landingKindFor("/account")).toBe("OTHER");
  });
});
