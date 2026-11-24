import { createAppGrowth, type Deps } from "../lib/growth";

function make(consent: "granted" | "denied" | null) {
  const sent: Array<{ body: any; headers: Record<string, string> }> = []; let now = 1_000_000; let c = consent;
  const deps: Deps = { consent: async () => c, send: async (b, h) => { sent.push({ body: JSON.parse(b), headers: h }); }, now: () => now, platform: () => "ios" };
  return { g: createAppGrowth(deps), sent, set: (x: typeof consent) => { c = x; }, tick: (ms: number) => { now += ms; } };
}

describe("app growth tracker (GRW-P1-J)", () => {
  it("holds events while consent is undecided and sends them once the person decides", async () => {
    const m = make(null); m.g.track("PageViewed", { landingKind: "APP_OPEN" }); await m.g.flush();
    expect(m.sent).toHaveLength(0); expect(m.g.pending()).toBe(1);
    m.set("granted"); await m.g.flush(); expect(m.sent).toHaveLength(1); expect(m.sent[0]!.headers["X-KX-Consent"]).toBe("analytics");
  });
  it("denied sends the anonymous stream without the consent header; no identifier is ever included", async () => {
    const m = make("denied"); m.g.track("AppInstalled", { landingKind: "APP_OPEN" }); await m.g.flush();
    expect(m.sent[0]!.headers["X-KX-Consent"]).toBeUndefined();
    expect(JSON.stringify(m.sent[0]!.body)).not.toMatch(/sub|phone|device|idfa|token/i);
    expect(m.sent[0]!.body.events[0].props).toEqual({ platform: "ios" });
  });
  it("closed event names and fields, duplicates suppressed for a minute", async () => {
    const m = make("granted");
    m.g.track("BookingConfirmed" as never); m.g.track("SearchStarted", { careType: "DOCTORS", props: { specialty: "ent", providerId: "x", surface: "home" } });
    m.g.track("SearchStarted", { careType: "DOCTORS", props: { surface: "home" } }); // same canonical key after sanitising
    expect(m.g.pending()).toBe(1);
    m.tick(61_000); m.g.track("SearchStarted", { careType: "DOCTORS", props: { surface: "home" } }); expect(m.g.pending()).toBe(2);
    await m.g.flush(); const e = m.sent[0]!.body.events; expect(JSON.stringify(e)).not.toMatch(/ent"|providerId/);
  });
});
