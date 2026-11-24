import { describe, expect, it, vi } from "vitest";
import { createGrowthTracker, sanitizeProps, type TrackerDeps } from "@/lib/growth";
import { captureLinkToken, getLinkToken } from "@/lib/linkToken";
import type { StoredConsent } from "@/lib/consent";

const consent = (analytics: boolean): StoredConsent => ({ v: 1, textVersion: "t", analytics, marketing: false, consentId: null, at: "2026-11-24T00:00:00Z" });
function harness(c: StoredConsent | null) {
  type Body = { events: Array<{ name: string; careType?: string; props: Record<string, unknown> }> };
  const sent: Array<{ body: Body; headers: Record<string, string>; unload: boolean }> = [];
  let now = 1_000_000; let state = c; const timers: Array<() => void> = [];
  const deps: TrackerDeps = { send: (b, h, o) => sent.push({ body: JSON.parse(b), headers: h, unload: o.unload }), consent: () => state, now: () => now, platform: () => "web", setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: () => undefined };
  return { t: createGrowthTracker(deps), sent, setConsent: (x: StoredConsent | null) => { state = x; }, tick: (ms: number) => { now += ms; }, fire: () => timers.splice(0).forEach((f) => f()) };
}
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };

describe("growth tracker (GRW-P1-J web client)", () => {
  it("sends NOTHING before the visitor has decided, then flushes the queue once they do", () => {
    const h = harness(null);
    h.t.track("PageViewed", { landingKind: "HOME" }); h.t.track("SearchStarted", { careType: "DOCTORS" }); h.fire();
    expect(h.sent).toHaveLength(0); expect(h.t.pending()).toBe(2);
    h.setConsent(consent(true)); h.t.flush();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.body.events.map((e) => e.name)).toEqual(["PageViewed", "SearchStarted"]);
  });
  it("accept adds the analytics header; reject sends the same events anonymously with no consent header", () => {
    const a = harness(consent(true)); a.t.track("PageViewed", { landingKind: "HOME" }); a.fire();
    expect(a.sent[0]!.headers["X-KX-Consent"]).toBe("analytics");
    const r = harness(consent(false)); r.t.track("PageViewed", { landingKind: "HOME" }); r.fire();
    expect(r.sent[0]!.headers["X-KX-Consent"]).toBeUndefined();
  });
  it("suppresses duplicates for a minute and sends again afterwards", () => {
    const h = harness(consent(true));
    h.t.track("ResultsViewed", { careType: "DOCTORS" }); h.t.track("ResultsViewed", { careType: "DOCTORS" }); expect(h.t.pending()).toBe(1);
    h.tick(61_000); h.t.track("ResultsViewed", { careType: "DOCTORS" }); expect(h.t.pending()).toBe(2);
  });
  it("only canonical client events and closed fields: no specialty, provider, search text or id can be expressed", () => {
    const h = harness(consent(true));
    h.t.track("BookingConfirmed" as never); // a server-only name is refused
    h.t.track("SearchStarted", { careType: "NOT_A_TYPE" as never, props: { specialty: "dermatology", providerId: "lst_1", q: "chest pain", surface: "hero", email: "a@b.co" } });
    h.fire();
    const e = h.sent[0]!.body.events;
    expect(e).toHaveLength(1);
    expect(JSON.stringify(e)).not.toMatch(/dermatology|lst_1|chest|a@b\.co/);
    expect(e[0]!.props).toEqual({ platform: "web", surface: "hero" });
    expect(e[0]!.careType).toBeUndefined();
  });
  it("batches of at most 20 and a tight flush on unload", () => {
    const h = harness(consent(true));
    for (let i = 0; i < 25; i++) h.t.track("PageViewed", { landingKind: "OTHER", props: { count: i } });
    expect(h.sent.map((s) => s.body.events.length)).toEqual([20]);
    h.t.flush(true); expect(h.sent.at(-1)!.unload).toBe(true);
  });
  it("sanitizeProps keeps short tokens, numbers and booleans only", () => {
    expect(sanitizeProps({ surface: "a b", step: "x".repeat(70), count: 3, variant: true, locale: "ar", reason: null })).toEqual({ count: 3, variant: true, locale: "ar" });
  });
});

describe("provider link token capture (GRW-P1-C)", () => {
  it("keeps a well-formed lt for the tab and ignores junk", () => {
    const s = mem(); const lt = "eyJvIjoidG5fMSIsImMiOiJBQkNEMTIzNCJ9.c2lnbmF0dXJl";
    captureLinkToken(`?utm_source=x&lt=${lt}`, s); expect(getLinkToken(s)).toBe(lt);
    const s2 = mem(); captureLinkToken("?lt=%3Cscript%3E", s2); expect(getLinkToken(s2)).toBeUndefined();
    captureLinkToken("?lt=short", s2); expect(getLinkToken(s2)).toBeUndefined();
  });
});
void vi;
